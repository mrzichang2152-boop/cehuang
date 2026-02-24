# 测谎系统 - 表情/微表情分析
# 优先使用 OpenFace C++ 可执行（若配置了 OPENFACE_BIN_DIR）；
# 未配置时回退到 cv2 Haar 人脸检测 + 帧差动作分析。

from __future__ import annotations

import csv
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

from backend.config import OPENFACE_BIN_DIR, OPENFACE_FACE_LANDMARK_IMG
from backend.models import ExpressionResult

# 上一帧 ROI 缓存，用于帧差计算
_prev_face_gray: dict[str, np.ndarray] = {}

_face_cascade: cv2.CascadeClassifier | None = None


def _get_cascade() -> cv2.CascadeClassifier:
    global _face_cascade
    if _face_cascade is None:
        xml = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        _face_cascade = cv2.CascadeClassifier(xml)
    return _face_cascade


def run_openface_on_image(image_path: str | Path) -> ExpressionResult:
    """
    对单张图片分析表情。
    有 OpenFace 时调用 FaceLandmarkImg；否则用 cv2 Haar 级联 + 帧差。
    """
    if OPENFACE_BIN_DIR:
        result = _run_openface_cli(image_path)
        if result is not None:
            return result

    return _cv2_expression(image_path)


def _run_openface_cli(image_path: str | Path) -> ExpressionResult | None:
    bin_dir = Path(OPENFACE_BIN_DIR)
    exe = bin_dir / OPENFACE_FACE_LANDMARK_IMG
    if not exe.exists():
        exe = bin_dir / "FaceLandmarkImg"
    if not exe.exists():
        return None
    out_dir = tempfile.mkdtemp(prefix="openface_out_")
    try:
        cmd = [str(exe), "-f", str(image_path), "-out_dir", out_dir]
        subprocess.run(cmd, capture_output=True, timeout=30, cwd=str(bin_dir))
        csv_files = list(Path(out_dir).glob("*.csv"))
        if not csv_files:
            return None
        return _parse_openface_csv(csv_files[0])
    except Exception:
        return None


def _cv2_expression(image_path: str | Path) -> ExpressionResult:
    """
    cv2 回退实现：检测人脸 ROI，计算帧差运动量 + 眼部/口部动作强度 → expression_score。
    原理：测谎场景中明显的微表情、眨眼过频、嘴部动作会体现为较高的运动量方差。
    """
    try:
        img = cv2.imread(str(image_path))
        if img is None:
            return ExpressionResult(expression_score=0.0)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        cascade = _get_cascade()
        faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
        if len(faces) == 0:
            return ExpressionResult(expression_score=0.0)

        x, y, w, h = faces[0]
        face_gray = gray[y:y + h, x:x + w]

        # 帧差：与上一帧比较运动量
        key = str(image_path)[:8]
        motion_score = 0.0
        if key in _prev_face_gray:
            prev = _prev_face_gray[key]
            if prev.shape == face_gray.shape:
                diff = cv2.absdiff(face_gray, prev).astype(float)
                motion_score = float(np.mean(diff)) / 30.0  # 归一化：30 灰度级视为满分
        _prev_face_gray[key] = face_gray.copy()
        if len(_prev_face_gray) > 20:
            oldest = next(iter(_prev_face_gray))
            del _prev_face_gray[oldest]

        # 眼睛区域 Laplacian 方差（眨眼/眼神变化）
        eye_roi = face_gray[int(h * 0.15):int(h * 0.45), :]
        eye_lap_var = float(cv2.Laplacian(eye_roi, cv2.CV_64F).var())
        # 嘴部区域方差（口型变化）
        mouth_roi = face_gray[int(h * 0.65):int(h * 0.95), :]
        mouth_var = float(np.var(mouth_roi.astype(float))) / 1000.0

        # 综合得分
        score = min(1.0, motion_score * 0.5 + min(1.0, eye_lap_var / 500.0) * 0.3 + min(1.0, mouth_var) * 0.2)
        return ExpressionResult(expression_score=round(score, 4))
    except Exception:
        return ExpressionResult(expression_score=0.0)


def _parse_openface_csv(csv_path: Path) -> ExpressionResult:
    au_cols = ["AU01_r", "AU02_r", "AU04_r", "AU05_r", "AU06_r", "AU09_r",
               "AU10_r", "AU12_r", "AU14_r", "AU15_r", "AU17_r", "AU20_r",
               "AU25_r", "AU26_r"]
    au_codes: dict[str, float] = {}
    try:
        with open(csv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            row = next(reader, None)
            if not row:
                return ExpressionResult(expression_score=0.0)
            for col in au_cols:
                if col in row:
                    try:
                        au_codes[col] = float(row[col])
                    except (ValueError, TypeError):
                        pass
    except Exception:
        return ExpressionResult(expression_score=0.0)
    if not au_codes:
        return ExpressionResult(expression_score=0.0)
    vals = list(au_codes.values())
    score = min(1.0, sum(vals) / len(vals) / 3.0)
    return ExpressionResult(expression_score=round(score, 4), au_codes=au_codes)
