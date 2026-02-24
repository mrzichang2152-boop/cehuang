# 测谎系统 - 心率分析（FacePhys / rPPG）
# 详见 docs/OPENSOURCE_STACK.md §2
# 支持：帧列表 + 简易 rPPG（numpy）；或视频文件路径 + 未来 FacePhys

from __future__ import annotations

from pathlib import Path
from typing import List

import numpy as np

from backend.models import HeartRateResult

try:
    from backend.services.rppg_simple import estimate_bpm_from_frames
    HAS_SIMPLE_RPPG = True
except Exception:
    HAS_SIMPLE_RPPG = False


def estimate_heart_rate(
    video_path: str | Path | None = None,
    frames: List[np.ndarray] | None = None,
    baseline_bpm: float | None = None,
    fps: float = 10,
) -> HeartRateResult:
    """
    从人脸视频或帧列表估计心率。
    frames: RGB 帧列表 (H,W,3)，优先使用；fps 为帧率。
    video_path: 视频文件路径（可选，当前未实现文件版）。
    baseline_bpm：会话前段基线，用于比较得到 heart_rate_score。
    """
    bpm = None
    if frames and HAS_SIMPLE_RPPG:
        try:
            bpm = estimate_bpm_from_frames(frames, fps=fps)
        except Exception:
            pass
    if bpm is None and video_path:
        try:
            bpm = _run_rppg_impl(video_path)
        except Exception:
            pass

    if bpm is None:
        return HeartRateResult(heart_rate_score=0.0)

    # 基线已建立时：偏差得分；否则用绝对值（正常静息 70bpm）
    if baseline_bpm is not None and baseline_bpm > 0:
        diff = bpm - baseline_bpm
        heart_rate_score = min(1.0, max(0.0, 0.5 + diff / 20.0))
    else:
        # 70bpm 为正常参考值；超过则提高得分
        diff = max(0.0, bpm - 70.0)
        heart_rate_score = min(1.0, diff / 30.0)

    return HeartRateResult(
        bpm=round(bpm, 1),
        heart_rate_score=round(heart_rate_score, 4),
    )


def _run_rppg_impl(video_path: str | Path) -> float | None:
    """视频文件版 rPPG；未实现时返回 None。"""
    return None
