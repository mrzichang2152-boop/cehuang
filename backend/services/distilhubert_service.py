# 测谎系统 - 语调/情绪分析
# 优先使用 emotion2vec+ 输出 9 类情绪分数；不可用时回退到传统声学特征。

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from backend.models import ToneResult, EMOTION_KEYS

logger = logging.getLogger(__name__)

try:
    import scipy.io.wavfile as wavfile
    import scipy.signal as signal
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

# emotion2vec+ 顺序与 EMOTION_KEYS 一致（模型卡 0-8）
_EMOTION_ORDER = list(EMOTION_KEYS)


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
            logger.warning("ffmpeg failed (rc=%d): %s", result.returncode,
                           (result.stderr or b"").decode(errors="replace")[:300])
            return None
        logger.debug("ffmpeg OK: %s → %s", audio_path, tmp.name)
        return tmp.name
    except Exception:
        logger.exception("_to_wav exception")
        return None


def _emotion2vec_scores(wav_path: str) -> dict[str, float] | None:
    """使用 emotion2vec+ 推理，返回 9 类情绪分数。失败返回 None。"""
    try:
        from funasr import AutoModel
    except ImportError:
        logger.warning("funasr 未安装，跳过 emotion2vec+；将使用声学特征回退")
        return None

    model = _get_emotion2vec_model()
    if model is None:
        logger.warning("emotion2vec 模型未加载，跳过")
        return None

    try:
        import tempfile as _tmp
        out_dir = _tmp.mkdtemp(prefix="emotion2vec_")
        res = model.generate(wav_path, output_dir=out_dir, granularity="utterance", extract_embedding=False)
        try:
            import shutil
            shutil.rmtree(out_dir, ignore_errors=True)
        except Exception:
            pass
        if not res or not isinstance(res, list) or len(res) == 0:
            return None
        item = res[0]
        labels = item.get("labels") or []
        scores = item.get("scores") or []
        out = {k: 0.0 for k in _EMOTION_ORDER}
        if labels and scores:
            for lab, sc in zip(labels, scores):
                name = (lab.split("/")[-1] if "/" in str(lab) else str(lab)).strip().lower()
                if name == "<unk>":
                    name = "unknown"
                if name in out:
                    out[name] = round(float(sc), 4)
        # 若 scores 为顺序列表（按 0-8）
        if not any(out.values()) and scores and len(scores) >= len(_EMOTION_ORDER):
            for i, key in enumerate(_EMOTION_ORDER):
                if i < len(scores):
                    out[key] = round(float(scores[i]), 4)
        return out
    except Exception:
        logger.debug("emotion2vec+ 推理失败", exc_info=True)
        return None


_emotion2vec_model = None


def _get_emotion2vec_model():
    """懒加载 emotion2vec+ base 模型。"""
    global _emotion2vec_model
    if _emotion2vec_model is not None:
        return _emotion2vec_model
    try:
        from funasr import AutoModel
        logger.info("加载 emotion2vec+ base …")
        _emotion2vec_model = AutoModel(model="iic/emotion2vec_plus_base")
        logger.info("emotion2vec+ base 已加载")
        return _emotion2vec_model
    except Exception:
        logger.warning("emotion2vec+ 加载失败，将使用声学特征回退", exc_info=True)
        return None


def _compute_tone_score_fallback(wav_path: str) -> float:
    """传统声学特征紧张度（回退用）。"""
    if not HAS_SCIPY:
        return _numpy_tone_score(wav_path)
    try:
        rate, data = wavfile.read(wav_path)
    except Exception:
        return 0.0
    if data.ndim > 1:
        data = data[:, 0]
    data = data.astype(float)
    if len(data) < rate * 0.5:
        return 0.0
    max_val = np.max(np.abs(data)) + 1e-9
    data = data / max_val
    rms = float(np.sqrt(np.mean(data ** 2)))
    signs = np.sign(data)
    zcr = float(np.mean(np.abs(np.diff(signs)) / 2))
    frame_size = int(rate * 0.02)
    frames = [data[i:i + frame_size] for i in range(0, len(data) - frame_size, frame_size)]
    energy_var = float(np.var([np.mean(f ** 2) for f in frames])) if frames else 0.0
    try:
        freqs, psd = signal.welch(data, fs=rate, nperseg=min(1024, len(data)))
        centroid_norm = min(1.0, float(np.sum(freqs * psd) / (np.sum(psd) + 1e-9)) / 4000.0) if psd.sum() > 0 else 0.0
    except Exception:
        centroid_norm = 0.0
    score = (
        min(1.0, rms / 0.3) * 0.35 +
        min(1.0, zcr / 0.15) * 0.25 +
        min(1.0, energy_var * 200) * 0.20 +
        centroid_norm * 0.20
    )
    return float(score)


def _synthesize_emotion_scores(tone_score: float) -> dict[str, float]:
    """
    当 emotion2vec 不可用时，根据声学紧张度合成一组近似情绪分布，
    避免前端 9 类情绪条全部为 0%。
    """
    calm = max(0.0, 1.0 - tone_score * 1.5)
    nervous = min(1.0, tone_score * 1.2)
    return {
        "angry":     round(nervous * 0.35, 4),
        "disgusted": round(nervous * 0.10, 4),
        "fearful":   round(nervous * 0.55, 4),
        "happy":     round(calm * 0.20, 4),
        "neutral":   round(calm * 0.80, 4),
        "other":     round(0.05, 4),
        "sad":       round(nervous * 0.15, 4),
        "surprised": round(nervous * 0.20, 4),
        "unknown":   0.0,
    }


def _numpy_tone_score(wav_path: str) -> float:
    try:
        with open(wav_path, "rb") as f:
            raw = np.frombuffer(f.read()[44:], dtype=np.int16).astype(float)
        if len(raw) < 1000:
            return 0.0
        raw /= 32768.0
        return min(1.0, float(np.sqrt(np.mean(raw ** 2))) / 0.3)
    except Exception:
        return 0.0


def analyze_segments(wav_path: str, segment_sec: float = 3.0) -> list[dict]:
    """
    将 WAV 文件按 segment_sec 秒切片，对每片运行情绪分析，
    返回 [{start, end, emotion_scores, dominant_emotion, dominant_score}]。
    """
    if not HAS_SCIPY:
        return []
    try:
        rate, data = wavfile.read(wav_path)
    except Exception:
        logger.exception("analyze_segments: wavfile.read failed")
        return []
    if data.ndim > 1:
        data = data[:, 0]
    total_samples = len(data)
    seg_samples = int(rate * segment_sec)
    if seg_samples < 1 or total_samples < rate * 0.3:
        return []

    segments = []
    idx = 0
    while idx < total_samples:
        end_idx = min(idx + seg_samples, total_samples)
        if end_idx - idx < int(rate * 0.3):
            break
        seg_data = data[idx:end_idx]
        start_t = round(idx / rate, 3)
        end_t = round(end_idx / rate, 3)

        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        try:
            wavfile.write(tmp.name, rate, seg_data)
            scores = _emotion2vec_scores(tmp.name)
            if not scores:
                tone_s = _compute_tone_score_fallback(tmp.name)
                scores = _synthesize_emotion_scores(round(min(1.0, max(0.0, tone_s)), 4))
        finally:
            Path(tmp.name).unlink(missing_ok=True)

        dominant = max(scores, key=scores.get) if scores else "unknown"
        segments.append({
            "start": start_t,
            "end": end_t,
            "emotion_scores": scores,
            "dominant_emotion": dominant,
            "dominant_score": round(scores.get(dominant, 0), 4),
        })
        idx = end_idx

    return segments


def analyze_audio_file(audio_path: str | Path, segment_sec: float = 3.0) -> dict:
    """
    完整分析一个音频文件：转 WAV → 获取时长 → 分段情绪分析。
    返回 {duration, sample_rate, segments: [...], waveform: [float]}。
    """
    wav_path = _to_wav(audio_path)
    if wav_path is None:
        return {"duration": 0, "sample_rate": 16000, "segments": [], "waveform": []}

    try:
        rate, data = wavfile.read(wav_path) if HAS_SCIPY else (16000, np.array([]))
    except Exception:
        return {"duration": 0, "sample_rate": 16000, "segments": [], "waveform": []}

    if data.ndim > 1:
        data = data[:, 0]
    duration = round(len(data) / rate, 3) if rate > 0 else 0

    segments = analyze_segments(wav_path, segment_sec=segment_sec)

    target_points = min(4000, len(data))
    if target_points > 0 and len(data) > 0:
        step = max(1, len(data) // target_points)
        waveform = (data[::step].astype(float) / (np.max(np.abs(data)) + 1e-9)).tolist()
    else:
        waveform = []

    Path(wav_path).unlink(missing_ok=True)
    return {
        "duration": duration,
        "sample_rate": rate,
        "segments": segments,
        "waveform": [round(v, 4) for v in waveform],
    }


def analyze_tone(audio_path: str | Path) -> ToneResult:
    """
    分析语调/情绪。优先用 emotion2vec+ 输出 9 类情绪分数；
    不可用时用传统声学特征得到单一紧张度，并合成近似情绪分布。
    """
    try:
        wav_path = _to_wav(audio_path)
        if wav_path is None:
            logger.warning("analyze_tone: ffmpeg 转 WAV 失败 (audio=%s)", audio_path)
            return ToneResult(tone_score=0.0, emotion_scores=_synthesize_emotion_scores(0.0))

        emotion_scores = _emotion2vec_scores(wav_path)
        if emotion_scores:
            tone_score = round(min(1.0, max(0.0, max(emotion_scores.values()) if emotion_scores else 0.0)), 4)
            Path(wav_path).unlink(missing_ok=True)
            logger.info("analyze_tone: emotion2vec OK, tone=%.3f", tone_score)
            return ToneResult(tone_score=tone_score, emotion_scores=emotion_scores)

        score = _compute_tone_score_fallback(wav_path)
        Path(wav_path).unlink(missing_ok=True)
        score = round(min(1.0, max(0.0, score)), 4)
        logger.info("analyze_tone: fallback acoustic, tone=%.3f", score)
        return ToneResult(tone_score=score, emotion_scores=_synthesize_emotion_scores(score))
    except Exception:
        logger.exception("analyze_tone failed")
        return ToneResult(tone_score=0.0, emotion_scores=_synthesize_emotion_scores(0.0))
