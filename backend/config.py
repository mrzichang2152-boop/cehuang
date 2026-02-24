# 测谎系统 - 后端配置
# 从环境变量读取，不写死路径；见 docs/TECH.md §2.4

import os
from pathlib import Path

# 项目根（backend 的上级）
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# API 与 WebSocket
API_HOST = os.getenv("CEHUANG_API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("CEHUANG_API_PORT", "9000"))

# Qwen 本地服务（语义分析）
QWEN_BASE_URL = os.getenv("QWEN_BASE_URL", "http://localhost:8000")
QWEN_CHAT_PATH = os.getenv("QWEN_CHAT_PATH", "/chat")

# OpenFace 可执行文件（若通过 CLI 调用）；为空则未配置，表情维度可降级
OPENFACE_BIN_DIR = os.getenv("OPENFACE_BIN_DIR", "")  # 例如 /opt/OpenFace/build/bin
OPENFACE_FEATURE_EXTRACTION = "FeatureExtraction"
OPENFACE_FACE_LANDMARK_IMG = "FaceLandmarkImg"

# rPPG / 心率：当前实现用 pyVHR 或 vitallens；FacePhys 开源后可切换
RPPG_BACKEND = os.getenv("RPPG_BACKEND", "pyvhr")  # pyvhr | vitallens | facephys

# DistilHuBERT 模型 ID
DISTILHUBERT_MODEL_ID = os.getenv("DISTILHUBERT_MODEL_ID", "ntu-spml/distilhubert")

# 融合权重（0~1，四维度和为 1 或各自独立）
FUSION_WEIGHTS = {
    "expression": float(os.getenv("FUSION_WEIGHT_EXPRESSION", "0.25")),
    "heart_rate": float(os.getenv("FUSION_WEIGHT_HEART_RATE", "0.25")),
    "tone": float(os.getenv("FUSION_WEIGHT_TONE", "0.25")),
    "semantic": float(os.getenv("FUSION_WEIGHT_SEMANTIC", "0.25")),
}

# 存储（默认 sqlite，重启后数据不丢失；可设环境变量 CEHUANG_STORE=memory 切回内存）
STORE_BACKEND = os.getenv("CEHUANG_STORE", "sqlite")  # sqlite | memory
SQLITE_PATH = PROJECT_ROOT / "data" / "cehuang.db"

# 文件数据目录（视频、文档、转录）
DATA_DIR = Path(os.getenv("CEHUANG_DATA_DIR", str(PROJECT_ROOT / "data")))
