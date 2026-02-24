# 测谎系统 - 会话与报告存储
# 支持 memory（仅内存）与 sqlite；会话进行中的 timeline 在内存中累积
# 文件数据（视频、文档）保存在 data/sessions/<session_id>/ 目录

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.config import STORE_BACKEND, SQLITE_PATH, DATA_DIR

# ── 内存缓冲区 ────────────────────────────────────────────────────────────────
_timeline_buffer: dict[str, list[dict]] = {}
_session_report_id: dict[str, str] = {}
_reports_memory: dict[str, dict] = {}

# 内存模式下的会话元数据（session_id -> dict）
_sessions_memory: dict[str, dict] = {}


# ── 文件系统辅助 ──────────────────────────────────────────────────────────────

def _session_dir(session_id: str) -> Path:
    d = DATA_DIR / "sessions" / session_id
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── SQLite 初始化 ─────────────────────────────────────────────────────────────

def _ensure_sqlite() -> None:
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(SQLITE_PATH))
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            name TEXT,
            created_at TEXT NOT NULL,
            ended_at TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            report_id TEXT,
            outline_filename TEXT,
            has_video INTEGER DEFAULT 0,
            has_transcript INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            timeline_json TEXT NOT NULL,
            semantic_findings_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
    """)
    # 迁移：给旧表加新列（若不存在）
    for col, definition in [
        ("name", "TEXT"),
        ("outline_filename", "TEXT"),
        ("has_video", "INTEGER DEFAULT 0"),
        ("has_transcript", "INTEGER DEFAULT 0"),
    ]:
        try:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {col} {definition}")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # 列已存在
    conn.close()


# ── 会话 CRUD ─────────────────────────────────────────────────────────────────

def create_session(name: str = "") -> tuple[str, str]:
    """创建会话，返回 (session_id, created_at_iso)。"""
    sid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    _timeline_buffer[sid] = []
    _session_dir(sid)  # 预建目录

    if STORE_BACKEND == "sqlite":
        _ensure_sqlite()
        conn = sqlite3.connect(str(SQLITE_PATH))
        conn.execute(
            "INSERT INTO sessions (id, name, created_at, status) VALUES (?, ?, ?, 'active')",
            (sid, name or "", now),
        )
        conn.commit()
        conn.close()
    else:
        _sessions_memory[sid] = {
            "id": sid, "name": name or "", "created_at": now,
            "ended_at": None, "status": "active", "report_id": None,
            "outline_filename": None, "has_video": False, "has_transcript": False,
        }

    return sid, now


def update_session_meta(session_id: str, **kwargs) -> None:
    """更新会话元数据（outline_filename, has_video, has_transcript, name）。"""
    allowed = {"name", "outline_filename", "has_video", "has_transcript"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return

    if STORE_BACKEND == "sqlite":
        _ensure_sqlite()
        cols = ", ".join(f"{k} = ?" for k in updates)
        vals = list(updates.values()) + [session_id]
        conn = sqlite3.connect(str(SQLITE_PATH))
        conn.execute(f"UPDATE sessions SET {cols} WHERE id = ?", vals)
        conn.commit()
        conn.close()
    else:
        if session_id in _sessions_memory:
            _sessions_memory[session_id].update(updates)


def get_session_meta(session_id: str) -> dict | None:
    """获取会话元数据。"""
    if STORE_BACKEND == "sqlite":
        _ensure_sqlite()
        conn = sqlite3.connect(str(SQLITE_PATH))
        row = conn.execute(
            "SELECT id, name, created_at, ended_at, status, report_id, outline_filename, has_video, has_transcript "
            "FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        conn.close()
        if not row:
            return None
        return {
            "id": row[0], "name": row[1] or "", "created_at": row[2],
            "ended_at": row[3], "status": row[4], "report_id": row[5],
            "outline_filename": row[6], "has_video": bool(row[7]), "has_transcript": bool(row[8]),
        }
    return _sessions_memory.get(session_id)


# ── 文档提纲 ──────────────────────────────────────────────────────────────────

def save_outline(session_id: str, filename: str, content_bytes: bytes) -> str:
    """
    保存上传的文档提纲文件，提取并返回纯文本内容。
    支持 .txt / .pdf / .docx；其他格式保存原文件并返回提示。
    """
    d = _session_dir(session_id)
    # 保存原文件
    safe_name = Path(filename).name
    dest = d / safe_name
    dest.write_bytes(content_bytes)

    # 提取文本
    text = _extract_text(dest, content_bytes)

    # 保存提取文本
    (d / "outline.txt").write_text(text, encoding="utf-8")
    update_session_meta(session_id, outline_filename=safe_name)
    return text


def _extract_text(path: Path, content_bytes: bytes) -> str:
    suffix = path.suffix.lower()
    try:
        if suffix == ".txt":
            return content_bytes.decode("utf-8", errors="replace")
        elif suffix == ".pdf":
            import pdfplumber, io
            with pdfplumber.open(io.BytesIO(content_bytes)) as pdf:
                return "\n".join(
                    page.extract_text() or "" for page in pdf.pages
                )
        elif suffix in (".docx", ".doc"):
            import docx, io
            doc = docx.Document(io.BytesIO(content_bytes))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        return f"[文档解析失败: {e}，原文件已保存]"
    return "[不支持的文档格式，原文件已保存]"


def get_outline(session_id: str) -> dict | None:
    """返回 {filename, text} 或 None。"""
    d = _session_dir(session_id)
    txt_path = d / "outline.txt"
    if not txt_path.exists():
        return None
    meta = get_session_meta(session_id)
    return {
        "filename": (meta or {}).get("outline_filename", ""),
        "text": txt_path.read_text(encoding="utf-8"),
    }


# ── 视频录制 ──────────────────────────────────────────────────────────────────

def save_video(session_id: str, video_bytes: bytes, ext: str = "webm") -> Path:
    """保存录制视频文件，返回路径。"""
    d = _session_dir(session_id)
    path = d / f"recording.{ext}"
    path.write_bytes(video_bytes)
    update_session_meta(session_id, has_video=True)
    return path


def get_video_path(session_id: str) -> Path | None:
    """返回视频文件路径，不存在则 None。"""
    d = _session_dir(session_id)
    for ext in ("webm", "mp4", "mkv"):
        p = d / f"recording.{ext}"
        if p.exists():
            return p
    return None


# ── 转录文本 ──────────────────────────────────────────────────────────────────

def save_transcript(session_id: str, entries: list[dict]) -> None:
    """保存转录条目列表 [{speaker, text, ts}]。"""
    d = _session_dir(session_id)
    (d / "transcript.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    update_session_meta(session_id, has_transcript=True)


def get_transcript(session_id: str) -> list[dict] | None:
    """返回转录条目列表，不存在则 None。"""
    d = _session_dir(session_id)
    p = d / "transcript.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


# ── Timeline ──────────────────────────────────────────────────────────────────

def append_timeline_sample(session_id: str, sample: dict) -> None:
    if session_id in _timeline_buffer:
        _timeline_buffer[session_id].append(sample)


def get_timeline(session_id: str) -> list[dict]:
    return _timeline_buffer.get(session_id, [])


# ── 结束会话 & 生成报告 ───────────────────────────────────────────────────────

def end_session(session_id: str) -> str | None:
    """结束会话，生成报告并持久化，返回 report_id。"""
    try:
        from backend.services.pipeline import clear_session_buffers
        clear_session_buffers(session_id)
    except Exception:
        pass
    now = datetime.now(timezone.utc).isoformat()
    timeline = _timeline_buffer.get(session_id, [])
    if not timeline:
        timeline = [{"lie_probability": 0, "t": now}]

    report_id = str(uuid.uuid4())

    probs = [s.get("lie_probability", 0) for s in timeline if isinstance(s.get("lie_probability"), (int, float))]
    avg_prob = sum(probs) / len(probs) if probs else 0.0
    peak_prob = max(probs) if probs else 0.0
    level = "low" if avg_prob < 0.35 else ("medium" if avg_prob < 0.65 else "high")

    summary = {
        "average_lie_probability": round(avg_prob, 4),
        "peak_lie_probability": round(peak_prob, 4),
        "level": level,
    }

    semantic_findings = []
    for s in timeline:
        if s.get("semantic_summary"):
            semantic_findings.append({"text": s["semantic_summary"], "severity": "medium"})
    if not semantic_findings:
        semantic_findings = [{"text": "无语义分析记录", "severity": "info"}]

    report_row = {
        "id": report_id,
        "session_id": session_id,
        "summary": summary,
        "timeline": timeline,
        "semantic_findings": semantic_findings[:20],
    }

    if STORE_BACKEND == "sqlite":
        _ensure_sqlite()
        conn = sqlite3.connect(str(SQLITE_PATH))
        conn.execute(
            "UPDATE sessions SET ended_at = ?, status = 'ended', report_id = ? WHERE id = ?",
            (now, report_id, session_id),
        )
        conn.execute(
            """INSERT INTO reports (id, session_id, summary_json, timeline_json, semantic_findings_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (report_id, session_id, json.dumps(summary),
             json.dumps(timeline), json.dumps(semantic_findings[:20]), now),
        )
        conn.commit()
        conn.close()
    else:
        _reports_memory[report_id] = report_row
        if session_id in _sessions_memory:
            _sessions_memory[session_id].update(
                {"ended_at": now, "status": "ended", "report_id": report_id}
            )

    _session_report_id[session_id] = report_id
    _timeline_buffer.pop(session_id, None)
    return report_id


# ── 报告查询 ──────────────────────────────────────────────────────────────────

def get_report(report_id: str) -> dict | None:
    if STORE_BACKEND != "sqlite":
        return _reports_memory.get(report_id)
    _ensure_sqlite()
    conn = sqlite3.connect(str(SQLITE_PATH))
    row = conn.execute(
        "SELECT session_id, summary_json, timeline_json, semantic_findings_json FROM reports WHERE id = ?",
        (report_id,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    session_id, summary_json, timeline_json, findings_json = row
    return {
        "id": report_id,
        "session_id": session_id,
        "summary": json.loads(summary_json),
        "timeline": json.loads(timeline_json),
        "semantic_findings": json.loads(findings_json),
    }


def get_report_by_session_id(session_id: str) -> dict | None:
    rid = _session_report_id.get(session_id)
    if rid and STORE_BACKEND != "sqlite":
        return _reports_memory.get(rid)
    if STORE_BACKEND == "sqlite":
        _ensure_sqlite()
        conn = sqlite3.connect(str(SQLITE_PATH))
        row = conn.execute(
            "SELECT id, summary_json, timeline_json, semantic_findings_json FROM reports WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        conn.close()
        if not row:
            return None
        report_id, summary_json, timeline_json, findings_json = row
        return {
            "id": report_id,
            "session_id": session_id,
            "summary": json.loads(summary_json),
            "timeline": json.loads(timeline_json),
            "semantic_findings": json.loads(findings_json),
        }
    return get_report(rid) if rid else None


def list_sessions(limit: int = 50) -> list[dict]:
    """历史会话列表（含 name / has_video / has_transcript 等字段）。"""
    if STORE_BACKEND == "sqlite":
        _ensure_sqlite()
        conn = sqlite3.connect(str(SQLITE_PATH))
        rows = conn.execute(
            """SELECT id, name, created_at, ended_at, status, report_id,
                      outline_filename, has_video, has_transcript
               FROM sessions ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        conn.close()
        return [
            {
                "id": r[0], "name": r[1] or "", "created_at": r[2],
                "ended_at": r[3], "status": r[4], "report_id": r[5],
                "outline_filename": r[6], "has_video": bool(r[7]), "has_transcript": bool(r[8]),
            }
            for r in rows
        ]
    # memory 模式
    items = sorted(_sessions_memory.values(), key=lambda x: x.get("created_at", ""), reverse=True)
    return items[:limit]
