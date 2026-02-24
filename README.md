# 测谎系统 (cehuangxitong)

基于实时视频的多模态测谎系统：OpenFace 表情、FacePhys 心率、DistilHuBERT 语调、本地 Qwen2.5 语义分析，融合输出说谎概率。

## 文档与规范（ibecoding / AI 开发必读）

| 文档 | 说明 |
|------|------|
| **[prd/PRD.md](prd/PRD.md)** | 唯一产品需求文档（功能、页面、接口、UI、流程图） |
| **[docs/TECH.md](docs/TECH.md)** | 技术文档（Qwen 本地部署、目录规范、模块边界、验证交付、需求变更同步） |
| **[docs/OPENSOURCE_STACK.md](docs/OPENSOURCE_STACK.md)** | 开源栈详解：OpenFace / FacePhys / DistilHuBERT 的仓库、安装、I/O、集成方式 |
| **[docs/PROGRESS.md](docs/PROGRESS.md)** | 唯一进度/变更日志（什么时候做了哪些事） |
| **.cursor/rules/** | 项目规则：进度与防污染、需求变更时更新 PRD+TECH、验证后交付、模块解耦、AI 友好 |

- 需求或技术决策变更时，须同时更新 **PRD.md** 与 **docs/TECH.md**，并在 **docs/PROGRESS.md** 记录。
- 所有可执行脚本放在 `scripts/`；说明性 .md 只放在 `docs/`，避免污染源码目录。

## 本地 Qwen 语义服务

语义分析依赖本地部署的 Qwen2.5-7B-Instruct，不包含在本仓库内。模型与启动方式见 **docs/TECH.md** §1.2、§6.1；默认服务地址 `http://localhost:8000`。

## 本地运行说明（本机一体化）

本项目为**本地化部署**：后端、前端、浏览器均在同一台机器上运行，无需公网。

**一键启动：**

```bash
cd /home/user/下载/cehuang/cehuangxitong
pip install -r requirements.txt   # 首次运行（若遇「externally-managed」见下方）
bash scripts/run_backend.sh       # 启动后端 + 前端
```

启动后在**本机浏览器**打开：**http://localhost:9000/**  
流程：设备检测 → 开始测谎（允许摄像头/麦克风）→ 会话页（实时画面与仪表盘）→ 结束会话 → 报告页。

- **端口 9000 被占用**（`address already in use`）：脚本会自动尝试释放；若仍失败可先执行 `fuser -k 9000/tcp` 再运行 `bash scripts/run_backend.sh`。
- **实时连接：未连接 / WebSocket 报错**：后端需支持 WebSocket。任选其一：
  - **系统 Python**：`sudo apt install python3-websockets`，再用当前环境启动后端；
  - **虚拟环境**：`sudo apt install python3.12-venv` → `python3 -m venv .venv` → `source .venv/bin/activate` → `pip install -r requirements.txt`，然后 `bash scripts/run_backend.sh`。
- 若页面仅提示「实时连接：未连接」且后端已启动，多半是未安装上述 WebSocket 依赖。
- 可选：先启动本地 Qwen（如 `python qwen2_5_7b_server.py --port 8000`）以启用语义分析。
- 交付前自检：`bash scripts/verify_delivery.sh`。

## 目录结构

```
cehuangxitong/
├── prd/           # 需求
├── docs/          # 技术文档与进度
├── backend/       # FastAPI + 分析管道 + 存储
├── frontend/      # 前端 SPA（设备/会话/报告/设置/历史）
├── scripts/       # 脚本（run_backend.sh, verify_delivery.sh）
├── data/          # SQLite 数据（CEHUANG_STORE=sqlite 时）
└── .cursor/rules/ # Cursor 规则
```
