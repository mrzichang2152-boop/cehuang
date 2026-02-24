# 测谎系统 - 技术文档（TECH）

> 与 `prd/PRD.md` 配套，供开发与 AI 工具（如 ibecoding）使用。  
> **需求变更时须同步更新本文档与 PRD。**

---

## 文档目录（快速导航）

| 章节 | 内容 |
|------|------|
| §1 | 技术栈与本地部署（含 Qwen 本地化） |
| §2 | 项目目录与规范（防污染、进度文档） |
| §3 | 模块边界与解耦 |
| §4 | 开发最佳实践与验证交付 |
| §5 | 需求变更与文档同步 |
| §6 | 附录（路径与接口速查） |

---

## 1. 技术栈与本地部署

### 1.1 总体技术栈

- **前端**：React / Vue / 或 纯 HTML+JS；WebSocket/SSE 接收实时分析结果；UI 见 PRD §六。
- **后端**：FastAPI (Python 3.10+)，提供 REST + WebSocket，调度分析管道。
- **分析管道**：OpenFace、FacePhys、DistilHuBERT、Qwen 语义服务（本地）、融合引擎；见 PRD §二。
- **存储**：SQLite 或 JSON 文件；可扩展 PostgreSQL。

### 1.2 Qwen2.5 本地化部署（语义分析）

语义分析依赖**本地部署**的 Qwen2.5-7B-Instruct，不依赖外网 API。

- **模型目录**（仓库外，按实际路径引用）：
  - 路径：`<workspace_parent>/Qwen2.5-7B-Instruct/`
  - 示例绝对路径：`/home/user/下载/cehuang/Qwen2.5-7B-Instruct`
  - 内含 `generation_config.json`、权重等；生成参数见该文件（如 `temperature`、`top_p`、`repetition_penalty`）。

- **本地服务脚本**（仓库外，独立进程运行）：
  - 路径：`<workspace_parent>/qwen2_5_7b_server.py`
  - 示例：`/home/user/下载/cehuang/qwen2_5_7b_server.py`
  - 行为：加载上述模型目录，暴露 HTTP 接口；默认监听 `0.0.0.0:8000`。
  - 环境变量：
    - `QWEN_MODEL_PATH`：覆盖模型目录，默认即上述 `Qwen2.5-7B-Instruct` 路径。
    - `QWEN_USE_GPU=1`：使用 GPU（4bit 量化）；未设置或 `0` 则 CPU。
  - 启动示例：`python qwen2_5_7b_server.py --host 0.0.0.0 --port 8000`

- **测谎系统调用方式**：
  - 后端 `qwen_semantic_service` 通过 HTTP 调用本地服务，**不**在测谎项目内启动或加载模型。
  - 接口：`POST http://<host>:8000/chat`，body 见 PRD §7.3、§7.4；system 提示词用于“逻辑漏洞与矛盾”分析。
  - 配置：Qwen 的 base URL（含端口）由配置或环境变量提供，默认 `http://localhost:8000`，便于不同环境切换。

- **约定**：
  - 不在 `cehuangxitong` 仓库内复制大模型权重或 `qwen2_5_7b_server.py`；仅通过配置/文档引用上述路径与接口。
  - 若路径或端口变更，需同步更新：本技术文档 §6、后端配置、PRD 中“Qwen 集成”相关描述。

### 1.3 其他外部依赖（开源栈）

三个开源项目及 rPPG 备选方案的**详细说明、安装、I/O、集成方式**见 **`docs/OPENSOURCE_STACK.md`**。此处仅作索引：

- **OpenFace**（https://github.com/TadasBaltrusaitis/OpenFace）：人脸 landmark、AU、头姿、凝视；C++ 可执行文件，通过 CLI 或 Docker 调用；单帧用 `FaceLandmarkImg`，视频/序列用 `FeatureExtraction`；输出 CSV 含 AU\*_r、pose、gaze 等，解析后映射为 `expression_score`。
- **FacePhys / rPPG**：FacePhys 论文已发表，官方代码若未公开则先用 **pyVHR / vitallens / advanced-rppg** 等 Python 库实现心率维度；接口统一为短时人脸视频 → `bpm`, `heart_rate_score`。
- **DistilHuBERT**（https://huggingface.co/ntu-spml/distilhubert）：16 kHz 语音特征提取，HuggingFace `transformers` 加载；输出特征再接分类/回归得到 `tone_score`。

---

## 2. 项目目录与规范（防污染、进度文档）

### 2.1 目录结构（与 PRD §八 一致）

```
cehuangxitong/
├── prd/
│   └── PRD.md                 # 唯一产品需求文档
├── docs/                      # 项目级文档（仅允许的文档位置之一）
│   ├── TECH.md                # 本技术文档
│   └── PROGRESS.md            # 唯一进度/变更日志（见 §2.2）
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── routers/
│   ├── services/
│   ├── models/
│   └── store/
├── frontend/
│   ├── pages/
│   ├── components/
│   └── api/
├── scripts/                   # 可执行脚本（构建、部署、校验等）
│   └── (命名见 §2.3)
├── tests/                     # 自动化测试
├── .cursor/
│   └── rules/                 # Cursor 规则
├── requirements.txt
├── README.md
└── .env.example
```

### 2.2 进度文档（单一事实来源）

- **唯一进度文档**：`docs/PROGRESS.md`。
  - 记录内容：**在什么时候做了哪些事情**（按时间倒序或按版本块）。
  - 每次功能交付、重要修复或迭代结束时，必须在此追加一条记录；AI 开发产生的“完成项”也应写在此处，而不是散落在其他新建的 .md 中。
- **禁止**：
  - 在项目根目录、`backend/`、`frontend/` 下新增与业务无关的 .md（如“今日总结”“AI 草稿”等）。
  - 在仓库内新建“进度”“日志”类文档替代 `docs/PROGRESS.md`。
- **允许**：
  - 在 `docs/` 下新增与架构、接口、运维相关的说明（如 `docs/API.md`、`docs/DEPLOY.md`），但需在 `PROGRESS.md` 中记一笔并保持索引清晰。

### 2.3 脚本与临时产出（防污染）

- **脚本放置**：所有可执行脚本（如启动、构建、一键校验、数据准备）放在 `scripts/` 下，命名清晰（如 `run_backend.sh`、`verify_delivery.sh`）。
- **禁止**：
  - 在项目根或 `backend/`/`frontend/` 下新增未在 PRD/TECH 中约定的零散脚本或“临时”脚本；若确需临时脚本，用毕后删除或在 `PROGRESS.md` 中说明并移入 `scripts/` 或删除。
- **AI 生成文档**：
  - 若 AI 生成说明性 .md，只允许写入 `docs/` 且需符合命名约定（如 `API.md`、`RUNBOOK.md`），并在 `docs/PROGRESS.md` 中记录；不得在源码目录下新增“说明.md”“笔记.md”等。

### 2.4 环境与配置

- 敏感或环境相关配置使用 `.env`，仓库内只提供 `.env.example` 模板。
- Qwen 服务地址、API base URL、端口等均在配置/环境变量中读取，不写死在本仓库代码里（模型路径在技术文档中说明，见 §1.2）。

---

## 3. 模块边界与解耦

### 3.1 原则

- 每个功能模块**尽量解耦**，便于单独测试与后续迭代。
- 模块间通过**明确接口**（函数签名、HTTP、消息格式）交互，避免直接依赖实现细节。

### 3.2 后端模块边界

| 模块 | 目录/文件 | 对外接口 | 依赖 |
|------|-----------|----------|------|
| 会话管理 | `routers/sessions.py` + 存储层 | REST：创建/结束会话 | store、models |
| 报告 | `routers/reports.py` | REST：获取报告 | store、models |
| 分析入口 | `routers/analyze.py` 或 WebSocket 处理 | 接收帧/音频，返回结果 | services/* |
| OpenFace | `services/openface_service.py` | 函数：输入图像 → 表情结果 JSON | 无（或仅配置） |
| FacePhys | `services/facephys_service.py` | 函数：输入视频片段 → 心率结果 JSON | 无（或仅配置） |
| DistilHuBERT | `services/distilhubert_service.py` | 函数：输入音频 → 语调结果 JSON | 无（或仅配置） |
| Qwen 语义 | `services/qwen_semantic_service.py` | 函数：输入文本 → 语义结果 JSON；内部 HTTP 调本地服务 | 配置（URL） |
| 融合引擎 | `services/fusion_engine.py` | 函数：四维度结果 → lie_probability + dimensions | 无 |

- **qwen_semantic_service** 仅通过 HTTP 调用本地 Qwen 服务，不加载模型；本地服务由外部单独启动（见 §1.2）。
- 新增分析维度或替换某模块时，只改对应 service 与融合权重/规则，不破坏其他模块。

### 3.3 前端模块边界

- 按页面/路由划分（见 PRD §四）；每页对应单一入口组件，子组件放在 `components/`。
- API 与 WebSocket 封装在 `api/` 下，页面只依赖封装层，不直接写 fetch/ws 逻辑到页面深处。

### 3.4 数据与配置

- 共享数据模型（Session、Report、分析结果）集中在 `backend/models/`（或等价 Pydantic/类型定义），避免在各处重复定义；接口变更时优先改此处并同步 PRD §7.3。

---

## 4. 开发最佳实践与验证交付

### 4.1 最佳实践（不过度抽象）

- **代码**：命名清晰、函数/类职责单一；优先可读与可维护，不引入不必要的抽象层（如无需求的“通用框架”）。
- **配置**：集中从环境/配置文件读取；不同环境用不同 .env 或配置源。
- **错误处理**：关键路径有日志与明确错误返回；调用 Qwen 等外部服务时处理超时与不可用。
- **依赖**：`requirements.txt` 固定版本；新增依赖时注明用途。

### 4.2 验证后再交付

- **交付前必须**：
  - 本地或 CI 运行相关测试（若已有 `tests/`）。
  - 关键路径**手工或脚本校验**：如“创建会话 → 发一帧 → 收到结果 → 结束会话 → 能拿到报告”。
  - 若涉及 Qwen：确认本地服务已启动且 `/chat` 可调通。
- **交付物**：
  - 代码/配置变更已提交；若影响接口或行为，已在 `docs/PROGRESS.md` 记录，并视情况更新 PRD 或本技术文档。

### 4.3 校验清单（可脚本化）

- [ ] 后端启动无报错；健康检查接口（若有）返回 200。
- [ ] 前端构建通过；可打开设备检测页并选择设备。
- [ ] 创建会话接口返回 `session_id`。
- [ ] 发送一帧/音频后，能在规定时间内收到分析结果（或 WebSocket 推送）。
- [ ] 结束会话后，能通过接口获取报告，且报告结构符合 PRD §7.3。
- [ ] Qwen 服务关闭时，语义维度降级或明确“不可用”，其他维度仍可用（若已实现）。

---

## 5. 需求变更与文档同步

- **当需求发生变动时**：
  1. **先更新** `prd/PRD.md`：修改或补充对应章节（功能、页面、接口、数据模型等）。
  2. **再更新** `docs/TECH.md`：若涉及技术选型、目录结构、模块边界、本地部署方式、验证清单，须同步修改本技术文档。
  3. **最后** 在 `docs/PROGRESS.md` 中记录本次需求变更及对应 PRD/TECH 修改点。
- **AI 开发时**：若用户或上下文指出“需求有变”，在改代码前先完成上述 PRD + TECH 的更新，再实现。

---

## 6. 附录：路径与接口速查

### 6.1 Qwen 本地部署（本机示例）

| 项目 | 值 |
|------|-----|
| 模型目录 | `/home/user/下载/cehuang/Qwen2.5-7B-Instruct` |
| 服务脚本 | `/home/user/下载/cehuang/qwen2_5_7b_server.py` |
| 默认 URL | `http://localhost:8000` |
| 语义分析接口 | `POST /chat`，body 见 PRD §7.3 |

### 6.2 测谎系统关键接口（与 PRD §7 一致）

- `POST /sessions` → `session_id`
- `POST /sessions/:id/end` → `report_id`
- `GET /sessions/:id/report` → Report JSON
- WebSocket：帧/音频 → 实时 result（lie_probability + dimensions）

---

*本文档与 PRD 同步维护；需求或技术决策变更时请同时更新两处。*
