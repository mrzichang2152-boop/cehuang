# 测谎系统 - FastAPI 入口
# 运行：在项目根 cehuangxitong 下执行
#   PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port 9000

import logging
from pathlib import Path

from fastapi import FastAPI

# 保证应用层 INFO 日志可见（uvicorn --log-level 只管自己的 logger）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import API_HOST, API_PORT, PROJECT_ROOT
from backend.routers import sessions, reports, analyze

app = FastAPI(title="测谎系统 API", description="多模态实时测谎后端")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(reports.router_sessions)
app.include_router(reports.router_reports)
app.include_router(analyze.router)

frontend_dir = PROJECT_ROOT / "frontend"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/css/{path:path}")
def static_css(path: str):
    f = frontend_dir / "css" / path
    if f.exists():
        return FileResponse(str(f))
    from fastapi import HTTPException
    raise HTTPException(404)


@app.get("/js/{path:path}")
def static_js(path: str):
    f = frontend_dir / "js" / path
    if f.exists():
        return FileResponse(str(f))
    from fastapi import HTTPException
    raise HTTPException(404)


@app.get("/{full_path:path}")
def frontend_index(full_path: str):
    """前端 SPA：未匹配 API 的 GET 返回 index.html。"""
    index = frontend_dir / "index.html"
    if index.exists():
        return FileResponse(str(index))
    from fastapi import HTTPException
    raise HTTPException(404)
