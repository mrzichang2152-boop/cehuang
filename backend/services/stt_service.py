# 测谎系统 - 实时语音转文字服务
# STT：FunASR Paraformer-zh（专为普通话训练，准确率远超 Whisper small）
# 说话人：Resemblyzer GE2E + 4 秒音频累积 + 连续 3 次未匹配才建新说话人

from __future__ import annotations

import base64
import logging
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ─── FunASR Paraformer-zh ────────────────────────────────────────────────────
_paraformer_model = None


def _get_paraformer():
    global _paraformer_model
    if _paraformer_model is None:
        try:
            from funasr import AutoModel
            logger.info("Loading FunASR paraformer-zh…")
            _paraformer_model = AutoModel(
                model="paraformer-zh",
                model_revision="v2.0.4",
                disable_update=True,
            )
            logger.info("paraformer-zh loaded")
        except Exception:
            logger.exception("Failed to load paraformer-zh")
    return _paraformer_model


# ─── Resemblyzer ────────────────────────────────────────────────────────────
_voice_encoder = None


def _get_voice_encoder():
    global _voice_encoder
    if _voice_encoder is None:
        try:
            from resemblyzer import VoiceEncoder
            _voice_encoder = VoiceEncoder()
            logger.info("Resemblyzer VoiceEncoder loaded")
        except Exception:
            logger.exception("Failed to load VoiceEncoder")
    return _voice_encoder


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
             "-ar", "16000", "-ac", "1", "-f", "wav", tmp_out],
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
_HALLUCINATION_RE = re.compile(r'(.{2,8})\1{2,}')  # 2-8字短语重复3次以上


def _is_hallucination(text: str) -> bool:
    if not text or len(text.strip()) < 2:
        return True
    # 重复性短语检测
    if _HALLUCINATION_RE.search(text):
        return True
    # 常见幻觉关键词
    for pat in ['普通话对话', '字幕由', '翻译', '谢谢观看', '点击订阅']:
        if pat in text:
            return True
    return False


# ─── 说话人识别状态（每会话）────────────────────────────────────────────────
# session -> list of (normalized_emb_256, label, count)
_session_speakers: dict[str, list] = {}
# session -> current speaker label
_session_cur_speaker: dict[str, str] = {}
# session -> consecutive non-match count（连续几次没匹配到当前说话人）
_session_mismatch_cnt: dict[str, int] = {}
# session -> counter for numbering
_session_counter: dict[str, int] = {}
# session -> audio accumulation buffer (list of np.ndarray at 16kHz)
_session_audio_buf: dict[str, list] = {}

# 关键超参数
SPEAKER_THRESHOLD = 0.72      # 余弦相似度阈值（同人通常 > 0.78，不同人 < 0.65）
MISMATCH_CONFIRM = 3          # 连续几次未匹配才承认是新说话人
MAX_SPEAKERS = 6              # 最多识别几个说话人（防止无限分裂）
AUDIO_BUF_SECONDS = 4         # 音频累积窗口（更长 → 更稳定的嵌入）


def _load_wav_mono(wav_path: str) -> Optional[tuple[np.ndarray, int]]:
    try:
        from scipy.io import wavfile
        sr, data = wavfile.read(wav_path)
        if data.ndim > 1:
            data = data[:, 0]
        return data.astype(np.float32), sr
    except Exception:
        return None


def _embed_audio(audio: np.ndarray, sr: int = 16000) -> Optional[np.ndarray]:
    """对音频数组提取 Resemblyzer 嵌入。"""
    try:
        from resemblyzer import preprocess_wav
        encoder = _get_voice_encoder()
        if encoder is None:
            return None
        # resemble 期望 float32 PCM 在 [-1,1]
        wav = audio.astype(np.float32)
        mx = np.max(np.abs(wav)) + 1e-9
        if mx > 1.0:
            wav /= mx
        # preprocess_wav 接受 np.ndarray
        processed = preprocess_wav(wav, source_sr=sr)
        if len(processed) < 1600:
            return None
        emb = encoder.embed_utterance(processed).astype(np.float32)
        norm = np.linalg.norm(emb) + 1e-9
        return emb / norm
    except Exception:
        logger.debug("embed failed", exc_info=True)
        return None


def _cos_sim(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))  # 两者已归一化，dot == cos


def _identify_speaker(session_id: str, embedding: np.ndarray) -> str:
    speakers = _session_speakers.setdefault(session_id, [])
    cur = _session_cur_speaker.get(session_id)

    # ── 与所有已知说话人比较，找最相似的 ──────────────────────────────────
    best_sim, best_label = -1.0, None
    for emb, label, _cnt in speakers:
        s = _cos_sim(embedding, emb)
        if s > best_sim:
            best_sim, best_label = s, label

    if best_sim >= SPEAKER_THRESHOLD:
        # 匹配到现有说话人：更新嵌入，重置不匹配计数
        _session_mismatch_cnt[session_id] = 0
        _session_cur_speaker[session_id] = best_label
        for i, (emb, lbl, cnt) in enumerate(speakers):
            if lbl == best_label:
                new_emb = 0.92 * emb + 0.08 * embedding
                new_emb /= np.linalg.norm(new_emb) + 1e-9
                speakers[i] = (new_emb.astype(np.float32), lbl, cnt + 1)
                break
        return best_label

    # ── 未匹配：累计不匹配次数 ─────────────────────────────────────────────
    mismatch = _session_mismatch_cnt.get(session_id, 0) + 1
    _session_mismatch_cnt[session_id] = mismatch
    logger.debug("speaker mismatch %d/%d (best_sim=%.3f)",
                 mismatch, MISMATCH_CONFIRM, best_sim)

    if mismatch < MISMATCH_CONFIRM:
        # 还未确认是新说话人，暂时保持上一个说话人
        return cur or best_label or "说话人1"

    # ── 连续 N 次未匹配，确认新说话人 ────────────────────────────────────
    if len(speakers) >= MAX_SPEAKERS:
        # 已达上限，归入最相近的人
        _session_mismatch_cnt[session_id] = 0
        return best_label or speakers[0][1]

    cnt = _session_counter.get(session_id, 0) + 1
    _session_counter[session_id] = cnt
    label = f"说话人{cnt}"
    speakers.append((embedding, label, 1))
    _session_cur_speaker[session_id] = label
    _session_mismatch_cnt[session_id] = 0
    logger.info("new speaker confirmed: %s (best_sim=%.3f)", label, best_sim)
    return label


# ─── 主入口 ──────────────────────────────────────────────────────────────────
def transcribe(session_id: str, audio_b64: str) -> dict:
    wav_path = None
    try:
        wav_path = _audio_b64_to_wav(audio_b64)
        if not wav_path:
            return {"text": "", "speaker": "", "language": "zh"}

        # ── STT：FunASR Paraformer-zh ────────────────────────────────────────
        model = _get_paraformer()
        if model is None:
            return {"text": "", "speaker": "", "language": "zh"}

        try:
            results = model.generate(input=wav_path, batch_size_s=60)
            raw_text = results[0].get("text", "").strip() if results else ""
            # Paraformer 以字符为单位输出（字间有空格），合并回连续中文
            raw_text = raw_text.replace(" ", "")
        except Exception:
            logger.exception("paraformer inference failed")
            raw_text = ""

        # 过滤幻觉或重复性输出
        if _is_hallucination(raw_text):
            logger.debug("hallucination filtered: %r", raw_text)
            raw_text = ""

        text = raw_text
        if not text:
            return {"text": "", "speaker": "", "language": "zh"}

        # ── 说话人识别（累积 4s 音频后取嵌入）─────────────────────────────
        wav_data = _load_wav_mono(wav_path)
        speaker = _session_cur_speaker.get(session_id, "说话人1")

        if wav_data is not None:
            audio, sr = wav_data
            # 将本帧加入会话音频缓冲区
            buf = _session_audio_buf.setdefault(session_id, [])
            buf.append(audio)
            # 只保留最近 AUDIO_BUF_SECONDS 秒的数据
            max_samples = sr * AUDIO_BUF_SECONDS
            combined = np.concatenate(buf)
            if len(combined) > max_samples:
                combined = combined[-max_samples:]
                # 重建 buf 以避免无限增长
                _session_audio_buf[session_id] = [combined]

            embedding = _embed_audio(combined, sr)
            if embedding is not None:
                speaker = _identify_speaker(session_id, embedding)
            elif not _session_speakers.get(session_id):
                # 第一帧且 Resemblyzer 无法嵌入（音频太短），先用默认
                _session_counter[session_id] = 1
                _session_speakers[session_id] = []
                _session_cur_speaker[session_id] = "说话人1"
                speaker = "说话人1"

        return {"text": text, "speaker": speaker, "language": "zh"}

    except Exception:
        logger.exception("transcribe failed")
        return {"text": "", "speaker": "", "language": "zh"}
    finally:
        if wav_path:
            Path(wav_path).unlink(missing_ok=True)


def clear_session(session_id: str) -> None:
    for d in (_session_speakers, _session_cur_speaker, _session_mismatch_cnt,
              _session_counter, _session_audio_buf):
        d.pop(session_id, None)
