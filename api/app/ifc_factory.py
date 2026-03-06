from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import ifcopenshell
import ifcopenshell.api.aggregate as aggregate
import ifcopenshell.api.context as context
import ifcopenshell.api.geometry as geometry
import ifcopenshell.api.project as project
import ifcopenshell.api.root as root
import ifcopenshell.api.spatial as spatial
import ifcopenshell.api.unit as unit


def _setup_model(project_name: str):
    model = project.create_file(version="IFC4")

    ifc_project = root.create_entity(model, ifc_class="IfcProject", name=project_name)
    site = root.create_entity(model, ifc_class="IfcSite", name="Default Site")
    building = root.create_entity(model, ifc_class="IfcBuilding", name="Default Building")

    unit.assign_unit(
        model,
        length={"is_metric": True, "raw": "METERS"},
        area={"is_metric": True, "raw": "METERS"},
        volume={"is_metric": True, "raw": "METERS"},
    )

    model_context = context.add_context(model, context_type="Model")
    body_context = context.add_context(
        model,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=model_context,
    )

    aggregate.assign_object(model, products=[site], relating_object=ifc_project)
    aggregate.assign_object(model, products=[building], relating_object=site)

    geometry.edit_object_placement(model, product=site, matrix=np.eye(4))
    geometry.edit_object_placement(model, product=building, matrix=np.eye(4))

    return model, building, body_context


class IfcGenerationError(Exception):
    """IFC 生成処理で回復不能なエラーが発生した場合に送出する。"""

    def __init__(self, message: str, *, detail: str | None = None):
        super().__init__(message)
        self.detail = detail or message


# px_to_m が未設定のときに使う仮のスケール (1 px = 1 mm)。
# ユーザーがスケール校正を行うまでの暫定値であり、表示はされるが
# 寸法は正確ではない旨を承知のうえで使う。
_FALLBACK_PX_TO_M = 0.001


def create_ifc_from_annotations(
    destination: Path,
    *,
    project_name: str,
    annotations: dict[str, Any],
    default_storey_height_m: float = 3.0,
    start_level: str | None = None,
) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)

    model, building, body_context = _setup_model(project_name)
    plans = sorted(annotations.get("plans", []), key=lambda plan: plan.get("storey_index", 0))
    # `start_level` defines elevation offset for the first uploaded plan:
    # ground=0F, basement=-1F, upper=+1F. Unknown values fallback to ground.
    start_level_offset = {
        "ground": 0,
        "basement": -1,
        "upper": 1,
    }.get(start_level or "ground", 0)

    total_walls_created = 0
    skipped_plans_no_scale: list[str] = []

    for plan in plans:
        storey_index = int(plan.get("storey_index", 0))
        storey_name = str(plan.get("plan_name") or f"Storey {storey_index + 1}")
        storey = root.create_entity(model, ifc_class="IfcBuildingStorey", name=storey_name)
        aggregate.assign_object(model, products=[storey], relating_object=building)
        geometry.edit_object_placement(model, product=storey, matrix=np.eye(4))

        raw_px_to_m = plan.get("px_to_m")
        px_to_m = float(raw_px_to_m) if raw_px_to_m is not None and float(raw_px_to_m) > 0 else 0.0
        wall_height_m = float(plan.get("wall_height_m") or 2.4)
        wall_thickness_m = float(plan.get("wall_thickness_m") or 0.12)
        storey_elevation_m = float(storey_index + start_level_offset) * default_storey_height_m

        segments = plan.get("segments", [])

        # px_to_m が未設定でもセグメントがある場合はフォールバックスケールを使う。
        # これにより「スケール未校正だがセグメント検出済み」のケースでも
        # viewer が表示可能な geometry を持つ IFC が生成される。
        if px_to_m <= 0 and segments:
            px_to_m = _FALLBACK_PX_TO_M
            skipped_plans_no_scale.append(storey_name)

        if px_to_m <= 0:
            continue

        for segment_index, segment in enumerate(segments, start=1):
            x1_m = float(segment["x1_px"]) * px_to_m
            y1_m = float(segment["y1_px"]) * px_to_m
            x2_m = float(segment["x2_px"]) * px_to_m
            y2_m = float(segment["y2_px"]) * px_to_m

            if abs(x1_m - x2_m) < 1e-6 and abs(y1_m - y2_m) < 1e-6:
                continue

            wall = root.create_entity(
                model,
                ifc_class="IfcWall",
                name=f"{storey_name} Wall {segment_index}",
            )
            spatial.assign_container(model, products=[wall], relating_structure=storey)
            wall_representation = geometry.create_2pt_wall(
                model,
                element=wall,
                context=body_context,
                p1=(x1_m, y1_m),
                p2=(x2_m, y2_m),
                elevation=storey_elevation_m,
                height=wall_height_m,
                thickness=wall_thickness_m,
                is_si=True,
            )
            geometry.assign_representation(model, product=wall, representation=wall_representation)
            total_walls_created += 1

    # --- 生成後 validation ---
    # geometry がゼロの IFC は viewer 側で mergeBufferGeometries クラッシュを
    # 引き起こすため、ここで検出して明示エラーにする。
    if total_walls_created == 0:
        total_segments = sum(len(p.get("segments", [])) for p in plans)
        raise IfcGenerationError(
            "表示可能な壁ジオメトリが生成されませんでした。",
            detail=(
                f"plans={len(plans)}, "
                f"total_segments={total_segments}, "
                f"skipped_no_scale={skipped_plans_no_scale}"
            ),
        )

    model.write(str(destination))
    return destination


def create_wall_ifc(
    destination: Path,
    *,
    project_name: str,
    wall_name: str = "Sample Wall",
    wall_length_m: float = 4.0,
    wall_height_m: float = 3.0,
    wall_thickness_m: float = 0.2,
) -> Path:
    return create_ifc_from_annotations(
        destination,
        project_name=project_name,
        annotations={
            "plans": [
                {
                    "plan_id": "sample-plan",
                    "plan_name": "Ground Floor",
                    "storey_index": 0,
                    "px_to_m": 1.0,
                    "wall_height_m": wall_height_m,
                    "wall_thickness_m": wall_thickness_m,
                    "segments": [
                        {
                            "id": "sample-wall",
                            "x1_px": 0.0,
                            "y1_px": 0.0,
                            "x2_px": wall_length_m,
                            "y2_px": 0.0,
                        }
                    ],
                }
            ]
        },
    )
