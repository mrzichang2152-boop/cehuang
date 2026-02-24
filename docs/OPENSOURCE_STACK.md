# 测谎系统 - 开源依赖详解（OpenFace / FacePhys / DistilHuBERT）

> 本文档详细说明三个 GitHub/HuggingFace 开源项目：仓库地址、安装、输入输出、与本项目的集成方式。供开发与 AI 工具查阅。

---

## 1. OpenFace（表情与微表情）

### 1.1 项目信息

- **仓库**：https://github.com/TadasBaltrusaitis/OpenFace  
- **说明**：面部 landmark、头姿、**面部动作单元（AU）**、眼动估计；支持单图、视频序列、实时摄像头。  
- **许可**：见仓库 Copyright.txt；商业使用需联系 CMU。  
- **文档**：https://github.com/TadasBaltrusaitis/OpenFace/wiki  

### 1.2 安装与构建

- **方式一（推荐）**：在仓库根目录执行  
  `bash ./download_models.sh`  
  然后  
  `sudo bash ./install.sh`  
- **方式二**：按 [Unix Installation](https://github.com/TadasBaltrusaitis/OpenFace/wiki/Unix-Installation) 手动安装依赖（CMake 3.8+、OpenCV 4.x、OpenBLAS、dlib、C++17），再 cmake 构建。  
- **Docker**：仓库提供 `docker/` 与 `docker-compose.yml`，可构建镜像后通过容器调用可执行文件。  

### 1.3 可执行文件与用法

| 可执行文件 | 用途 | 典型用法 |
|------------|------|----------|
| **FeatureExtraction** | 单脸视频/图像序列 | `FeatureExtraction -f video.avi` 或 `-fdir /path/to/frames` |
| **FaceLandmarkImg** | 单张或多张图片（可多人） | `FaceLandmarkImg -f image.jpg` 或 `-fdir /path/to/images` |
| **FaceLandmarkVidMulti** | 多人视频 | `FaceLandmarkVidMulti -f video.avi` |

- 输出目录：默认在当前工作目录下生成 `processed/`。  
- 输出格式：CSV，详见 [Output Format](https://github.com/TadasBaltrusaitis/OpenFace/wiki/Output-Format)。  

### 1.4 与本项目相关的输出列

- **AU 强度（0–5）**：`AU01_r`, `AU02_r`, `AU04_r`, `AU05_r`, `AU06_r`, `AU09_r`, `AU10_r`, `AU12_r`, `AU14_r`, `AU15_r`, `AU17_r`, `AU20_r`, `AU25_r`, `AU26_r` 等。  
- **AU 出现（0/1）**：`AU04_c`, `AU12_c`, `AU15_c`, `AU23_c`, `AU28_c`, `AU45_c`。  
- **头姿**：`pose_Tx`, `pose_Ty`, `pose_Tz`, `pose_Rx`, `pose_Ry`, `pose_Rz`。  
- **凝视**：`gaze_0_x/y/z`, `gaze_1_x/y/z` 或 `gaze_angle_x`, `gaze_angle_y`。  
- **成功/置信度**：`success`, `confidence`。  

### 1.5 测谎系统集成方式

- **单帧**：后端将收到的视频帧写入临时目录或临时视频，调用 `FaceLandmarkImg -f <path>` 或 `FeatureExtraction -fdir <dir>`，解析生成的 CSV 取最新一行 AU/pose/gaze，映射为 `expression_score`（0–1）及可选 `au_codes`。  
- **实时/多帧**：可写短时视频片段，用 `FeatureExtraction -f <temp_video>`，解析 CSV 最后几行做滑动或聚合。  
- **接口约定**：输入为 RGB 图像（文件路径或 numpy 写入临时文件）；输出为 JSON：`expression_score`, `micro_expression_flags`, `au_codes`（或等价键），见 PRD §5.3。  

---

## 2. FacePhys / rPPG（心率）

### 2.1 FacePhys 项目信息

- **论文**：FacePhys: State of the Heart Learning（如 arXiv:2512.06275）。  
- **特点**：时序-空间状态空间、低内存（约 3.6 MB）、每帧约 9.46 ms、实时；官方演示 https://www.facephys.com 。  
- **代码**：截至当前，**未找到官方公开 GitHub 仓库**；若后续开源，优先接入。  

### 2.2 当前可选 rPPG 开源方案（Python）

在 FacePhys 官方代码未公开前，可采用以下任一方案实现“心率/HRV”维度，接口与 PRD 保持一致（输出 `bpm`, `heart_rate_score` 等）：

| 项目/库 | 说明 | 安装 | 备注 |
|---------|------|------|------|
| **pyVHR** | 远程光电容积脉搏 Python 框架 | `pip install pyvhr` 或见 [PeerJ](https://peerj.com/articles/cs-929) | 多种算法、可评估 |
| **vitallens** | 本地经典 rPPG（POS/CHROM 等）+ 云端 API | `pip install vitallens`，Python ≥3.9 | 支持视频与 numpy |
| **advanced-rppg** | 实时心率、多算法、HRV、GUI | `pip install advanced-rppg`，Python ≥3.8 | 可从视频/摄像头取 BPM |
| **rPPG-Toolbox** | 深度学习 rPPG 工具箱 | 见 [GitHub/论文](https://arxiv.org/abs/2210.00716) | 需自行查找仓库 |

- 本项目 **facephys_service**（或 **rppg_service**）对外接口不变：输入为短时视频片段（文件路径或帧列表），输出为 `bpm`, `hrv_summary`（可选）, `heart_rate_score`（0–1）。  
- 内部可先实现一档“经典 rPPG”（如 vitallens 或 pyVHR），待 FacePhys 开源后替换为 FacePhys 推理。  

### 2.3 测谎系统集成方式

- 输入：10–30 秒人脸视频片段（可由 OpenFace 或其他人脸检测提供 ROI，或整帧）。  
- 输出：BPM、可选 HRV；与基线比较后得到 `heart_rate_score`。  
- 模块位置：`backend/services/facephys_service.py`（或 `rppg_service.py`），实现为可插拔：当前用 pyVHR/vitallens/advanced-rppg 之一，后续可换成 FacePhys。  

---

## 3. DistilHuBERT（语调/语音特征）

### 3.1 项目信息

- **HuggingFace 模型**：https://huggingface.co/ntu-spml/distilhubert  
- **论文**：DistilHuBERT: Speech Representation Learning by Layer-wise Distillation of Hidden-unit BERT。  
- **说明**：16 kHz 语音预训练；无 tokenizer，用于**特征提取**或下游微调（如情绪、紧张度）。  
- **原始代码**：https://github.com/s3prl/s3prl/tree/master/s3prl/upstream/distiller  

### 3.2 使用方式

- **输入**：16 kHz 单声道音频（WAV 或 numpy 数组）。  
- **加载**：`transformers` 中 `AutoModel.from_pretrained("ntu-spml/distilhubert")` 或 Wav2Vec2 类（见 HuggingFace 模型卡）；仅做 forward 取隐藏层作为特征。  
- **下游**：可接线性层或小分类器得到“紧张/平静”等标签或连续分数；或直接使用某层特征的统计量（如均值、方差）作为语调相关特征，再映射为 `tone_score`（0–1）。  

### 3.3 测谎系统集成方式

- 输入：音频片段（与前端上传格式一致，如 WAV/WebM 转 16 kHz mono）。  
- 输出：JSON：`tone_score`, `tension_level`（可选）, `embedding`（可选）。  
- 模块位置：`backend/services/distilhubert_service.py`；依赖 `transformers`, `torch`，在 `requirements.txt` 中声明。  

---

## 4. 小结与接口对应

| 维度 | 开源项目 | 输入 | 输出（测谎统一） |
|------|----------|------|------------------|
| 表情 | OpenFace | 单帧/短视频或图像目录 | expression_score, au_codes, micro_expression_flags |
| 心率 | FacePhys（或 pyVHR/vitallens/advanced-rppg） | 短时人脸视频 | bpm, heart_rate_score, hrv_summary(可选) |
| 语调 | DistilHuBERT (ntu-spml/distilhubert) | 16kHz 音频 | tone_score, tension_level |
| 语义 | 本地 Qwen2.5（见 TECH.md §1.2） | 文本 | semantic_score, contradictions |

- 所有 service 输出与 `docs/TECH.md`、`prd/PRD.md` §5、§7 一致；融合引擎仅依赖上述 JSON 字段，便于后续替换实现（如 FacePhys 开源后替换 rPPG 后端）。  

---

*若 FacePhys 或 OpenFace 的官方使用方式有更新，请同步更新本文档与 TECH.md。*
