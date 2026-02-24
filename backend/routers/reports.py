# 测谎系统 - 报告查询

from fastapi import APIRouter, HTTPException

from backend.models import Report
from backend.store import get_report, get_report_by_session_id, list_sessions

router_reports = APIRouter(prefix="/reports", tags=["reports"])
router_sessions = APIRouter(prefix="/sessions", tags=["sessions"])


@router_sessions.get("/{session_id}/report", response_model=Report)
def get_report_by_session(session_id: str) -> Report:
    """按会话 ID 获取报告（PRD：GET /sessions/:id/report）。"""
    report = get_report_by_session_id(session_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return Report(**report)


@router_reports.get("/{report_id}", response_model=Report)
def get_report_by_id(report_id: str) -> Report:
    """按报告 ID 获取报告（用于 /report/:id 页面）。"""
    report = get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return Report(**report)


@router_sessions.get("", response_model=list)
def list_sessions_api(limit: int = 50) -> list:
    """历史会话列表。"""
    return list_sessions(limit=limit)
