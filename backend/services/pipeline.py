# 测谎系统 - 单次分析管道
# rPPG 改为使用前端 10fps 绿色通道信号（green_values），不再依赖低频帧缓冲

from __future__ import annotations

import base64
import logging
import tempfile
from pathlib import Path
from typing import List, Optional

import numpy as np

logger = logging.getLogger(__name__)

from backend.models import (
    ExpressionResult,
    HeartRateResult,
    ToneResult,
    SemanticResult,
    FusionResult,
)
from backend.services.openface_service import run_openface_on_image
from backend.services.facephys_service import estimate_heart_rate
from backend.services.distilhubert_service import analyze_tone
from backend.services.qwen_semantic_service import analyze_semantic
from backend.services.fusion_engine import fuse
from backend.store import append_timeline_sample

# ── rPPG 参数 ────────────────────────────────────────────────────────────────
RPPG_FPS = 10.0           # 前端采样频率（100ms 间隔）
# 需要至少 15s 数据（150 个采样点）才能做 FFT 估计心率
RPPG_MIN_SAMPLES = 150    # 15s × 10fps
RPPG_MAX_SAMPLES = 600    # 最多保留 60s 数据
BPM_MIN, BPM_MAX = 42, 180

# ── 会话级缓冲 ───────────────────────────────────────────────────────────────
# session_id -> list[float]，绿色通道均值（10fps）
_green_buffers: dict[str, list] = {}
# session_id -> 基线 BPM
_baseline_bpm: dict[str, float] = {}
# session_id -> 最近一次估计的 BPM（前端展示用）
_last_bpm: dict[str, float] = {}


def get_last_bpm(session_id: str) -> Optional[float]:
    return _last_bpm.get(session_id)


def _ensure_green_buf(session_id: str) -> list:
    if session_id not in _green_buffers:
        _green_buffers[session_id] = []
    return _green_buffers[session_id]


def _estimate_bpm_from_green(signal: list, fps: float) -> Optional[float]:
    """对绿色通道序列做 FFT，取心率频段内峰值。"""
    arr = np.array(signal, dtype=float)
    n = len(arr)
    if n < RPPG_MIN_SAMPLES:
        return None
    # 去线性趋势 + 汉宁窗
    arr -= np.mean(arr)
    arr *= np.hanning(n)
    # FFT
    fft_vals = np.fft.rfft(arr)
    freqs = np.fft.rfftfreq(n, d=1.0 / fps)
    mask = (freqs >= BPM_MIN / 60.0) & (freqs <= BPM_MAX / 60.0)
    if not np.any(mask):
        return None
    power = np.abs(fft_vals[mask]) ** 2
    peak_freq = freqs[mask][np.argmax(power)]
    return float(np.clip(peak_freq * 60.0, BPM_MIN, BPM_MAX))


def run_pipeline(
    session_id: str,
    frame_b64: Optional[str] = None,
    audio_b64: Optional[str] = None,
    text: Optional[str] = None,
    green_values: Optional[List[float]] = None,
) -> FusionResult:
    expression = ExpressionResult(expression_score=0.0)
    heart_rate = HeartRateResult(heart_rate_score=0.0)
    tone = ToneResult(tone_score=0.0)
    semantic = SemanticResult(semantic_score=0.0)

    # 1) 表情：单帧 OpenFace
    if frame_b64:
        try:
            raw = base64.b64decode(frame_b64)
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
                f.write(raw)
                path = f.name
            try:
                expression = run_openface_on_image(path)
            finally:
                Path(path).unlink(missing_ok=True)
        except Exception:
            logger.exception("expression analysis failed")

    # 2) 心率：累积 green_values，达到 15s 后 FFT 估计 BPM
    if green_values:
        buf = _ensure_green_buf(session_id)
        buf.extend(green_values)
        # 只保留最新 RPPG_MAX_SAMPLES 个点
        if len(buf) > RPPG_MAX_SAMPLES:
            del buf[:len(buf) - RPPG_MAX_SAMPLES]
        logger.info("rPPG green buf=%d/%d", len(buf), RPPG_MIN_SAMPLES)

    buf = _ensure_green_buf(session_id)
    if len(buf) >= RPPG_MIN_SAMPLES:
        try:
            bpm = _estimate_bpm_from_green(buf, RPPG_FPS)
            if bpm is not None:
                baseline = _baseline_bpm.get(session_id)
                if baseline is not None and baseline > 0:
                    diff = bpm - baseline
                    score = float(np.clip(0.5 + diff / 20.0, 0.0, 1.0))
                else:
                    diff = max(0.0, bpm - 70.0)
                    score = float(np.clip(diff / 30.0, 0.0, 1.0))
                heart_rate = HeartRateResult(bpm=round(bpm, 1), heart_rate_score=round(score, 4))
                _last_bpm[session_id] = round(bpm, 1)
                logger.info("heart_rate bpm=%.1f score=%.3f", bpm, score)
                if session_id not in _baseline_bpm:
                    _baseline_bpm[session_id] = bpm
        except Exception:
            logger.exception("heart_rate analysis failed")

    # 3) 语调：音频
    if audio_b64:
        try:
            tone = analyze_tone_from_b64(audio_b64)
            logger.info("tone score=%.3f", tone.tone_score)
        except Exception:
            logger.exception("tone analysis failed")

    # 4) 语义：文本
    if (text or "").strip():
        try:
            semantic = analyze_semantic(text.strip())
        except Exception:
            logger.exception("semantic analysis failed")

    result = fuse(expression, heart_rate, tone, semantic)
    append_timeline_sample(session_id, {
        "t": _now_iso(),
        "lie_probability": result.lie_probability,
        "expression": result.dimensions.expression,
        "heart_rate": result.dimensions.heart_rate,
        "tone": result.dimensions.tone,
        "semantic": result.dimensions.semantic,
        "semantic_summary": result.semantic_summary,
    })
    return result


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def analyze_tone_from_b64(audio_b64: str):
    raw = base64.b64decode(audio_b64)
    with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as f:
        f.write(raw)
        path = f.name
    try:
        return analyze_tone(path)
    finally:
        Path(path).unlink(missing_ok=True)


def clear_session_buffers(session_id: str) -> None:
    _green_buffers.pop(session_id, None)
    _baseline_bpm.pop(session_id, None)
    _last_bpm.pop(session_id, None)
