# 未来再见 · 制作进度

> 最后更新：2026-09-27 17:42 ｜ 当前阶段：**PV 已完成交付（17/17）** ｜ 累计花费：¥109.50

崩坏3《女武神的餐桌Ⅱ》第八话插曲《未来再见》· AI 翻填翻唱 + AI 生成 PV。

- 预算：`budget.totalCny = 150`，剩余 **¥40.50**
- 花费事实来源：[成本台账.csv](成本台账.csv) ｜ 配置：[翻填项目.json](../翻填项目.json)（`budget.spentCny = 109.5`）
- 量化基线：**17 段 / 165.875s / 3981 帧 @24fps**，交付 1344×768 + 1920×1080

---

## 一、阶段总表

| # | 阶段 | 状态 | 产物 | 验收 | 花费 |
|---|---|---|---|---|---|
| 1 | 素材盘点 | ✅ | [material_survey.md](../10_h3video/pv/plan/material_survey.md) | 27 张 CG 已核（分辨率/logo/适配性逐张结论） | ¥0 |
| 2 | 人声/伴奏分离 | ✅ | [02_stems/](../02_stems/) | 伴奏 + 人声两轨；`bs_roformer_ep_317_sdr_12` | ¥0 |
| 3 | 扒谱 / 对齐版 MIDI | ✅ | [03_midi/](../03_midi/)、[未来再见_对齐版_156BPM.mid](../07_mix/未来再见_对齐版_156BPM.mid) | 按目标工程 156 BPM 写 tick | ¥0 |
| 4 | ACE 出人声 | ✅ | [翻填.Vocals.wav](../09_aceproject/初调/翻填.Vocals.wav) | 德丽莎声库渲染；换声库后已重铺歌词并回读校验 | ¥0 |
| 5 | SVC 换音色 | ⏸ | [06_svc/](../06_svc/) | 链路备好但**未用于最终成品**（DDSP-SVC） | ¥0 |
| 6 | 混音 + 响度 | ✅ | [翻填.wav](../09_aceproject/初调/翻填.wav)（母版 165.86s） | 成片实测 **−14.1 LUFS / TP −1 dBFS**（±1 达标） | ¥0 |
| 7 | 歌词对齐 | ✅ | [lyrics_timing.csv](../10_h3video/pv/plan/lyrics_timing.csv)、[alignment_report.md](../10_h3video/pv/plan/alignment_report.md) | 24/24 句对齐；**20/24 句 ≤0.32s**；3 句超 0.4s（最大 0.810s） | ¥0 |
| 8 | 分镜 | ✅ | [segments.json](../10_h3video/pv/plan/segments.json)、[shotlist.csv](../10_h3video/pv/plan/shotlist.csv) | **17 段**，无缝铺满；每段 ≤15s；零切断歌词句 | ¥0 |
| 9 | 边界吸附 | ✅ | [alignment_report.md](../10_h3video/pv/plan/alignment_report.md) | 157s → **159.5s**（静音余量 73.195 dB） | ¥0 |
| 10 | 参考图（去水印+缩放） | ✅ | [refs/](../10_h3video/pv/refs/) | **11 张** `ref_*.jpg`（从普查的 27 张 CG 中选出） | ¥0 |
| 11 | prompt 自检 | ✅ | [prompts/](../10_h3video/pv/prompts/) | 17/17 合规（≤7000 字符、无对白块、无字幕词） | ¥0 |
| 12 | 出片（H3） | ✅ 17/17 | [clips/](../10_h3video/pv/clips/) | 生成 174s；逐段 ffprobe 通过 | **¥109.50** |
| 13 | 字幕 | ✅ | [未来再见.ass](../10_h3video/pv/subs/未来再见.ass)、[未来再见_1080.ass](../10_h3video/pv/subs/未来再见_1080.ass) | **24/24 句**全部出现；单一字体 Microsoft YaHei | ¥0 |
| 14 | 合成 | ✅ | [未来再见_PV_v2.mp4](../10_h3video/pv/未来再见_PV_v2.mp4) | 1344×768 / 165.875s / 3981 帧 | ¥0 |
| 15 | 超分 1080p | ✅ | [未来再见_PV_v2_1080p.mp4](../10_h3video/pv/未来再见_PV_v2_1080p.mp4) | 1920×1080 / 210.5 MB / 10647 kbps（本地 Real-ESRGAN） | ¥0 |
| 16 | 核验 | ✅ 7/7 | [report.md](../10_h3video/pv/verify/report.md) + 抽帧 | **7/7 全过**；原创性最大 SSIM 0.522；链式接点 0.788 / 0.885 | ¥0 |
| 17 | 封面 | 🔄 | [cover/](../10_h3video/pv/cover/) | 4 版已出（A/B/C/D × 两种尺寸），**待用户定稿** | ¥0 |
| 18 | 投稿文案 | ✅ | [投稿文案.md](../10_h3video/pv/投稿文案.md) | 含原曲署名 + AI 标识 + 非商用声明 | ¥0 |

> `花费` 列合计 **¥109.50** = 头部累计，与 [成本台账.csv](成本台账.csv) 末行一致。
> 除出片（第 12 行）外全部为本地算力，**¥0**。

---

## 二、操作日志（新→旧）

### 2026-09-27 17:00 ｜ 重出段 13（修正末帧衔接）
- 命令：`node scripts/82_pv_clips.mjs --only 13 --max-cost 25`
- 产物：`10_h3video/pv/clips/13_inter_b.mp4`（1344×768 / 10.13s / H3 任务 `4463…`）
- 花费：**¥6.50**（累计 **¥109.50**）
- 证据：[成本台账.csv](成本台账.csv) 第 5 行；[report.md](../10_h3video/pv/verify/report.md) §6 接点 12→13 **SSIM 0.885**（链式接点 ≥0.60 达标）

### 2026-09-27 15:50 ｜ 重出段 1/2/3/6（改连续三镜版）
- 命令：`node scripts/82_pv_clips.mjs --only 1,2,3,6 --max-cost 25`
- 产物：`clips/01_intro_title.mp4`、`02_intro_origin.mp4`、`03_intro_credits.mp4`、`06_v1_miss.mp4`
  （段 01/02/03 改参考 `01_input/CG/10th.jpg` 且三镜**必须连续**；段 06 改参考 `ElysianRealm.png`）
- 花费：**¥22.50**（累计 **¥103.00**）
- 证据：[成本台账.csv](成本台账.csv) 第 4 行；[cost_log.csv](../10_h3video/pv/plan/cost_log.csv) 末 4 行；
  接点 1→2 **SSIM 0.866**、2→3 **0.929** 证明三镜连续；旧版归档见 §四

### 2026-09-27 14:45 ｜ 首轮批量出片（段 1–17）
- 命令：`node scripts/82_pv_clips.mjs --max-cost 78`（波次并行）
- 产物：`clips/*.mp4` **17 段** + `plan/cost_log.csv`
- 花费：**¥71.50**（累计 **¥80.50**）｜ 生成 **174s**（逐段向上取整），名义预估 **¥87.00**
- 证据：[成本台账.csv](成本台账.csv) 第 3 行；`cost_log.csv` 逐段任务 id 与实测时长；
  **段 8 首两次提交失败未计费**（¥0，第三次成功 ¥6.50）——失败也记账

### 2026-09-27 14:30 ｜ 试片（段 5 + 段 7）
- 命令：`node scripts/82_pv_clips.mjs --only 5,7 --max-cost 10`
- 产物：`clips/05_v1_growth.mp4`、`clips/07_v1_xinyan.mp4`
- 花费：**¥9.00**（累计 **¥9.00**）｜ H3 768P **18s**
- 证据：[成本台账.csv](成本台账.csv) 第 2 行；[cost_estimate.md](../10_h3video/pv/plan/cost_estimate.md) 末行
  「试片（段 5 + 段 7）= 18s ≈ ¥9.00」——**先试片验证链路可用，再批量**

---

## 三、待用户决定

- [ ] **封面定稿**：已出 A/B/C/D 四版，各两种尺寸（1344×768 / 1146×717）
      → [cover/](../10_h3video/pv/cover/)（配置里暂记 `preset = D_10th`）
- [ ] **是否要 2K 真出片**：`h3-2k-regen` ¥0.30/s，全片 165.86s 约 **¥49.76**（**未实测**，本歌未用过 2K）
- [ ] **LRC 三句超阈值是否回头修**：第 6 句 −0.78s / 第 17 句 −0.57s / 第 24 句 +0.81s
      （阈值 0.4s；字幕已按实测起音走，但 LRC 文件本身未改）

---

## 四、变更历史

- **2026-09-27 15:50 v1 → v2**：段 01/02/03 改为**连续三镜**（参考 `01_input/CG/10th.jpg` 十周年礼服群像）；
  段 06 改用 `ElysianRealm.png`（往世乐土·金色夕阳群像），贴合「未曾想如若就此擦肩 / 会是此生错过最大的遗憾」；
  片头三张信息卡内容不变。
  - 旧版归档：[history/20260927-233420/](../10_h3video/pv/history/20260927-233420/) 内 `未来再见_PV_v1.mp4`（165.88s）、
    被替换的 4 段旧成片与旧提示词、`cost_log_v1.csv`、`report_v1.md`，改因见其 [README.md](../10_h3video/pv/history/20260927-233420/README.md)

---

## 五、本次开发进度（翻填视频工作流）

把「这一次跑通」固化成「下次能复用」的六个交付物（计划书：[00_docs/06_翻填视频工作流_开发计划.md](../00_docs/06_翻填视频工作流_开发计划.md)）。

| # | 交付物 | 状态 | 产物 | 验收 |
|---|---|---|---|---|
| 1 | **技能**「翻填视频流水线」 | ✅ | [.agents/skills/fanfill-video-pipeline/](../.agents/skills/fanfill-video-pipeline/) | `SKILL.md` + [references/](../.agents/skills/fanfill-video-pipeline/references/)（01–08 共 8 份）；进度文档与目录约定为强制条款。**已在活体会话里被 `skill` 工具列出并成功加载**（技能名 `fanfill-video-pipeline`） |
| 2 | 脚本配置化（`80–87`） | ✅ | [scripts/](../scripts/) | 新增 [lib/fanfill-config.mjs](../scripts/lib/fanfill-config.mjs)（配置读取 / 参数解析 / `--plan` / ffprobe JSON / 非覆盖命名）；**8 支脚本全部读配置 + 全部支持 `--plan`，残留本歌硬编码 0 处**。回归：`80` 重跑**逐字节一致**（17 段 / 边界 / 174s / ¥87.00 / 歌词时间轴 CSV）；`85` 重跑报告**除时间戳外逐字节一致**；`83` 两次实跑 4 个字幕文件 **sha256 相同**；另用探针副本验证 `81` 参考图 11/11、`86` 封面 8/8 逐字节相同。细节见 [改动报告](../dev/_probe/改动报告_20260928.md) |
| 3 | 预设「翻填视频工作流」 | 🔄 | [dev/翻填工作流预设/](../dev/翻填工作流预设/) | 已装上（`preset-fantian-video`，persona 写死开场加载技能与硬纪律）；`dsh --profile web --dump-config` 确认合成树含该行且无新报错。**未验收（需用户操作）**：新建会话选该预设是否技能在场、`mcp__h3__*` 可用 —— 现有进程的会话是在改动前建的，选不到新预设，**重启 `dsh web` 后请点一次** |
| 4 | 工作台（Web UI 插件） | ✅ | [dev/翻填工作台/](../dev/翻填工作台/) | **已在真实 GUI 里截图验收**（证据 [dev/_probe/gui-verify/](../dev/_probe/gui-verify/)）：右侧栏出现「翻填工作台」页签，5 个 Tab（歌词/素材/清单/出片/账本）全部渲染真实数据，逐个切换采集 **console.error = 0 条**；样式逐条核对全部走 `--dsw-*` 主题 token。亮/暗主题只做了代码层核对、**未实际切亮色截图**，见 [07_工作台能力探测报告.md](../00_docs/07_工作台能力探测报告.md) §6 |
| 5 | **进度文档** | ✅ | 本文件 | 覆盖全阶段、产物路径可点击、含操作日志与账本 |
| 6 | 端到端回归 | ✅ | [dev/_probe/final-audit.mjs](../dev/_probe/final-audit.mjs) | **DoD + 非破坏性核验 28 项全过、0 失败**；换歌验证通过（见下） |

### 换歌验证（DoD 最后一项：证明真的通用）

在系统临时目录建了一个**空壳工作区**，刻意用与《未来再见》完全不同的参数——
歌名 `测试歌_换歌验证`、总长 30s、**40BPM**、**9:16 画幅**、`video.dir = 10_video`（不是 `10_h3video`）、
`segMaxSec = 12`（不是 15）—— 用 ffmpeg 合成一段测试音频后跑：

- `80_pv_shotlist.mjs --plan` 与实跑 **exit 0，零报错**；
- 产物落在配置指定的 `10_video/plan`（**证明没有硬编码 `10_h3video`**）；
- 段长 ≤12s、单价 0.5、分辨率档 768P **全部取自配置**；
- 边界自动吸附到静音谷（`0,9,18,27` → `0–6.88, 6.88–15.9, 15.9–24.88, 24.88–30`），`problems` 为空；
- `80b` 对新歌如实报「只有骨架文件，提示词尚未撰写」（**不是**误报"文件缺失"，也不是误判通过）。

脚本：[dev/_probe/gensong-test.mjs](../dev/_probe/gensong-test.mjs)。

### 开源发布：`fanfill-video-pipeline`

把「可复用的那一半」抽成独立仓库并推到 GitHub：**https://github.com/gychen-NJU/fanfill-video-pipeline**（public，49 个文件 / 676 KB，**MIT 许可**，`master` @ `f98f57a`）。

- **做法**：不直接在工作区 `git init`（那里有 12.6 GB cache + 6.3 GB venvs + 2.1 GB 产物 + 244 MB 截图，一次失误就提交出几百 MB），而是用
  [dev/_probe/stage-repo.mjs](../dev/_probe/stage-repo.mjs) **复制**到一个干净 staging 目录再发布——工作区原文件零改动。
- **带走**：技能（9 文件）、PV 脚本（10）、出片驱动 + MCP server（4）、工作台插件（4）、预设（2）、文档（7：英文 `INSTALL.md` 与 `BOOTSTRAP.md` + 配置规范 + 能力报告 + 原项目三份 SOP）、`examples/`（8，只放文本：配置/进度/台账/成本/对齐/核验/分镜/文案）、自检工具（2）、根目录 `README.md` / `LICENSE` / `.gitignore`。合计 49 文件。
- **没带走**：任何音频/视频/图片。`01_input`/`02_stems`/`09_aceproject`/`music` 与全部成片都留在本地——它们是第三方二创素材，不适合入库。
- **体格检查（已做）**：无明文密钥、无媒体文件、无 >200KB 文件（最大 42 KB）、`client.js` 模块 id 与包名一致、无机器专属死码。
- **发布前的可移植性修补**（3 处，都同步回本工作区）：
  1. `fanfill-config.mjs` 的 ffmpeg 路径改成**可解析**——`FANFILL_FFMPEG_DIR` 环境变量 > `video.ffmpegDir` 配置 > 历史默认 > PATH 兜底，并打印一次提示；
  2. `82_pv_clips.mjs` 的出片驱动路径支持 `FANFILL_H3` / `video.h3Driver` 覆盖，缺失时前置报错并给出三条出路；
  3. `ui-workbench/client.js` 删掉探测期的 URL 编码兜底死码（换机器必然打不中）。
- **安装文档（补做）**：README 原来只有一句 Requirements 清单、没有安装步骤。
  已补 `### 0. Install`（依赖表 + Windows ffmpeg 影子版陷阱 + 一条命令自检 + **可复制给 agent 的安装指令**）
  与 `docs/BOOTSTRAP.md`（166 行 agent 侧清单：每步一个确切命令 + 期望结果 + 失败回退，
  并写明"逐步验证、不许编造成功、只向用户要 API key 与 `dsh web` 重启"）。
  **用全新克隆实测过**：`resolveFfmpeg()` 正常返回、`smoke-test` 13/13、故意把 ffmpeg 指到不存在的目录时
  优雅退回 PATH 并给出一次性提示（不抛异常）。
- **顺手抓到一个真 bug（已修）**：工作台 Host 半边对 `video.*Dir` 直接取配置值，
  而规范 §4.1 说这些字段**可省略**、缺省应按 `<video.dir>/<子目录>` 推导。
  结果：只写 `video.dir` 的最小配置下，`promptDir`/`refDir`/… 全部解析成 `undefined`
  → 面板「产物目录规模」与「prompt 字符数自检」**静默显示 0**（看起来像没产物，其实有）。
  已加 `videoDir()` 兜底；仓库里新写的 `tools/smoke-test.mjs` 会在合成工作区上复现并守住这条
  （13 项自检全过）。

### 本次修掉的问题（都有据可查）

- **工作台白屏（真实 bug，已修）**：Client 半边第一次注册的模块 id 写成了 `fantian-workbench`，
  而 boot 校验要求它**逐字等于** `package.json` 的 `name` → 整批插件加载失败、页面白屏。
  改为 `dsh-fantian-workbench` 后刷新即正常。
- **`dev/翻填工作台/package.json` 被 PowerShell 弄成乱码**（`Get-Content`/`ConvertFrom-Json` 往返）——
  正是本项目自己文档里警告的那个坑。已用 Node 重写为干净 UTF-8。
- **分镜 `mode` 字段与实际不符（13 处）**：`segments.json` 里段 1 标 T2VA、10 段标 I2VA，
  但 `prompts/ref2va/` 下有它们的提示词文件，`cost_log.csv` 也记的是 `ref2va`。
  已按证据修正为 `Ref2VA 11 段 / I2VA 5 段 / FL2VA 1 段`。
- **`plan/cost_log.csv` 与台账对不上**：cost_log 合计 **¥100.50**，台账累计 **¥109.50**，
  差额 **¥9.00 = 段 5+段 7 的试片轮**（cost_log 没有这一轮）。
  **结账以 [成本台账.csv](成本台账.csv) 为准**；未能证实的行**没有补**（宁留标注缺口，不往账里塞数字）。
- **文档数字修正**：`05_PV制作流水线.md` 与计划书的「21/24 句 ≤0.32s」实为 **20/24**（已改）。
- **超分模型口径**：`87_pv_upscale.mjs` 的实际默认是 `realesr-animevideov3`，
  已据此把 `翻填项目.json` 的 `video.upscale.model` 改对（原先写的 `realesrgan-x4plus` 是错的）。

### 已知缺口（诚实记录）

- 交付物 2/3/6 状态仍是 🔄：**文件已写、安装已挂，但未逐项验收**，不要当成已完成。
- **创建预设时 `customSkillDirs` 指向 `dev/shared/skills`，该目录当前不存在**
  （技能实际由 rank 200 的 `<项目根>/.agents/skills` 发现，功能不受影响）。
  跨歌共享资产目录待建。
- 素材数量：「27 张 CG」取自 [material_survey.md](../10_h3video/pv/plan/material_survey.md) 的普查范围；
  `01_input/CG` 目录现有 **38 个文件**，差额未核对（普查后可能新增素材）——**未实测**。
- 「生成 174s / 名义预估 ¥87.00」是 [cost_estimate.md](../10_h3video/pv/plan/cost_estimate.md) 的口径（逐段向上取整）；
  `segments.json.totals` 亦为 `{generatedSeconds: 174, estimatedCny: 87}`。
  实际花费以 [成本台账.csv](成本台账.csv) 的 **¥109.50** 为准（含试片 ¥9.00 与两轮重出 ¥29.00）。
- 母版响度：`09_aceproject/初调/翻填.wav` 实测 **−13.56 LUFS / TP −0.22 dBTP**，
  **TP 超 ≤−1 dBTP 目标**（它是 ACE 工程导出，不是交付母版）；
  `08_release/ACE_master_*.wav` 三份达标。**是否要用 release 母带替换，待用户决定**。
