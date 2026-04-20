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
RPPG_MIN_SAMPLES = 150    # 15s × 10fps
RPPG_MAX_SAMPLES = 600    # 最多保留 60s 数据
BPM_MIN, BPM_MAX = 50, 180
# 带通滤波参数（心率频段 0.75–3.0 Hz = 45–180 bpm）
_BP_LOW = 0.75   # Hz
_BP_HIGH = 3.0   # Hz

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


def _butter_bandpass(data: np.ndarray, low: float, high: float, fs: float, order: int = 3) -> np.ndarray:
    """Butterworth 带通滤波，去除心率频段外的噪声。"""
    try:
        from scipy.signal import butter, filtfilt
        nyq = 0.5 * fs
        b, a = butter(order, [low / nyq, high / nyq], btype='band')
        return filtfilt(b, a, data)
    except ImportError:
        return data


def _estimate_bpm_from_green(signal: list, fps: float) -> Optional[float]:
    """对绿色通道序列做带通滤波 + FFT，取心率频段内峰值。"""
    arr = np.array(signal, dtype=float)
    n = len(arr)
    if n < RPPG_MIN_SAMPLES:
        return None

    # 1) 去线性趋势（而非仅去均值）
    x = np.arange(n, dtype=float)
    coeffs = np.polyfit(x, arr, 1)
    arr -= np.polyval(coeffs, x)

    # 2) 带通滤波：只保留心率频段 (0.75–3.0 Hz)
    arr = _butter_bandpass(arr, _BP_LOW, _BP_HIGH, fps)

    # 3) 汉宁窗 + FFT
    arr *= np.hanning(n)
    fft_vals = np.fft.rfft(arr)
    freqs = np.fft.rfftfreq(n, d=1.0 / fps)
    mask = (freqs >= BPM_MIN / 60.0) & (freqs <= BPM_MAX / 60.0)
    if not np.any(mask):
        return None
    power = np.abs(fft_vals[mask]) ** 2

    # 4) 对 60–100 bpm 范围（正常静息心率）施加轻微加权，抑制边缘异常峰
    masked_freqs = freqs[mask]
    weight = np.ones_like(power)
    normal_mask = (masked_freqs >= 1.0) & (masked_freqs <= 1.67)  # 60–100 bpm
    weight[normal_mask] *= 1.3
    weighted_power = power * weight

    peak_freq = masked_freqs[np.argmax(weighted_power)]
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
    sample = {
        "t": _now_iso(),
        "lie_probability": result.lie_probability,
        "expression": result.dimensions.expression,
        "heart_rate": result.dimensions.heart_rate,
        "tone": result.dimensions.tone,
        "semantic": result.dimensions.semantic,
        "semantic_summary": result.semantic_summary,
    }
    sample["emotion_scores"] = result.dimensions.emotion_scores or {}
    append_timeline_sample(session_id, sample)
    return result


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def analyze_tone_from_b64(audio_b64: str):
    raw = base64.b64decode(audio_b64)
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(raw)
        path = f.name
    logger.info("analyze_tone_from_b64: saved %d bytes to %s", len(raw), path)
    try:
        return analyze_tone(path)
    finally:
        Path(path).unlink(missing_ok=True)


def clear_session_buffers(session_id: str) -> None:
    _green_buffers.pop(session_id, None)
    _baseline_bpm.pop(session_id, None)
    _last_bpm.pop(session_id, None)
