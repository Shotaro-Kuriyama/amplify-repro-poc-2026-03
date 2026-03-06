from __future__ import annotations

import math
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2
import fitz
import numpy as np

MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_RENDER_SIDE_PX = 2600
MAX_IMAGE_PIXELS = 9_000_000
MAX_RETURN_SEGMENTS = 600
DETECTION_TIMEOUT_SECONDS = 10.0
SEGMENT_MIN_LENGTH_PX = 18.0
ORIENTATION_TOLERANCE_DEG = 12.0


class AutoDetectError(Exception):
    def __init__(self, detail: str, status_code: int):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def _elapsed_seconds(started_at: float) -> float:
    return time.monotonic() - started_at


def _ensure_timeout(started_at: float, stage: str) -> None:
    if _elapsed_seconds(started_at) > DETECTION_TIMEOUT_SECONDS:
        raise AutoDetectError(f"線分抽出がタイムアウトしました ({stage})。", status_code=422)


def _segment_length(segment: tuple[float, float, float, float]) -> float:
    x1, y1, x2, y2 = segment
    return math.hypot(x2 - x1, y2 - y1)


def _segment_angle_deg(segment: tuple[float, float, float, float]) -> float:
    x1, y1, x2, y2 = segment
    angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
    if angle < 0:
        angle += 180
    return angle


def _is_preferred_orientation(segment: tuple[float, float, float, float]) -> bool:
    angle = _segment_angle_deg(segment)
    if angle <= ORIENTATION_TOLERANCE_DEG:
        return True
    if abs(angle - 90) <= ORIENTATION_TOLERANCE_DEG:
        return True
    if abs(angle - 180) <= ORIENTATION_TOLERANCE_DEG:
        return True
    return False


def _normalize_to_axis_aligned(segment: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = segment
    if abs(y2 - y1) <= abs(x2 - x1):
        y = (y1 + y2) * 0.5
        left = min(x1, x2)
        right = max(x1, x2)
        return (left, y, right, y)

    x = (x1 + x2) * 0.5
    top = min(y1, y2)
    bottom = max(y1, y2)
    return (x, top, x, bottom)


def _resize_if_needed(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    longest_side = max(width, height)
    pixel_count = width * height

    if longest_side <= MAX_RENDER_SIDE_PX and pixel_count <= MAX_IMAGE_PIXELS:
        return image

    side_scale = MAX_RENDER_SIDE_PX / float(longest_side)
    pixel_scale = math.sqrt(MAX_IMAGE_PIXELS / float(pixel_count))
    scale = min(side_scale, pixel_scale)

    if scale <= 0:
        raise AutoDetectError("画像サイズの制限を超えました。", status_code=413)

    next_width = max(1, int(width * scale))
    next_height = max(1, int(height * scale))
    return cv2.resize(image, (next_width, next_height), interpolation=cv2.INTER_AREA)


def _merge_axis_segments(
    segments: list[tuple[float, float, float, float]],
    *,
    axis: str,
) -> list[tuple[float, float, float, float]]:
    if not segments:
        return []

    band_size = 8.0
    merge_gap = 14.0
    coord_tolerance = 8.0

    grouped: dict[int, list[tuple[float, float, float, float]]] = defaultdict(list)
    for segment in segments:
        if axis == "horizontal":
            key = int(round(segment[1] / band_size))
        else:
            key = int(round(segment[0] / band_size))
        grouped[key].append(segment)

    merged: list[tuple[float, float, float, float]] = []
    for group in grouped.values():
        if axis == "horizontal":
            ordered = sorted(group, key=lambda segment: segment[0])
            current = ordered[0]
            for segment in ordered[1:]:
                if abs(segment[1] - current[1]) <= coord_tolerance and segment[0] <= current[2] + merge_gap:
                    current = (
                        current[0],
                        (current[1] + segment[1]) * 0.5,
                        max(current[2], segment[2]),
                        (current[3] + segment[3]) * 0.5,
                    )
                else:
                    merged.append(current)
                    current = segment
            merged.append(current)
        else:
            ordered = sorted(group, key=lambda segment: segment[1])
            current = ordered[0]
            for segment in ordered[1:]:
                if abs(segment[0] - current[0]) <= coord_tolerance and segment[1] <= current[3] + merge_gap:
                    current = (
                        (current[0] + segment[0]) * 0.5,
                        current[1],
                        (current[2] + segment[2]) * 0.5,
                        max(current[3], segment[3]),
                    )
                else:
                    merged.append(current)
                    current = segment
            merged.append(current)

    return merged


def _is_near_duplicate(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> bool:
    endpoint_tolerance = 14.0
    length_tolerance = 16.0
    angle_tolerance = 6.0

    left_length = _segment_length(left)
    right_length = _segment_length(right)
    if abs(left_length - right_length) > max(length_tolerance, max(left_length, right_length) * 0.2):
        return False

    left_angle = _segment_angle_deg(left)
    right_angle = _segment_angle_deg(right)
    angle_diff = abs(left_angle - right_angle)
    angle_diff = min(angle_diff, 180 - angle_diff)
    if angle_diff > angle_tolerance:
        return False

    left_start = np.array([left[0], left[1]], dtype=np.float32)
    left_end = np.array([left[2], left[3]], dtype=np.float32)
    right_start = np.array([right[0], right[1]], dtype=np.float32)
    right_end = np.array([right[2], right[3]], dtype=np.float32)

    same_order = max(np.linalg.norm(left_start - right_start), np.linalg.norm(left_end - right_end))
    swapped_order = max(np.linalg.norm(left_start - right_end), np.linalg.norm(left_end - right_start))
    return min(float(same_order), float(swapped_order)) <= endpoint_tolerance


def _dedupe_segments(
    segments: list[tuple[float, float, float, float]],
) -> list[tuple[float, float, float, float]]:
    kept: list[tuple[float, float, float, float]] = []
    for segment in sorted(segments, key=_segment_length, reverse=True):
        if any(_is_near_duplicate(segment, existing) for existing in kept):
            continue
        kept.append(segment)
        if len(kept) >= MAX_RETURN_SEGMENTS:
            break
    return kept


def _detect_segments_from_image(
    image: np.ndarray,
    *,
    started_at: float,
) -> list[tuple[float, float, float, float]]:
    _ensure_timeout(started_at, "preprocess")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    thresholded = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        41,
        10,
    )
    edges = cv2.Canny(thresholded, 50, 150, apertureSize=3)

    min_side = float(min(image.shape[0], image.shape[1]))
    min_line_length = max(SEGMENT_MIN_LENGTH_PX, min_side * 0.02)
    max_line_gap = max(12.0, min_side * 0.008)

    raw_lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180.0,
        threshold=80,
        minLineLength=int(min_line_length),
        maxLineGap=int(max_line_gap),
    )

    _ensure_timeout(started_at, "hough")

    if raw_lines is None:
        return []

    filtered: list[tuple[float, float, float, float]] = []
    for line in raw_lines[:, 0]:
        x1, y1, x2, y2 = (float(value) for value in line.tolist())
        candidate = (x1, y1, x2, y2)
        if _segment_length(candidate) < min_line_length:
            continue
        if not _is_preferred_orientation(candidate):
            continue
        filtered.append(_normalize_to_axis_aligned(candidate))

    _ensure_timeout(started_at, "filter")

    horizontal = [segment for segment in filtered if abs(segment[3] - segment[1]) <= abs(segment[2] - segment[0])]
    vertical = [segment for segment in filtered if abs(segment[3] - segment[1]) > abs(segment[2] - segment[0])]

    merged = _merge_axis_segments(horizontal, axis="horizontal") + _merge_axis_segments(vertical, axis="vertical")
    deduped = _dedupe_segments(merged)
    _ensure_timeout(started_at, "merge")
    return deduped


def detect_wall_segments_from_pdf(
    pdf_path: Path,
    *,
    page: int = 1,
    mode: str = "raster",
) -> tuple[list[dict[str, float]], dict[str, Any]]:
    if mode != "raster":
        raise AutoDetectError("mode は raster のみ対応しています。", status_code=400)

    if page != 1:
        raise AutoDetectError("Auto-detect (beta) は page=1 のみ対応しています。", status_code=400)

    if not pdf_path.exists():
        raise AutoDetectError("対象PDFが見つかりません。", status_code=404)

    pdf_size = pdf_path.stat().st_size
    if pdf_size > MAX_PDF_BYTES:
        raise AutoDetectError("PDF サイズが上限(25MB)を超えています。", status_code=413)

    started_at = time.monotonic()

    try:
        with fitz.open(pdf_path) as document:
            if document.page_count < 1:
                raise AutoDetectError("PDF にページが含まれていません。", status_code=422)

            pdf_page = document.load_page(0)
            page_width = float(pdf_page.rect.width)
            page_height = float(pdf_page.rect.height)
            longest_side = max(page_width, page_height, 1.0)
            base_scale = min(4.0, max(1.0, MAX_RENDER_SIDE_PX / longest_side))

            pixmap = pdf_page.get_pixmap(matrix=fitz.Matrix(base_scale, base_scale), alpha=False)
            image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
                pixmap.height,
                pixmap.width,
                pixmap.n,
            )

            if pixmap.n == 1:
                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
            elif pixmap.n == 4:
                image = cv2.cvtColor(image, cv2.COLOR_RGBA2BGR)

            image = _resize_if_needed(image)
            _ensure_timeout(started_at, "render")

            detected_segments = _detect_segments_from_image(image, started_at=started_at)
            image_height, image_width = image.shape[:2]

            projected_segments: list[dict[str, float]] = []
            for x1, y1, x2, y2 in detected_segments:
                projected_segments.append(
                    {
                        "x1_px": max(0.0, min(page_width, (x1 / image_width) * page_width)),
                        "y1_px": max(0.0, min(page_height, (y1 / image_height) * page_height)),
                        "x2_px": max(0.0, min(page_width, (x2 / image_width) * page_width)),
                        "y2_px": max(0.0, min(page_height, (y2 / image_height) * page_height)),
                    }
                )

            return projected_segments, {
                "filtered_count": len(projected_segments),
                "image_size": {
                    "height": int(image_height),
                    "width": int(image_width),
                },
                "method": "opencv-houghlinesp-raster-page1-beta",
            }
    except AutoDetectError:
        raise
    except Exception as exc:  # pragma: no cover - unexpected runtime failure path
        raise AutoDetectError(f"線分抽出に失敗しました: {exc}", status_code=422) from exc
