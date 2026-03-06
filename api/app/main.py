from __future__ import annotations

import time
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .autodetect import AutoDetectError, detect_wall_segments_from_pdf
from .ifc_factory import IfcGenerationError, create_ifc_from_annotations, create_wall_ifc
from .job_store import (
    JobRecord,
    PlanRecord,
    default_annotations,
    is_safe_plan_id,
    load_annotations,
    load_job,
    save_annotations,
    save_job,
    write_plan_pdf,
)

BASE_DIR = Path(__file__).resolve().parent.parent
ARTIFACTS_DIR = BASE_DIR / "storage" / "artifacts"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
JOB_DATA_DIR = BASE_DIR / "data" / "jobs"
JOB_DATA_DIR.mkdir(parents=True, exist_ok=True)

JOB_DURATION_SECONDS = 12
SAMPLE_ARTIFACT_PATH = ARTIFACTS_DIR / "sample-wall.ifc"


class PlanCreateRequest(BaseModel):
    plan_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    storey_index: int = Field(ge=0)
    pdf_data_base64: str = Field(min_length=1)


class PlanSnapshotResponse(BaseModel):
    id: str
    name: str
    storey_index: int
    pdf_url: str
    size_label: str


class JobCreateRequest(BaseModel):
    plans: list[PlanCreateRequest] = Field(min_length=1)
    start_level: Literal["ground", "basement", "upper"]


class SegmentPayload(BaseModel):
    id: str
    x1_px: float
    y1_px: float
    x2_px: float
    y2_px: float


class PlanAnnotationsPayload(BaseModel):
    plan_id: str
    plan_name: str | None = None
    storey_index: int = Field(ge=0)
    px_to_m: float | None = Field(default=None, gt=0)
    wall_height_m: float = Field(default=2.4, gt=0)
    wall_thickness_m: float = Field(default=0.12, gt=0)
    segments: list[SegmentPayload] = Field(default_factory=list)


class AnnotationsPayload(BaseModel):
    plans: list[PlanAnnotationsPayload] = Field(default_factory=list)


class JobSnapshotResponse(BaseModel):
    id: str
    status: Literal["draft", "queued", "processing", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    artifact_url: str | None = None
    plan_names: list[str]
    plans: list[PlanSnapshotResponse]
    start_level: Literal["ground", "basement", "upper"]


class AutoDetectRequest(BaseModel):
    page: int = Field(default=1, ge=1)
    mode: str = Field(default="raster", min_length=1)


class AutoDetectSegmentResponse(BaseModel):
    x1_px: float
    y1_px: float
    x2_px: float
    y2_px: float


class AutoDetectMetaImageSizeResponse(BaseModel):
    width: int = Field(ge=1)
    height: int = Field(ge=1)


class AutoDetectMetaResponse(BaseModel):
    method: str
    image_size: AutoDetectMetaImageSizeResponse
    filtered_count: int = Field(ge=0)


class AutoDetectResponse(BaseModel):
    segments: list[AutoDetectSegmentResponse]
    meta: AutoDetectMetaResponse


app = FastAPI(title="AmpliFy Stub API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/artifacts", StaticFiles(directory=ARTIFACTS_DIR), name="artifacts")
app.mount("/job-files", StaticFiles(directory=JOB_DATA_DIR), name="job-files")

jobs: dict[str, JobRecord] = {}


def artifact_path_for(job_id: str) -> Path:
    return ARTIFACTS_DIR / f"{job_id}.ifc"


def get_job_record(job_id: str) -> JobRecord:
    job = jobs.get(job_id)
    if job is None:
        job = load_job(JOB_DATA_DIR, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="ジョブが見つかりません。")
        jobs[job.id] = job
    return job


def get_plan_record(job: JobRecord, plan_id: str) -> PlanRecord:
    for plan in job.plans:
        if plan.id == plan_id:
            return plan
    raise HTTPException(status_code=404, detail="plan が見つかりません。")


def plan_snapshots(job: JobRecord, request: Request) -> list[PlanSnapshotResponse]:
    snapshots: list[PlanSnapshotResponse] = []
    for plan in sorted(job.plans, key=lambda item: item.storey_index):
        pdf_url = str(request.url_for("job-files", path=f"{job.id}/plans/{plan.pdf_filename}"))
        snapshots.append(
            PlanSnapshotResponse(
                id=plan.id,
                name=plan.name,
                storey_index=plan.storey_index,
                pdf_url=pdf_url,
                size_label=plan.size_label,
            )
        )
    return snapshots


_MIN_VALID_IFC_SIZE = 2000  # geometry 入りの IFC は最低でも ~2500 bytes 以上になる


def build_wall_ifc(job: JobRecord) -> Path:
    artifact_path = artifact_path_for(job.id)
    # キャッシュ済みの IFC があっても、サイズが極端に小さい場合は
    # geometry が欠落している可能性が高いので再生成する。
    if artifact_path.exists():
        if artifact_path.stat().st_size >= _MIN_VALID_IFC_SIZE:
            return artifact_path
        # 空 IFC キャッシュを削除して再生成
        artifact_path.unlink(missing_ok=True)

    annotations = load_annotations(JOB_DATA_DIR, job)
    has_segments = any(plan.get("segments") for plan in annotations.get("plans", []))

    try:
        if has_segments:
            create_ifc_from_annotations(
                artifact_path,
                project_name=f"Job {job.id}",
                annotations=annotations,
                start_level=job.start_level,
            )
        else:
            wall_name = job.plans[0].name if job.plans else "Sample Wall"
            create_wall_ifc(
                artifact_path,
                project_name=f"Job {job.id}",
                wall_name=wall_name,
                wall_length_m=max(4.0, float(max(1, len(job.plans))) * 2.0),
            )
    except IfcGenerationError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"IFC 生成に失敗しました: {exc.detail}",
        ) from exc

    return artifact_path


def create_snapshot(job: JobRecord, request: Request) -> JobSnapshotResponse:
    if job.started_at is None:
        return JobSnapshotResponse(
            id=job.id,
            status="draft",
            progress=0,
            artifact_url=None,
            plan_names=[plan.name for plan in job.plans],
            plans=plan_snapshots(job, request),
            start_level=job.start_level,  # type: ignore[arg-type]
        )

    elapsed_seconds = time.time() - job.started_at
    progress = min(100, int((elapsed_seconds / JOB_DURATION_SECONDS) * 100))

    if progress >= 100:
        artifact_path = build_wall_ifc(job)
        artifact_url = str(request.url_for("artifacts", path=artifact_path.name))
        status = "completed"
        progress = 100
    elif progress < 15:
        artifact_url = None
        status = "queued"
    else:
        artifact_url = None
        status = "processing"

    return JobSnapshotResponse(
        id=job.id,
        status=status,
        progress=progress,
        artifact_url=artifact_url,
        plan_names=[plan.name for plan in job.plans],
        plans=plan_snapshots(job, request),
        start_level=job.start_level,  # type: ignore[arg-type]
    )


def validate_create_job_payload(payload: JobCreateRequest) -> None:
    seen_plan_ids: set[str] = set()

    for plan in payload.plans:
        if not is_safe_plan_id(plan.plan_id):
            raise HTTPException(
                status_code=400,
                detail=(
                    "plan_id は英数字・アンダースコア・ハイフンのみ、"
                    "64文字以内で指定してください。"
                ),
            )

        if plan.plan_id in seen_plan_ids:
            raise HTTPException(
                status_code=409,
                detail=f"plan_id が重複しています: {plan.plan_id}",
            )
        seen_plan_ids.add(plan.plan_id)


def normalize_annotations_payload(job: JobRecord, payload: AnnotationsPayload) -> dict[str, list[dict[str, object]]]:
    template = default_annotations(job)
    known_by_id = {plan["plan_id"]: plan for plan in template["plans"]}

    for plan in payload.plans:
        if plan.plan_id not in known_by_id:
            raise HTTPException(status_code=400, detail="存在しない plan_id が含まれています。")

        known_by_id[plan.plan_id] = {
            "plan_id": plan.plan_id,
            "plan_name": next(item.name for item in job.plans if item.id == plan.plan_id),
            "storey_index": next(item.storey_index for item in job.plans if item.id == plan.plan_id),
            "px_to_m": plan.px_to_m,
            "wall_height_m": plan.wall_height_m,
            "wall_thickness_m": plan.wall_thickness_m,
            "segments": [segment.model_dump() for segment in plan.segments],
        }

    normalized = sorted(known_by_id.values(), key=lambda item: int(item["storey_index"]))
    return {"plans": normalized}


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/sample-ifc")
@app.head("/api/sample-ifc")
def sample_ifc() -> FileResponse:
    artifact_path = create_wall_ifc(
        SAMPLE_ARTIFACT_PATH,
        project_name="Sample Viewer Project",
        wall_name="Sample Viewer Wall",
    )
    return FileResponse(
        artifact_path,
        media_type="application/octet-stream",
        filename="sample.ifc",
    )


@app.post("/api/jobs", response_model=JobSnapshotResponse)
def create_job(payload: JobCreateRequest, request: Request) -> JobSnapshotResponse:
    validate_create_job_payload(payload)
    job_id = str(uuid4())
    plans: list[PlanRecord] = []

    for plan in sorted(payload.plans, key=lambda item: item.storey_index):
        try:
            pdf_filename, size_label = write_plan_pdf(
                JOB_DATA_DIR,
                job_id,
                plan.plan_id,
                plan.pdf_data_base64,
            )
        except FileExistsError as exc:
            raise HTTPException(
                status_code=409,
                detail=f"同じ plan_id の PDF が既に存在します: {plan.plan_id}",
            ) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        plans.append(
            PlanRecord(
                id=plan.plan_id,
                name=plan.name,
                storey_index=plan.storey_index,
                pdf_filename=pdf_filename,
                size_label=size_label,
            )
        )

    job = JobRecord(
        id=job_id,
        start_level=payload.start_level,
        plans=plans,
        created_at=time.time(),
        started_at=None,
    )
    save_job(JOB_DATA_DIR, job)
    save_annotations(JOB_DATA_DIR, job.id, default_annotations(job))
    jobs[job.id] = job
    return create_snapshot(job, request)


@app.post("/api/jobs/{job_id}/start", response_model=JobSnapshotResponse)
def start_job(job_id: str, request: Request) -> JobSnapshotResponse:
    job = get_job_record(job_id)
    artifact_path = artifact_path_for(job.id)
    if artifact_path.exists():
        artifact_path.unlink()

    job.started_at = time.time()
    save_job(JOB_DATA_DIR, job)
    jobs[job.id] = job
    return create_snapshot(job, request)


@app.get("/api/jobs/{job_id}", response_model=JobSnapshotResponse)
def get_job(job_id: str, request: Request) -> JobSnapshotResponse:
    job = get_job_record(job_id)
    return create_snapshot(job, request)


@app.get("/api/jobs/{job_id}/annotations", response_model=AnnotationsPayload)
def get_job_annotations(job_id: str) -> AnnotationsPayload:
    job = get_job_record(job_id)
    return AnnotationsPayload.model_validate(load_annotations(JOB_DATA_DIR, job))


@app.put("/api/jobs/{job_id}/annotations", response_model=AnnotationsPayload)
def put_job_annotations(job_id: str, payload: AnnotationsPayload) -> AnnotationsPayload:
    job = get_job_record(job_id)
    normalized = normalize_annotations_payload(job, payload)
    save_annotations(JOB_DATA_DIR, job.id, normalized)
    return AnnotationsPayload.model_validate(normalized)


@app.post(
    "/api/jobs/{job_id}/plans/{plan_id}/autodetect",
    response_model=AutoDetectResponse,
)
def autodetect_plan_segments(
    job_id: str,
    plan_id: str,
    payload: AutoDetectRequest,
) -> AutoDetectResponse:
    if payload.mode != "raster":
        raise HTTPException(
            status_code=400,
            detail="mode は raster のみ対応しています。",
        )
    if payload.page != 1:
        raise HTTPException(
            status_code=400,
            detail="Auto-detect (beta) は page=1 のみ対応しています。",
        )

    job = get_job_record(job_id)
    plan = get_plan_record(job, plan_id)

    plans_root = (JOB_DATA_DIR / job.id / "plans").resolve()
    plan_path = (plans_root / plan.pdf_filename).resolve(strict=False)
    if not plan_path.is_relative_to(plans_root):
        raise HTTPException(status_code=400, detail="plan PDF パスが不正です。")
    if not plan_path.exists():
        raise HTTPException(status_code=404, detail="plan PDF が見つかりません。")

    try:
        segments, meta = detect_wall_segments_from_pdf(
            plan_path,
            mode=payload.mode,
            page=payload.page,
        )
    except AutoDetectError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return AutoDetectResponse(
        segments=[AutoDetectSegmentResponse(**segment) for segment in segments],
        meta=AutoDetectMetaResponse(
            method=str(meta["method"]),
            image_size=AutoDetectMetaImageSizeResponse(**meta["image_size"]),
            filtered_count=int(meta["filtered_count"]),
        ),
    )
