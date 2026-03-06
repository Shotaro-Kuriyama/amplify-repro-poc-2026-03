from __future__ import annotations

import base64
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


def format_file_size(size_bytes: int) -> str:
    if size_bytes < 1024 * 1024:
        return f"{max(1, round(size_bytes / 1024))} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"


@dataclass
class PlanRecord:
    id: str
    name: str
    storey_index: int
    pdf_filename: str
    size_label: str


@dataclass
class JobRecord:
    id: str
    start_level: str
    plans: list[PlanRecord]
    created_at: float
    started_at: float | None = None


def job_dir(root_dir: Path, job_id: str) -> Path:
    return root_dir / job_id


def plans_dir(root_dir: Path, job_id: str) -> Path:
    return job_dir(root_dir, job_id) / "plans"


def job_file(root_dir: Path, job_id: str) -> Path:
    return job_dir(root_dir, job_id) / "job.json"


def annotations_file(root_dir: Path, job_id: str) -> Path:
    return job_dir(root_dir, job_id) / "annotations.json"


def save_job(root_dir: Path, job: JobRecord) -> None:
    target = job_file(root_dir, job.id)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(asdict(job), ensure_ascii=False, indent=2), encoding="utf-8")


def load_job(root_dir: Path, job_id: str) -> JobRecord | None:
    target = job_file(root_dir, job_id)
    if not target.exists():
        return None

    payload = json.loads(target.read_text(encoding="utf-8"))
    plans = [PlanRecord(**plan) for plan in payload["plans"]]
    return JobRecord(
        id=payload["id"],
        start_level=payload["start_level"],
        plans=plans,
        created_at=payload["created_at"],
        started_at=payload.get("started_at"),
    )


def decode_pdf_data_url(data_url: str) -> bytes:
    if "," not in data_url or ";base64" not in data_url:
        raise ValueError("PDFデータの形式が不正です。")

    _, encoded = data_url.split(",", 1)
    return base64.b64decode(encoded)


def write_plan_pdf(root_dir: Path, job_id: str, plan_id: str, pdf_data_url: str) -> tuple[str, str]:
    plan_bytes = decode_pdf_data_url(pdf_data_url)
    target_dir = plans_dir(root_dir, job_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{plan_id}.pdf"
    (target_dir / filename).write_bytes(plan_bytes)
    return filename, format_file_size(len(plan_bytes))


def default_annotations(job: JobRecord) -> dict[str, list[dict[str, Any]]]:
    plans = sorted(job.plans, key=lambda plan: plan.storey_index)
    return {
        "plans": [
            {
                "plan_id": plan.id,
                "plan_name": plan.name,
                "storey_index": plan.storey_index,
                "px_to_m": None,
                "wall_height_m": 2.4,
                "wall_thickness_m": 0.12,
                "segments": [],
            }
            for plan in plans
        ]
    }


def load_annotations(root_dir: Path, job: JobRecord) -> dict[str, list[dict[str, Any]]]:
    target = annotations_file(root_dir, job.id)
    if not target.exists():
        return default_annotations(job)
    return json.loads(target.read_text(encoding="utf-8"))


def save_annotations(root_dir: Path, job_id: str, payload: dict[str, Any]) -> None:
    target = annotations_file(root_dir, job_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
