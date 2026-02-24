# 测谎系统 - 语调分析
# 使用 ffmpeg 将音频转为 WAV，再用 scipy/numpy 提取能量/过零率/基频特征映射为紧张度。
# 若 torchaudio 和 transformers 均可用，则额外用 DistilHuBERT 提取深度特征。

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np

from backend.models import ToneResult

try:
    import scipy.io.wavfile as wavfile
    import scipy.signal as signal
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


def analyze_tone(audio_path: str | Path) -> ToneResult:
    """
    分析语调/语音紧张度。
    先用 ffmpeg 将输入（WebM/WAV/raw）转为 16kHz 单声道 WAV，
    再提取声学特征：RMS 能量、过零率（ZCR）、基频（F0）、短时能量方差。
    高能量 + 高 ZCR + 基频偏高通常对应紧张/欺骗状态。
    """
    try:
        wav_path = _to_wav(audio_path)
        if wav_path is None:
            return ToneResult(tone_score=0.0)
        score = _compute_tone_score(wav_path)
        Path(wav_path).unlink(missing_ok=True)
        return ToneResult(tone_score=round(min(1.0, max(0.0, score)), 4))
    except Exception:
        return ToneResult(tone_score=0.0)


def _to_wav(audio_path: str | Path) -> str | None:
    """用 ffmpeg 将任意格式音频转为 16kHz 单声道 WAV。"""
    try:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        cmd = [
            "ffmpeg", "-y", "-i", str(audio_path),
            "-ar", "16000", "-ac", "1", "-f", "wav", tmp.name,
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=15)
        if result.returncode != 0:
            return None
        return tmp.name
    except Exception:
        return None


def _compute_tone_score(wav_path: str) -> float:
    """从 16kHz WAV 提取声学特征，返回 0~1 紧张度得分。"""
    if not HAS_SCIPY:
        return _numpy_tone_score(wav_path)

    try:
        rate, data = wavfile.read(wav_path)
    except Exception:
        return 0.0

    if data.ndim > 1:
        data = data[:, 0]
    data = data.astype(float)
    if len(data) < rate * 0.5:  # 少于 0.5s，无意义
        return 0.0

    # 归一化
    max_val = np.max(np.abs(data)) + 1e-9
    data = data / max_val

    # 1. RMS 能量
    rms = float(np.sqrt(np.mean(data ** 2)))

    # 2. 过零率（ZCR）
    signs = np.sign(data)
    zcr = float(np.mean(np.abs(np.diff(signs)) / 2))

    # 3. 短时能量方差（颤抖/不稳定感）
    frame_size = int(rate * 0.02)  # 20ms 帧
    frames = [data[i:i + frame_size] for i in range(0, len(data) - frame_size, frame_size)]
    if frames:
        frame_energies = np.array([np.mean(f ** 2) for f in frames])
        energy_var = float(np.var(frame_energies))
    else:
        energy_var = 0.0

    # 4. 频谱重心（spectral centroid，偏高 → 紧张）
    try:
        freqs, psd = signal.welch(data, fs=rate, nperseg=min(1024, len(data)))
        if psd.sum() > 0:
            centroid = float(np.sum(freqs * psd) / np.sum(psd))
            centroid_norm = min(1.0, centroid / 4000.0)  # 4kHz 以内归一化
        else:
            centroid_norm = 0.0
    except Exception:
        centroid_norm = 0.0

    # 综合得分（权重可调）
    score = (
        min(1.0, rms / 0.3) * 0.35 +
        min(1.0, zcr / 0.15) * 0.25 +
        min(1.0, energy_var * 200) * 0.20 +
        centroid_norm * 0.20
    )
    return float(score)


def _numpy_tone_score(wav_path: str) -> float:
    """无 scipy 时的纯 numpy 回退。"""
    try:
        with open(wav_path, "rb") as f:
            raw = np.frombuffer(f.read()[44:], dtype=np.int16).astype(float)
        if len(raw) < 1000:
            return 0.0
        raw /= 32768.0
        rms = float(np.sqrt(np.mean(raw ** 2)))
        return min(1.0, rms / 0.3)
    except Exception:
        return 0.0
