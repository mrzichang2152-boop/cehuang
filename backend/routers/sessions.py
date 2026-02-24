# 测谎系统 - 会话路由（创建/结束/文档/视频/转录）

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.models import SessionResponse, SessionEndResponse
from backend.store import (
    create_session as store_create,
    end_session as store_end,
    get_session_meta,
    save_outline, get_outline,
    save_video, get_video_path,
    save_transcript, get_transcript,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["sessions"])


# ── 创建会话 ──────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    name: Optional[str] = ""


@router.post("", response_model=SessionResponse)
def create_session(body: SessionCreate = None) -> SessionResponse:
    name = (body.name or "") if body else ""
    sid, _ = store_create(name=name)
    return SessionResponse(session_id=sid)


# ── 结束会话 ──────────────────────────────────────────────────────────────────

@router.post("/{session_id}/end", response_model=SessionEndResponse)
def end_session(session_id: str) -> SessionEndResponse:
    report_id = store_end(session_id)
    if report_id is None:
        raise HTTPException(status_code=404, detail="Session not found or already ended")
    return SessionEndResponse(report_id=report_id)


# ── 审讯提纲上传/获取 ─────────────────────────────────────────────────────────

@router.post("/{session_id}/outline")
async def upload_outline(
    session_id: str,
    file: UploadFile = File(...),
) -> JSONResponse:
    """上传审讯提纲文档（.txt / .pdf / .docx），提取纯文本后保存。"""
    meta = get_session_meta(session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Session not found")
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:  # 20MB limit
        raise HTTPException(status_code=413, detail="文件过大（最大 20MB）")
    try:
        text = save_outline(session_id, file.filename or "outline.txt", content)
        return JSONResponse({"ok": True, "filename": file.filename, "text": text[:500]})
    except Exception as e:
        logger.exception("outline upload error")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/outline")
def get_outline_api(session_id: str) -> JSONResponse:
    """获取已上传的审讯提纲文本。"""
    data = get_outline(session_id)
    if not data:
        raise HTTPException(status_code=404, detail="No outline uploaded")
    return JSONResponse(data)


# ── 视频上传/下载 ─────────────────────────────────────────────────────────────

@router.post("/{session_id}/video")
async def upload_video(
    session_id: str,
    file: UploadFile = File(...),
) -> JSONResponse:
    """上传录制视频文件（WebM/MP4）。"""
    meta = get_session_meta(session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Session not found")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024 * 1024:  # 2GB limit
        raise HTTPException(status_code=413, detail="视频文件过大（最大 2GB）")
    fn = file.filename or "recording.webm"
    ext = fn.rsplit(".", 1)[-1] if "." in fn else "webm"
    try:
        path = save_video(session_id, content, ext=ext)
        logger.info("video saved: %s (%d bytes)", path, len(content))
        return JSONResponse({"ok": True, "size": len(content)})
    except Exception as e:
        logger.exception("video upload error")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/video")
def download_video(session_id: str):
    """下载/流式播放录制视频。"""
    path = get_video_path(session_id)
    if not path:
        raise HTTPException(status_code=404, detail="No video recorded")
    media_type = "video/webm" if path.suffix == ".webm" else "video/mp4"
    return FileResponse(str(path), media_type=media_type,
                        headers={"Accept-Ranges": "bytes"})


# ── 转录保存/获取 ─────────────────────────────────────────────────────────────

class TranscriptSaveRequest(BaseModel):
    entries: list[dict]  # [{speaker, text, ts}]


@router.post("/{session_id}/transcript")
def save_transcript_api(session_id: str, body: TranscriptSaveRequest) -> JSONResponse:
    """保存本次会话的语音转文字结果。"""
    meta = get_session_meta(session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Session not found")
    save_transcript(session_id, body.entries)
    return JSONResponse({"ok": True, "count": len(body.entries)})


@router.get("/{session_id}/transcript")
def get_transcript_api(session_id: str) -> JSONResponse:
    """获取保存的转录内容。"""
    data = get_transcript(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="No transcript saved")
    return JSONResponse({"entries": data})


# ── 会话元数据 ────────────────────────────────────────────────────────────────

@router.get("/{session_id}/meta")
def get_session_meta_api(session_id: str) -> JSONResponse:
    """获取会话元数据（name / outline / video / transcript 标记）。"""
    meta = get_session_meta(session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Session not found")
    return JSONResponse(meta)
