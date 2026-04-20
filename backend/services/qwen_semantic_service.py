# 测谎系统 - 语义分析（本地 Qwen3-4B）
# 动态 GPU 切换：录制时 GPU 给 STT，分析时 GPU 给 Qwen3-4B
# 实时分析：non-thinking 模式，快速响应
# 全文分析：thinking 模式，深度逻辑推理

from __future__ import annotations

import logging
import os
import sys
import threading
from pathlib import Path
from typing import Optional

from backend.models import SemanticResult

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_PRETRAINED_DIR = _PROJECT_ROOT / "pretrained_models"

SYSTEM_PROMPT = "你负责分析以下陈述，指出逻辑漏洞、前后矛盾或可疑之处，用简洁条目列出。"

FULL_TRANSCRIPT_SYSTEM = (
    "你是一位专业的逻辑分析师。你的任务是逐条找出陈述中的矛盾和逻辑问题。\n\n"
    "【关键要求】每发现一个问题，必须按以下格式输出：\n"
    "1. 用【原话A】和【原话B】的方式直接引用对话中的原文，指出具体哪句话和哪句话存在矛盾。\n"
    "2. 解释为什么这两句话之间存在矛盾或不合逻辑。\n"
    "3. 如有参考材料，也要引用参考材料中的原文和对话中的原文进行对比。\n\n"
    "【输出格式示例】\n"
    "1. **前后矛盾：关于XX的描述**\n"
    "   - 原话A：说话人1说「......」\n"
    "   - 原话B：说话人1又说「......」\n"
    "   - 矛盾分析：A说了XX，但B又说了YY，两者在XX方面存在明显矛盾。\n\n"
    "【分析维度】\n"
    "1. 前后矛盾的陈述\n2. 不合逻辑的解释\n3. 可疑的细节或回避\n"
    "4. 时间线不一致\n5. 与参考材料相悖的陈述（如提供了参考材料）\n\n"
    "最后给出综合判断（可信/存疑/高度可疑）。如无明显问题则说明。"
)

# ─── Qwen3-4B 本地模型（按需加载到 GPU）───────────────────────────────────────
_local_model = None
_local_tokenizer = None
_local_model_lock = threading.Lock()
_model_on_gpu = False
LOCAL_MODEL_DIR = str(_PRETRAINED_DIR / "Qwen3-4B")
THINK_END_TOKEN_ID = 151668  # </think> token id for Qwen3


def _load_model_to_gpu():
    """将 Qwen3-4B 加载到 GPU（FP16）。调用前需确保 STT 已从 GPU 卸载。"""
    global _local_model, _local_tokenizer, _model_on_gpu
    if _model_on_gpu and _local_model is not None:
        return _local_model, _local_tokenizer
    with _local_model_lock:
        if _model_on_gpu and _local_model is not None:
            return _local_model, _local_tokenizer
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        if _local_model is None:
            logger.info("首次加载 Qwen3-4B (GPU FP16)…")
            tok = AutoTokenizer.from_pretrained(LOCAL_MODEL_DIR, trust_remote_code=True)
            mdl = AutoModelForCausalLM.from_pretrained(
                LOCAL_MODEL_DIR,
                torch_dtype=torch.float16,
                device_map="cuda",
                trust_remote_code=True,
            )
            mdl.eval()
            _local_tokenizer = tok
            _local_model = mdl
        else:
            logger.info("Qwen3-4B CPU → GPU…")
            _local_model.to("cuda", dtype=torch.float16)

        _model_on_gpu = True
        logger.info("Qwen3-4B GPU 就绪")
    return _local_model, _local_tokenizer


def _unload_model_from_gpu():
    """将 Qwen3-4B 从 GPU 移到 CPU，释放显存。"""
    global _model_on_gpu
    with _local_model_lock:
        if _local_model is not None and _model_on_gpu:
            _local_model.cpu()
            import torch
            torch.cuda.empty_cache()
            _model_on_gpu = False
            logger.info("Qwen3-4B 已从 GPU 卸载到 CPU")


def prepare_for_analysis():
    """分析前调用：卸载 STT → 加载 Qwen3 到 GPU。"""
    from backend.services.stt_service import offload_stt_from_gpu
    offload_stt_from_gpu()
    return _load_model_to_gpu()


def release_gpu_for_stt():
    """录制前调用：卸载 Qwen3 → 恢复 STT 到 GPU。"""
    _unload_model_from_gpu()
    from backend.services.stt_service import reload_stt_to_gpu
    reload_stt_to_gpu()


def _call_local_model(
    system_prompt: str,
    user_text: str,
    max_new_tokens: int = 512,
    enable_thinking: bool = False,
) -> str:
    """使用 Qwen3-4B (GPU) 生成回复。enable_thinking=True 启用深度推理。"""
    mdl, tok = prepare_for_analysis()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ]
    text = tok.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True,
        enable_thinking=enable_thinking,
    )
    inputs = tok([text], return_tensors="pt").to(mdl.device)
    import torch
    with torch.no_grad():
        outputs = mdl.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            temperature=0.3,
            do_sample=True,
            pad_token_id=tok.eos_token_id,
        )
    output_ids = outputs[0][inputs["input_ids"].shape[1]:].tolist()

    if enable_thinking:
        try:
            idx = len(output_ids) - output_ids[::-1].index(THINK_END_TOKEN_ID)
        except ValueError:
            idx = 0
        reply = tok.decode(output_ids[idx:], skip_special_tokens=True)
    else:
        reply = tok.decode(output_ids, skip_special_tokens=True)

    return reply.strip()


def stream_full_transcript(transcript: str):
    """
    流式全文逻辑分析生成器。
    yields:
      {"type":"thinking_start"}
      {"type":"thinking_token","text":str}
      {"type":"thinking_end"}
      {"type":"token","text":str}
      {"type":"done","verdict":str}
    """
    if not transcript or not transcript.strip():
        yield {"type": "done", "text": "", "verdict": "无数据"}
        return

    mdl, tok = prepare_for_analysis()
    user_text = f"请分析以下内容是否存在逻辑问题或前后矛盾：\n\n{transcript}"
    messages = [
        {"role": "system", "content": FULL_TRANSCRIPT_SYSTEM},
        {"role": "user", "content": user_text},
    ]
    text = tok.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True,
        enable_thinking=True,
    )
    inputs = tok([text], return_tensors="pt").to(mdl.device)

    from transformers import TextIteratorStreamer
    import torch

    streamer = TextIteratorStreamer(tok, skip_prompt=True, skip_special_tokens=False)

    gen_kwargs = dict(
        **inputs,
        max_new_tokens=30000,
        temperature=0.3,
        do_sample=True,
        pad_token_id=tok.eos_token_id,
        streamer=streamer,
    )

    gen_thread = threading.Thread(target=lambda: mdl.generate(**gen_kwargs), daemon=True)
    gen_thread.start()

    in_thinking = True
    thinking_started = False
    full_reply = []

    for chunk in streamer:
        if in_thinking:
            if "</think>" in chunk:
                before, after = chunk.split("</think>", 1)
                if before.strip():
                    if not thinking_started:
                        yield {"type": "thinking_start"}
                        thinking_started = True
                    yield {"type": "thinking_token", "text": before}
                yield {"type": "thinking_end"}
                in_thinking = False
                if after:
                    full_reply.append(after)
                    yield {"type": "token", "text": after}
            else:
                clean = chunk.replace("<think>", "")
                if clean:
                    if not thinking_started:
                        yield {"type": "thinking_start"}
                        thinking_started = True
                    yield {"type": "thinking_token", "text": clean}
            continue

        full_reply.append(chunk)
        yield {"type": "token", "text": chunk}

    gen_thread.join(timeout=5)

    complete_text = "".join(full_reply).strip()
    verdict = _extract_verdict(complete_text) if complete_text else "无法判断"
    yield {"type": "done", "verdict": verdict}


# ── 实时语义分析（录制期间 LLM 不在 GPU 上，跳过）──────────────────────────────

def analyze_semantic(text: str) -> SemanticResult:
    """录制期间的实时语义分析。LLM 不在 GPU 时直接跳过。"""
    if not _model_on_gpu:
        return SemanticResult(semantic_score=0.0, summary="")
    try:
        reply = _call_local_model(
            SYSTEM_PROMPT, f"被测人陈述：{text}",
            max_new_tokens=256, enable_thinking=False,
        )
    except Exception:
        logger.exception("实时语义分析失败")
        return SemanticResult(semantic_score=0.0, summary="语义服务暂不可用")
    if not reply:
        return SemanticResult(semantic_score=0.0, summary="语义服务暂不可用")
    return _parse_qwen_reply(reply)


# ── 全文逻辑分析（thinking 模式，深度推理）───────────────────────────────────

def analyze_full_transcript(transcript: str) -> dict:
    """
    对完整对话记录进行逻辑一致性分析。
    启用 thinking 模式进行深度链式推理。
    返回: { "analysis": str, "issues": list[str], "verdict": str, "source": str }
    """
    if not transcript or not transcript.strip():
        return {
            "analysis": "无内容可分析",
            "issues": [],
            "verdict": "无数据",
            "source": "none",
        }

    user_text = f"请分析以下内容是否存在逻辑问题或前后矛盾：\n\n{transcript}"

    try:
        reply = _call_local_model(
            FULL_TRANSCRIPT_SYSTEM, user_text,
            max_new_tokens=30000, enable_thinking=True,
        )
        source = "qwen3_thinking"
    except Exception:
        logger.exception("全文逻辑分析失败")
        return {
            "analysis": "语义分析模型推理失败",
            "issues": [],
            "verdict": "无法判断",
            "source": "error",
        }

    if not reply:
        return {
            "analysis": "语义分析未返回结果",
            "issues": [],
            "verdict": "无法判断",
            "source": "error",
        }

    return _parse_full_analysis(reply, source)


_SEVERITY = {"可信": 0, "存疑": 1, "高度可疑": 2}

def _extract_verdict(reply: str) -> str:
    """从模型回复中提取综合判断，严重度只升不降。"""
    lines = [s.strip() for s in reply.split("\n") if s.strip()]
    best = "可信"
    best_sev = 0

    verdict_keywords = ("综合判断", "可信度", "结论", "总体评估", "整体判断", "综合评价")

    verdict_lines = [ln for ln in lines if any(k in ln for k in verdict_keywords)]
    scan_lines = verdict_lines if verdict_lines else lines[-10:]

    for ln in scan_lines:
        if "高度可疑" in ln or "不可信" in ln:
            return "高度可疑"
        if "存疑" in ln and _SEVERITY["存疑"] > best_sev:
            best, best_sev = "存疑", _SEVERITY["存疑"]
        elif "可疑" in ln and "高度" not in ln and _SEVERITY["存疑"] > best_sev:
            best, best_sev = "存疑", _SEVERITY["存疑"]

    if best_sev > 0:
        return best

    for ln in scan_lines:
        if "可信" in ln and "不可信" not in ln and "可信度" not in ln:
            return "可信"
        if "无明显问题" in ln or "未发现" in ln:
            return "可信"

    return best


def _parse_full_analysis(reply: str, source: str) -> dict:
    """从模型回复中提取问题列表和综合判断。"""
    lines = [s.strip() for s in reply.split("\n") if s.strip()]
    issues = []
    current_issue_lines = []

    def flush_issue():
        if current_issue_lines:
            issues.append("\n".join(current_issue_lines))
            current_issue_lines.clear()

    for ln in lines:
        if ln and ln[0].isdigit() and '.' in ln[:4]:
            flush_issue()
            cleaned = ln.lstrip("0123456789. \t").strip()
            if cleaned:
                current_issue_lines.append(cleaned)
        elif ln.startswith("-") or ln.startswith("•") or ln.startswith("·"):
            cleaned = ln.lstrip("-•· \t").strip()
            if cleaned:
                current_issue_lines.append(cleaned)
        elif current_issue_lines:
            current_issue_lines.append(ln)

    flush_issue()

    return {
        "analysis": reply,
        "issues": issues[:15],
        "verdict": _extract_verdict(reply),
        "source": source,
    }


def _parse_qwen_reply(reply: str) -> SemanticResult:
    """从模型回复中提取条目与分数（实时分析用）。"""
    lines = [s.strip() for s in reply.split("\n") if s.strip()]
    contradictions = [ln for ln in lines if any(kw in ln for kw in ("矛盾", "漏洞", "不一致", "可疑"))]
    if not contradictions:
        contradictions = lines[:5]
    score = min(1.0, 0.2 + 0.3 * len(contradictions)) if contradictions else 0.0
    return SemanticResult(
        semantic_score=round(score, 4),
        contradictions=contradictions,
        summary=reply[:200] if reply else None,
    )
