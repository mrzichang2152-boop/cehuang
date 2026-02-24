# 测谎系统 - 进度与变更日志（PROGRESS）

> **唯一进度文档**：记录在什么时候做了哪些事情。所有交付、重要修复与需求变更均在此追加，避免在项目内散落其他进度类 .md。

格式说明：
- 按时间**倒序**（最新在上）。
- 每条建议包含：日期、类型（功能/修复/文档/需求变更）、简要说明、涉及文件/模块。

---

## 2025-02-22

- **修复**：会话页摄像头未调用/黑屏问题（先测试再交付）。
  - **原因**：会话页依赖 `window.__cehuang_pending_stream` 绑定到 `<video>`，存在 (1) 无 pending 时（如刷新 #session）仅调一次 getUserMedia 且失败时只提示返回设备页；(2) 绑定时机在首帧前导致部分环境黑屏；(3) 无“用户手势”内重试入口。
  - **改动**：`frontend/js/app.js`：会话页在无 pending 时立即调用 `getUserMedia`，失败时在页面内展示「启用摄像头」按钮（用户手势内重试）；`startWithStream` 使用 `requestAnimationFrame` 延后一帧绑定到当前 DOM 中的 `#session-video`，避免引用失效或未挂载；3 秒后若仍无画面则显示「启用摄像头」按钮便于同页重试；重新获取流时先关闭旧 WebSocket；`showNoStreamUi` 保留 `<video id="session-video">` 并更新 `videoEl`，便于重试成功后挂载流。
  - **建议**：后端 WebSocket 需 `pip install websockets` 或 `uvicorn[standard]`，否则会提示「未连接」；本地交付前在浏览器中走一遍：设备检测 → 允许摄像头/麦克风 → 开始测谎 → 会话页应有画面并连接 WS。

- **开发**：完整实现测谎系统（后端 + 前端 + 存储 + 分析管道 + WebSocket）。
  - **存储**：`backend/store/store.py` 支持 memory 与 sqlite；会话创建/结束、timeline 缓冲、报告生成与查询、历史列表。
  - **会话/报告路由**：`POST /sessions`、`POST /sessions/:id/end`、`GET /sessions/:id/report`、`GET /reports/:id`、`GET /sessions`；与 PRD §7 一致。
  - **分析管道**：`backend/services/pipeline.py` 接收 frame_b64/audio_b64/text，调用 OpenFace（可选）、rPPG（帧缓冲+简易 numpy 实现）、DistilHuBERT（占位）、Qwen 语义（HTTP）、融合引擎，写入 timeline 并返回 FusionResult。
  - **rPPG**：`backend/services/rppg_simple.py` 纯 numpy+opencv 实现（绿色通道 FFT 求 BPM）；`facephys_service` 支持从帧列表估计心率与 baseline。
  - **WebSocket**：`/ws` 接收 `{ type: "frame", session_id, video_base64?, audio_base64?, text? }`，推送 `{ type: "result", lie_probability, dimensions, semantic_summary }`。
  - **前端**：`frontend/` 单页应用（Hash 路由）；设备检测页（摄像头/麦克风选择与预览）、会话页（实时视频、仪表盘、结束会话）、报告页（摘要+时间线+语义发现）、设置页（API 地址）、历史列表；简约工业风样式（PRD §6）；API 与 WS 封装见 `js/api.js`。
  - **静态与 CORS**：FastAPI 提供 `/health`、`/css/*`、`/js/*` 及前端 catch-all 返回 `index.html`；CORS 允许所有来源。
  - **校验脚本**：`scripts/verify_delivery.sh` 用于交付前自检。

- **开发**：基于 OpenFace / FacePhys / DistilHuBERT 开源栈梳理与后端骨架。
  - 新增 `docs/OPENSOURCE_STACK.md`：详解三开源项目（仓库、安装、I/O、集成方式）；FacePhys 官方代码未公开，暂用 pyVHR/vitallens/advanced-rppg 作为 rPPG 备选。
  - 更新 `docs/TECH.md` §1.3：补充开源栈索引与 `OPENSOURCE_STACK.md` 引用。
  - 新增 `backend/config.py`：API、Qwen、OpenFace、rPPG、DistilHuBERT、融合权重、存储等配置（环境变量）。
  - 新增 `backend/models/schemas.py`：与 PRD 一致的数据模型（ExpressionResult、HeartRateResult、ToneResult、SemanticResult、FusionResult、Session、Report）。
  - 新增 `backend/services/`：openface_service（CLI 调用 + CSV 解析）、facephys_service（rPPG 占位）、distilhubert_service（占位）、qwen_semantic_service（HTTP 调本地 /chat）、fusion_engine（加权融合）。
  - 新增 `backend/routers/`：sessions（创建/结束会话）、reports（获取报告）；`backend/main.py` FastAPI 入口。
  - 新增 `requirements.txt`、`.env.example`、`scripts/run_backend.sh`。
  - 各模块解耦，接口以 schemas 为准；OpenFace/FacePhys/DistilHuBERT 的详细用法见 `docs/OPENSOURCE_STACK.md`。

- **文档**：初始化项目文档与规则。
  - 新增 `prd/PRD.md`（测谎系统完整 PRD，含流程图、页面、接口、UI 规范、YAML 规格）。
  - 新增 `docs/TECH.md`（技术文档：Qwen 本地部署、目录规范、模块边界、验证交付、需求变更同步）。
  - 新增 `docs/PROGRESS.md`（本文件，唯一进度日志）。
  - 新增 `.cursor/rules/cehuang-project.mdc`（进度文档、防污染、需求变更同步、AI 友好）、`cehuang-development.mdc`（验证交付、最佳实践、模块解耦）。

---

*后续每次功能交付或重要变更请在此追加一条记录。*
