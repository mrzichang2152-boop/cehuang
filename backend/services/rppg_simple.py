# 测谎系统 - 简易 rPPG（纯 numpy，无额外依赖）
# 从人脸视频帧序列提取绿色通道均值，FFT 得到主频 → BPM
# 用于无 FacePhys/pyVHR 时的可运行实现

from __future__ import annotations

import base64
import tempfile
from pathlib import Path

import numpy as np

# 可选：用 cv2 读视频或解码帧；若无 opencv 则从帧列表计算
try:
    import cv2
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

# 典型参数：10fps，至少 5s → 50 帧
MIN_FRAMES = 30
FPS_DEFAULT = 10
BPM_MIN, BPM_MAX = 42, 240  # 对应 0.7–4 Hz


def _frames_from_list(rgb_frames: list[np.ndarray]) -> np.ndarray:
    """从 RGB 帧列表取人脸 ROI 的绿色通道均值序列。"""
    if not rgb_frames:
        return np.array([])
    # 简单取中心 50% 区域作为“人脸”ROI
    signals = []
    for f in rgb_frames:
        if f.ndim != 3 or f.shape[2] < 3:
            continue
        h, w = f.shape[:2]
        y1, y2 = int(h * 0.25), int(h * 0.75)
        x1, x2 = int(w * 0.25), int(w * 0.75)
        roi = f[y1:y2, x1:x2, 1]  # 绿色通道
        signals.append(np.mean(roi))
    return np.array(signals, dtype=float)


def _bpm_from_signal(signal: np.ndarray, fps: float) -> float | None:
    """对 1D 信号做 FFT，取 0.7–4 Hz 内主频并转为 BPM。"""
    n = len(signal)
    if n < MIN_FRAMES:
        return None
    # 去趋势
    signal = signal - np.mean(signal)
    # 汉宁窗
    window = np.hanning(n)
    signal = signal * window
    # FFT
    fft = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(n, 1.0 / fps)
    # 0.7–4 Hz 对应 BPM 42–240
    mask = (freqs >= BPM_MIN / 60.0) & (freqs <= BPM_MAX / 60.0)
    if not np.any(mask):
        return None
    power = np.abs(fft[mask]) ** 2
    idx = np.argmax(power)
    peak_freq = freqs[mask][idx]
    bpm = peak_freq * 60.0
    return float(np.clip(bpm, BPM_MIN, BPM_MAX))


def estimate_bpm_from_frames(rgb_frames: list[np.ndarray], fps: float = FPS_DEFAULT) -> float | None:
    """从 RGB 帧列表估计 BPM。"""
    sig = _frames_from_list(rgb_frames)
    return _bpm_from_signal(sig, fps)


def decode_frame_base64(b64: str) -> np.ndarray | None:
    """将 base64 图片解码为 RGB numpy (H,W,3)。"""
    try:
        raw = base64.b64decode(b64)
        if HAS_CV2:
            buf = np.frombuffer(raw, dtype=np.uint8)
            img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            if img is not None:
                return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        return None
    except Exception:
        return None
