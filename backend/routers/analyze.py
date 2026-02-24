# 测谎系统 - 分析入口：WebSocket 实时接收帧/音频，推送融合结果 + 语音转文字

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.services.pipeline import run_pipeline, get_last_bpm

logger = logging.getLogger(__name__)
router = APIRouter(tags=["analyze"])

# 共享线程池，供 STT（CPU/GPU 阻塞任务）使用
# 每 2s 一个任务，Whisper small ~2-3s/chunk，需要 max_workers≥2 避免积压
_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="stt")

# 延迟导入，避免启动时立即加载 Whisper 模型
def _stt_transcribe(session_id: str, audio_b64: str) -> dict:
    try:
        from backend.services.stt_service import transcribe
        return transcribe(session_id, audio_b64)
    except Exception:
        logger.exception("STT error")
        return {"text": "", "speaker": "", "language": "zh"}


@router.websocket("/ws")
async def websocket_analyze(ws: WebSocket):
    await ws.accept()
    loop = asyncio.get_event_loop()
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "detail": "Invalid JSON"})
                continue
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
                continue
            if msg.get("type") != "frame":
                continue
            session_id = msg.get("session_id")
            if not session_id:
                await ws.send_json({"type": "error", "detail": "Missing session_id"})
                continue
            frame_b64 = msg.get("video_base64") or msg.get("frame_base64")
            audio_b64 = msg.get("audio_base64")
            text = msg.get("text")
            green_values = msg.get("green_values")  # list[float]，10fps 绿色通道均值
            logger.info("recv frame=%s audio=%s green=%s",
                        bool(frame_b64), bool(audio_b64),
                        len(green_values) if green_values else 0)

            # ── 分析管道（同步，较快）──────────────────────────────────────────
            try:
                result = run_pipeline(
                    session_id=session_id,
                    frame_b64=frame_b64,
                    audio_b64=audio_b64,
                    text=text,
                    green_values=green_values,
                )
            except Exception as e:
                logger.exception("Pipeline error")
                await ws.send_json({"type": "error", "detail": str(e)})
                continue

            await ws.send_json({
                "type": "result",
                "session_id": session_id,
                "lie_probability": result.lie_probability,
                "dimensions": {
                    "expression": result.dimensions.expression,
                    "heart_rate": result.dimensions.heart_rate,
                    "tone": result.dimensions.tone,
                    "semantic": result.dimensions.semantic,
                },
                "bpm": get_last_bpm(session_id),   # 原始心率 bpm，供前端展示
                "semantic_summary": result.semantic_summary,
            })

            # ── 语音转文字（异步，不阻塞主分析循环）───────────────────────────
            if audio_b64:
                async def _send_transcript(sid=session_id, ab=audio_b64):
                    try:
                        tr = await loop.run_in_executor(
                            _executor, _stt_transcribe, sid, ab
                        )
                        if tr.get("text"):
                            await ws.send_json({
                                "type": "transcript",
                                "session_id": sid,
                                "text": tr["text"],
                                "speaker": tr["speaker"],
                                "language": tr["language"],
                            })
                    except Exception:
                        logger.exception("transcript send error")
                asyncio.create_task(_send_transcript())

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("WebSocket error")


# ── 语义全文分析（按钮触发）──────────────────────────────────────────────────

class SemanticAnalyzeRequest(BaseModel):
    transcript: str  # 完整转录文本


@router.post("/api/semantic-analyze")
async def semantic_analyze(req: SemanticAnalyzeRequest):
    """
    接收完整对话转录文本，用本地 LLM 分析逻辑一致性。
    首次调用会触发模型下载（Qwen2.5-1.5B-Instruct ~3GB），后续从缓存加载。
    """
    loop = asyncio.get_event_loop()

    def _run():
        from backend.services.qwen_semantic_service import analyze_full_transcript
        return analyze_full_transcript(req.transcript)

    try:
        result = await loop.run_in_executor(_executor, _run)
        return JSONResponse(content=result)
    except Exception as e:
        logger.exception("semantic_analyze error")
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "analysis": "分析失败", "issues": [], "verdict": "错误"},
        )
