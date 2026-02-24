# 测谎系统 - 多模态融合
# 输入：四维度结果（ExpressionResult, HeartRateResult, ToneResult, SemanticResult）
# 输出：FusionResult（lie_probability, dimensions）

from __future__ import annotations

from backend.config import FUSION_WEIGHTS
from backend.models import (
    ExpressionResult,
    HeartRateResult,
    ToneResult,
    SemanticResult,
    Dimensions,
    FusionResult,
)


def fuse(
    expression: ExpressionResult,
    heart_rate: HeartRateResult,
    tone: ToneResult,
    semantic: SemanticResult,
) -> FusionResult:
    """加权融合四维度，得到综合说谎概率与各维度分。"""
    d = Dimensions(
        expression=expression.expression_score,
        heart_rate=heart_rate.heart_rate_score,
        tone=tone.tone_score,
        semantic=semantic.semantic_score,
    )
    w = FUSION_WEIGHTS
    lie_probability = (
        w["expression"] * d.expression
        + w["heart_rate"] * d.heart_rate
        + w["tone"] * d.tone
        + w["semantic"] * d.semantic
    )
    lie_probability = min(1.0, max(0.0, lie_probability))
    return FusionResult(
        lie_probability=round(lie_probability, 4),
        dimensions=d,
        semantic_summary=semantic.summary,
    )
