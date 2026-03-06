"""壁セグメント間のギャップからドア・窓を推定するモジュール。

壁線が途切れている箇所（ギャップ）を検出し、ギャップ幅に基づいて
ドア (0.6m〜1.2m) または窓 (0.4m〜2.5m) に分類する。
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

# --- 分類しきい値 (メートル) ---
DOOR_MIN_M = 0.6
DOOR_MAX_M = 1.2
WINDOW_MIN_M = 0.4
WINDOW_MAX_M = 2.5

# --- 幾何パラメータ (ピクセル) ---
COLLINEAR_TOLERANCE_PX = 10.0  # 同一直線上とみなす垂直距離の許容値
MIN_GAP_PX = 4.0  # これ未満のギャップは無視


@dataclass
class Opening:
    """検出された開口（ドアまたは窓）。"""

    x1_px: float
    y1_px: float
    x2_px: float
    y2_px: float
    opening_type: Literal["door", "window"]
    gap_m: float  # ギャップの実寸幅


def _classify_gap(gap_m: float) -> Literal["door", "window"] | None:
    """ギャップ幅（メートル）からドア/窓/無視を判定する。

    ドア範囲 (0.6〜1.2m) を優先し、ドア範囲外で窓範囲 (0.4〜2.5m) 内なら窓。
    """
    if DOOR_MIN_M <= gap_m <= DOOR_MAX_M:
        return "door"
    if WINDOW_MIN_M <= gap_m <= WINDOW_MAX_M:
        return "window"
    return None


def _segment_is_horizontal(segment: dict[str, float]) -> bool:
    dx = abs(segment["x2_px"] - segment["x1_px"])
    dy = abs(segment["y2_px"] - segment["y1_px"])
    return dx >= dy


def _band_key(value: float, band_size: float) -> int:
    return int(round(value / band_size))


def detect_openings(
    wall_segments: list[dict[str, float]],
    px_to_m: float | None,
) -> list[Opening]:
    """壁セグメント群からドア・窓を推定する。

    Parameters
    ----------
    wall_segments:
        壁セグメントのリスト。各要素は {x1_px, y1_px, x2_px, y2_px} を持つ。
    px_to_m:
        ピクセル→メートル変換係数。None または 0 以下の場合はフォールバック値
        (0.001) を使用するが、分類精度は低下する。

    Returns
    -------
    検出された Opening のリスト。
    """
    if not wall_segments:
        return []

    effective_px_to_m = float(px_to_m) if px_to_m and px_to_m > 0 else 0.001

    # 水平・垂直に分類
    horizontals: list[dict[str, float]] = []
    verticals: list[dict[str, float]] = []

    for seg in wall_segments:
        # 正規化: 始点 < 終点にする
        if _segment_is_horizontal(seg):
            normalized = {
                "x1_px": min(seg["x1_px"], seg["x2_px"]),
                "y1_px": (seg["y1_px"] + seg["y2_px"]) * 0.5,
                "x2_px": max(seg["x1_px"], seg["x2_px"]),
                "y2_px": (seg["y1_px"] + seg["y2_px"]) * 0.5,
            }
            horizontals.append(normalized)
        else:
            normalized = {
                "x1_px": (seg["x1_px"] + seg["x2_px"]) * 0.5,
                "y1_px": min(seg["y1_px"], seg["y2_px"]),
                "x2_px": (seg["x1_px"] + seg["x2_px"]) * 0.5,
                "y2_px": max(seg["y1_px"], seg["y2_px"]),
            }
            verticals.append(normalized)

    openings: list[Opening] = []

    # --- 水平セグメントのギャップ検出 ---
    h_groups: dict[int, list[dict[str, float]]] = defaultdict(list)
    for seg in horizontals:
        key = _band_key(seg["y1_px"], COLLINEAR_TOLERANCE_PX)
        h_groups[key].append(seg)

    for group in h_groups.values():
        # x座標でソート
        ordered = sorted(group, key=lambda s: s["x1_px"])
        for i in range(len(ordered) - 1):
            current = ordered[i]
            nxt = ordered[i + 1]

            # ギャップ = 次のセグメントの始点 − 現在のセグメントの終点
            gap_px = nxt["x1_px"] - current["x2_px"]
            if gap_px < MIN_GAP_PX:
                continue

            gap_m = gap_px * effective_px_to_m
            opening_type = _classify_gap(gap_m)
            if opening_type is None:
                continue

            # ギャップの中央 y 座標
            avg_y = (current["y1_px"] + nxt["y1_px"]) * 0.5
            openings.append(
                Opening(
                    x1_px=current["x2_px"],
                    y1_px=avg_y,
                    x2_px=nxt["x1_px"],
                    y2_px=avg_y,
                    opening_type=opening_type,
                    gap_m=gap_m,
                )
            )

    # --- 垂直セグメントのギャップ検出 ---
    v_groups: dict[int, list[dict[str, float]]] = defaultdict(list)
    for seg in verticals:
        key = _band_key(seg["x1_px"], COLLINEAR_TOLERANCE_PX)
        v_groups[key].append(seg)

    for group in v_groups.values():
        # y座標でソート
        ordered = sorted(group, key=lambda s: s["y1_px"])
        for i in range(len(ordered) - 1):
            current = ordered[i]
            nxt = ordered[i + 1]

            gap_px = nxt["y1_px"] - current["y2_px"]
            if gap_px < MIN_GAP_PX:
                continue

            gap_m = gap_px * effective_px_to_m
            opening_type = _classify_gap(gap_m)
            if opening_type is None:
                continue

            avg_x = (current["x1_px"] + nxt["x1_px"]) * 0.5
            openings.append(
                Opening(
                    x1_px=avg_x,
                    y1_px=current["y2_px"],
                    x2_px=avg_x,
                    y2_px=nxt["y1_px"],
                    opening_type=opening_type,
                    gap_m=gap_m,
                )
            )

    return openings
