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

from .ifc_factory import create_ifc_from_annotations, create_wall_ifc
from .job_store import (
    JobRecord,
    PlanRecord,
    default_annotations,
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


def build_wall_ifc(job: JobRecord) -> Path:
    artifact_path = artifact_path_for(job.id)
    if artifact_path.exists():
        return artifact_path

    annotations = load_annotations(JOB_DATA_DIR, job)
    has_segments = any(plan.get("segments") for plan in annotations.get("plans", []))

    if has_segments:
        create_ifc_from_annotations(
            artifact_path,
            project_name=f"Job {job.id}",
            annotations=annotations,
        )
    else:
        wall_name = job.plans[0].name if job.plans else "Sample Wall"
        create_wall_ifc(
            artifact_path,
            project_name=f"Job {job.id}",
            wall_name=wall_name,
            wall_length_m=max(4.0, float(max(1, len(job.plans))) * 2.0),
        )

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
    job_id = str(uuid4())
    plans: list[PlanRecord] = []

    for plan in sorted(payload.plans, key=lambda item: item.storey_index):
        pdf_filename, size_label = write_plan_pdf(
            JOB_DATA_DIR,
            job_id,
            plan.plan_id,
            plan.pdf_data_base64,
        )
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
