# 测谎系统 - 实时语音转文字服务
# STT：FireRedASR2-AED (1.1B, CER 3.05%) + FireRedPunc（BERT 标点）
# 2026 年中文 ASR SOTA，显存 ~5GB，自带 beam search + 时间戳 + 置信度

from __future__ import annotations

import base64
import logging
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_PRETRAINED_DIR = _PROJECT_ROOT / "pretrained_models"

sys.path.insert(0, str(_PROJECT_ROOT))

# ─── FireRedASR2-AED + FireRedPunc ───────────────────────────────────────────
import threading as _threading

_asr_model = None
_punc_model = None
_model_lock = _threading.Lock()


def _get_models():
    """懒加载 ASR + Punc 到 GPU，返回 (asr, punc) 元组。"""
    global _asr_model, _punc_model
    if _asr_model is not None and _punc_model is not None:
        return _asr_model, _punc_model
    with _model_lock:
        if _asr_model is None:
            try:
                from fireredasr2s.fireredasr2 import FireRedAsr2, FireRedAsr2Config
                logger.info("Loading FireRedASR2-AED (1.1B) …")
                cfg = FireRedAsr2Config(
                    use_gpu=True,
                    use_half=False,
                    beam_size=3,
                    nbest=1,
                    decode_max_len=0,
                    softmax_smoothing=1.25,
                    aed_length_penalty=0.6,
                    eos_penalty=1.0,
                    return_timestamp=False,
                )
                _asr_model = FireRedAsr2.from_pretrained(
                    "aed",
                    str(_PRETRAINED_DIR / "FireRedASR2-AED"),
                    cfg,
                )
                logger.info("FireRedASR2-AED loaded (GPU)")
            except Exception:
                logger.exception("Failed to load FireRedASR2-AED")
        if _punc_model is None:
            try:
                from fireredasr2s.fireredpunc.punc import FireRedPunc, FireRedPuncConfig
                logger.info("Loading FireRedPunc …")
                _punc_model = FireRedPunc.from_pretrained(
                    str(_PRETRAINED_DIR / "FireRedPunc"),
                    FireRedPuncConfig(use_gpu=True),
                )
                logger.info("FireRedPunc loaded (GPU)")
            except Exception:
                logger.exception("Failed to load FireRedPunc")
    return _asr_model, _punc_model


def _asr_transcribe(wav_path: str) -> str:
    """调用 FireRedASR2-AED 转写，再用 FireRedPunc 加标点。"""
    asr, punc = _get_models()
    if asr is None:
        return ""
    try:
        results = asr.transcribe(["chunk"], [wav_path])
        if not results or not results[0].get("text"):
            return ""
        raw_text = results[0]["text"].strip()
        if not raw_text:
            return ""
        if punc is not None:
            try:
                punc_results = punc.process([raw_text])
                if punc_results and punc_results[0].get("punc_text"):
                    return punc_results[0]["punc_text"].strip()
            except Exception:
                logger.debug("Punc failed, returning raw text", exc_info=True)
        return raw_text
    except Exception:
        logger.exception("FireRedASR2 inference failed")
        return ""


# ─── 音频转换 ────────────────────────────────────────────────────────────────
def _audio_b64_to_wav(audio_b64: str) -> Optional[str]:
    try:
        raw = base64.b64decode(audio_b64)
        if len(raw) < 512:
            return None
        tmp_in = tempfile.mktemp(suffix=".webm")
        tmp_out = tempfile.mktemp(suffix=".wav")
        with open(tmp_in, "wb") as f:
            f.write(raw)
        ret = subprocess.run(
            ["ffmpeg", "-y", "-i", tmp_in,
             "-ar", "16000", "-ac", "1",
             "-acodec", "pcm_s16le",
             "-f", "wav", tmp_out],
            capture_output=True, timeout=20,
        )
        Path(tmp_in).unlink(missing_ok=True)
        if ret.returncode != 0 or not Path(tmp_out).exists():
            return None
        return tmp_out
    except Exception:
        logger.exception("audio conversion failed")
        return None


# ─── 幻觉检测 ────────────────────────────────────────────────────────────────
_HALLUCINATION_RE = re.compile(r'(.{2,8})\1{2,}')

_HALLUCINATION_PHRASES = [
    '普通话对话', '字幕由', '翻译', '谢谢观看', '点击订阅',
    '敬请期待', '本期视频', '感谢收看', '关注我们',
    '字幕组', '制作', '版权', '声明',
]
_ALL_PUNCT_RE = re.compile(r'^[\W\s]+$')
_REPEAT_CHAR_RE = re.compile(r'(.)\1{4,}')

MAX_CHARS_PER_CHUNK = 120


def _is_hallucination(text: str) -> bool:
    t = text.strip()
    if not t:
        return True
    if _ALL_PUNCT_RE.match(t):
        return True
    if _REPEAT_CHAR_RE.search(t):
        return True
    if _HALLUCINATION_RE.search(t):
        return True
    for pat in _HALLUCINATION_PHRASES:
        if pat in t:
            return True
    if len(t) == 1 and t not in '嗯啊哦哈噢唔呢嘛哎吗是的对好':
        return True
    if len(t) > MAX_CHARS_PER_CHUNK:
        logger.debug("hallucination(length): %d chars", len(t))
        return True
    return False


# ─── 近期输出去重 ─────────────────────────────────────────────────────────────
import time as _time
import collections as _collections

_recent_outputs: dict[str, "_collections.deque"] = {}
DEDUP_WINDOW_SECS = 30
DEDUP_SIM_THRESH = 0.85


def _char_sim(a: str, b: str) -> float:
    sa, sb = set(a), set(b)
    inter = len(sa & sb)
    return inter / max(min(len(sa), len(sb)), 1)


def _is_duplicate(session_id: str, text: str) -> bool:
    deq = _recent_outputs.setdefault(session_id,
                                     _collections.deque(maxlen=20))
    now = _time.time()
    while deq and now - deq[0][0] > DEDUP_WINDOW_SECS:
        deq.popleft()
    for ts, prev in deq:
        sim = _char_sim(text, prev)
        if sim >= DEDUP_SIM_THRESH:
            logger.debug("dedup: sim=%.2f, dropped: %r", sim, text[:20])
            return True
    deq.append((now, text))
    return False


# ─── 主入口 ──────────────────────────────────────────────────────────────────
def transcribe(session_id: str, audio_b64: str, speaker: str = "") -> dict:
    """转写音频，speaker 由前端根据麦克风来源传入。"""
    wav_path = None
    try:
        wav_path = _audio_b64_to_wav(audio_b64)
        if not wav_path:
            return {"text": "", "speaker": speaker, "language": "zh"}

        wav_size = Path(wav_path).stat().st_size if Path(wav_path).exists() else 0
        logger.info("[STT] wav size=%d bytes, calling FireRedASR2 …", wav_size)

        text = _asr_transcribe(wav_path)
        logger.info("[STT] result: %r", text[:80] if text else "")

        if _is_hallucination(text):
            logger.debug("hallucination filtered: %r", text)
            text = ""

        if text and _is_duplicate(session_id, text):
            text = ""

        if not text:
            return {"text": "", "speaker": speaker, "language": "zh"}

        return {"text": text, "speaker": speaker or "说话人1", "language": "zh"}

    except Exception:
        logger.exception("transcribe failed")
        return {"text": "", "speaker": speaker, "language": "zh"}
    finally:
        if wav_path:
            Path(wav_path).unlink(missing_ok=True)


def transcribe_file(audio_path: str, segment_sec: float = 15.0) -> str:
    """对完整音频文件做 STT，长音频按 segment_sec 分段逐段转录后拼接。"""
    wav_path = None
    try:
        wav_path = _file_to_wav(audio_path)
        if not wav_path:
            return ""

        import wave
        with wave.open(wav_path, "rb") as wf:
            n_frames = wf.getnframes()
            framerate = wf.getframerate()
        total_dur = n_frames / framerate if framerate > 0 else 0
        if total_dur <= 0:
            return ""

        if total_dur <= segment_sec + 2:
            text = _asr_transcribe(wav_path)
            return text if not _is_hallucination(text) else ""

        chunk_frames = int(segment_sec * framerate)
        parts = []
        offset = 0
        seg_idx = 0
        while offset < n_frames:
            end = min(offset + chunk_frames, n_frames)
            seg_wav = tempfile.mktemp(suffix=f"_seg{seg_idx}.wav")
            try:
                import wave as _wave
                with _wave.open(wav_path, "rb") as src:
                    params = src.getparams()
                    src.setpos(offset)
                    frames = src.readframes(end - offset)
                with _wave.open(seg_wav, "wb") as dst:
                    dst.setparams(params)
                    dst.writeframes(frames)
                text = _asr_transcribe(seg_wav)
                if text and not _is_hallucination(text):
                    parts.append(text)
            except Exception:
                logger.debug("segment %d transcribe error", seg_idx, exc_info=True)
            finally:
                Path(seg_wav).unlink(missing_ok=True)
            offset = end
            seg_idx += 1

        return "".join(parts)
    except Exception:
        logger.exception("transcribe_file failed")
        return ""
    finally:
        if wav_path and Path(wav_path).exists():
            Path(wav_path).unlink(missing_ok=True)


def _file_to_wav(audio_path: str) -> Optional[str]:
    """将任意格式音频文件转为 16kHz 单声道 WAV。"""
    try:
        tmp_out = tempfile.mktemp(suffix=".wav")
        ret = subprocess.run(
            ["ffmpeg", "-y", "-i", str(audio_path),
             "-ar", "16000", "-ac", "1",
             "-acodec", "pcm_s16le",
             "-f", "wav", tmp_out],
            capture_output=True, timeout=60,
        )
        if ret.returncode != 0 or not Path(tmp_out).exists():
            logger.warning("_file_to_wav ffmpeg failed: %s",
                           (ret.stderr or b"").decode(errors="replace")[:300])
            return None
        return tmp_out
    except Exception:
        logger.exception("_file_to_wav error")
        return None


def clear_session(session_id: str) -> None:
    _recent_outputs.pop(session_id, None)


# ─── GPU 显存管理：STT 卸载 / 恢复 ──────────────────────────────────────────
_stt_on_gpu = True


def offload_stt_from_gpu():
    """将 FireRedASR2 + Punc 从 GPU 卸载，释放显存给 LLM。"""
    global _asr_model, _punc_model, _stt_on_gpu
    if not _stt_on_gpu:
        return
    import torch

    with _model_lock:
        _asr_model = None
        _punc_model = None

    torch.cuda.empty_cache()
    _stt_on_gpu = False
    logger.info("FireRedASR2 + Punc offloaded from GPU, VRAM freed")


def reload_stt_to_gpu():
    """将 FireRedASR2 + Punc 重新加载到 GPU。"""
    global _asr_model, _punc_model, _stt_on_gpu
    if _stt_on_gpu:
        return

    with _model_lock:
        _asr_model = None
        _punc_model = None

    _get_models()
    _stt_on_gpu = True


def is_stt_on_gpu() -> bool:
    return _stt_on_gpu
