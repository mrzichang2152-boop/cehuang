# 测谎系统 - 语义分析（本地 Qwen2.5）
# 实时分析：调用本地 qwen2_5_7b_server.py 的 /chat 接口
# 全文分析：直接在进程内加载 Qwen2.5-1.5B-Instruct（延迟加载，首次调用时下载）

from __future__ import annotations

import logging
import threading
import urllib.request
import json
from typing import Optional

from backend.config import QWEN_BASE_URL, QWEN_CHAT_PATH
from backend.models import SemanticResult

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = "你负责分析以下陈述，指出逻辑漏洞、前后矛盾或可疑之处，用简洁条目列出。"

FULL_TRANSCRIPT_SYSTEM = (
    "你是一位专业的逻辑分析师，擅长发现陈述中的矛盾、逻辑漏洞和前后不一致之处。"
    "请仔细阅读以下对话文字记录，分析是否存在以下问题：\n"
    "1. 前后矛盾的陈述\n2. 不合逻辑的解释\n3. 可疑的细节或回避\n4. 时间线不一致\n5. 情感反应异常\n"
    "请用条目列出所有发现的问题，并给出综合判断（可信/存疑/高度可疑）。如无明显问题则说明。"
)

# ── 本地小模型（延迟加载）────────────────────────────────────────────────────
_local_model = None
_local_tokenizer = None
_local_model_lock = threading.Lock()
LOCAL_MODEL_ID = "Qwen/Qwen2.5-1.5B-Instruct"


def _get_local_model():
    global _local_model, _local_tokenizer
    if _local_model is not None:
        return _local_model, _local_tokenizer
    with _local_model_lock:
        if _local_model is not None:
            return _local_model, _local_tokenizer
        try:
            import os
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            # 优先使用 hf-mirror 加速国内下载
            os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
            logger.info("正在加载本地语义分析模型 %s …", LOCAL_MODEL_ID)
            tok = AutoTokenizer.from_pretrained(LOCAL_MODEL_ID, trust_remote_code=True)
            device = "cuda" if torch.cuda.is_available() else "cpu"
            dtype = torch.float16 if device == "cuda" else torch.float32
            mdl = AutoModelForCausalLM.from_pretrained(
                LOCAL_MODEL_ID,
                torch_dtype=dtype,
                device_map="auto",
                trust_remote_code=True,
            )
            mdl.eval()
            _local_tokenizer = tok
            _local_model = mdl
            logger.info("本地语义分析模型加载完成，设备: %s", device)
        except Exception:
            logger.exception("本地语义分析模型加载失败")
            _local_model = None
            _local_tokenizer = None
    return _local_model, _local_tokenizer


def _call_local_model(system_prompt: str, user_text: str, max_new_tokens: int = 512) -> str:
    """使用本地 Qwen 模型生成回复。"""
    mdl, tok = _get_local_model()
    if mdl is None or tok is None:
        raise RuntimeError("本地模型未加载")
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ]
    text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
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
    reply = tok.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    return reply.strip()


def _call_http_service(system_prompt: str, user_text: str, timeout: int = 30) -> Optional[str]:
    """尝试调用 HTTP Qwen 服务，失败返回 None。"""
    url = f"{QWEN_BASE_URL.rstrip('/')}{QWEN_CHAT_PATH}"
    body = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        "max_new_tokens": 512,
        "temperature": 0.3,
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("reply", "")
    except Exception:
        return None


# ── 原实时接口（保持兼容）────────────────────────────────────────────────────

def analyze_semantic(text: str) -> SemanticResult:
    """
    将被测人单句陈述发送给 Qwen 服务（HTTP 或本地），返回矛盾/漏洞列表与分数。
    """
    reply = _call_http_service(SYSTEM_PROMPT, f"被测人陈述：{text}")
    if not reply:
        return SemanticResult(semantic_score=0.0, summary="语义服务暂不可用")
    return _parse_qwen_reply(reply)


# ── 全文分析接口（按钮触发）──────────────────────────────────────────────────

def analyze_full_transcript(transcript: str) -> dict:
    """
    对完整对话记录进行逻辑一致性分析。
    先尝试 HTTP 服务，不可用则使用本地 Qwen2.5-1.5B-Instruct。
    返回: { "analysis": str, "issues": list[str], "verdict": str, "source": str }
    """
    if not transcript or not transcript.strip():
        return {
            "analysis": "无内容可分析",
            "issues": [],
            "verdict": "无数据",
            "source": "none",
        }

    user_text = f"以下是对话记录，请分析是否存在逻辑问题或前后矛盾：\n\n{transcript}"

    # 1. 先试 HTTP 服务
    reply = _call_http_service(FULL_TRANSCRIPT_SYSTEM, user_text, timeout=30)
    source = "http_service"

    # 2. 退路：本地模型
    if not reply:
        try:
            reply = _call_local_model(FULL_TRANSCRIPT_SYSTEM, user_text, max_new_tokens=600)
            source = "local_model"
        except Exception:
            logger.exception("本地模型推理失败")
            reply = None

    if not reply:
        return {
            "analysis": "语义分析服务暂不可用（HTTP 服务未启动，本地模型加载失败）",
            "issues": [],
            "verdict": "无法判断",
            "source": "error",
        }

    return _parse_full_analysis(reply, source)


def _parse_full_analysis(reply: str, source: str) -> dict:
    """从模型回复中提取问题列表和综合判断。"""
    lines = [s.strip() for s in reply.split("\n") if s.strip()]
    issues = []
    verdict = "可信"

    for ln in lines:
        # 判断是否是条目（数字开头、- 开头、• 开头）
        if (ln and (ln[0].isdigit() or ln.startswith("-") or ln.startswith("•") or ln.startswith("·"))):
            cleaned = ln.lstrip("0123456789.-•· \t").strip()
            if cleaned:
                issues.append(cleaned)
        # 提取综合判断
        for kw, v in [("高度可疑", "高度可疑"), ("存疑", "存疑"), ("可疑", "存疑"),
                       ("不可信", "高度可疑"), ("可信", "可信"), ("无明显问题", "可信")]:
            if kw in ln:
                verdict = v
                break

    return {
        "analysis": reply,
        "issues": issues[:10],  # 最多返回10条
        "verdict": verdict,
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
