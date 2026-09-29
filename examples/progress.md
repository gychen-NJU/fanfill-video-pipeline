# 未来再见 · 制作进度

> 最后更新：2026-09-29 05:10 ｜ 当前阶段：**PV 已交付（17/17）；1080p 字幕已按画布等比重烧** ｜ 累计花费：¥109.50

崩坏3《女武神的餐桌Ⅱ》第八话插曲《未来再见》· AI 翻填翻唱 + AI 生成 PV。

- 预算：`budget.totalCny = 150`，剩余 **¥40.50**
- 花费事实来源：[成本台账.csv](成本台账.csv) ｜ 配置：[翻填项目.json](../翻填项目.json)（`budget.spentCny = 109.5`）
- 量化基线：**17 段 / 165.875s / 3981 帧 @24fps**，交付 1344×768 + 1920×1080
- 1080p 交付物（2026-09-29 01:54 重烧）：**210.2 MB / sha256 `63B96A02…`**；
  被替换的旧版（210.5 MB / `F922FF3E…`）在 [history/2026-09-28_17-50-21/](../10_h3video/pv/history/2026-09-28_17-50-21/)

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
| 13 | 字幕 | ✅ | [未来再见.ass](../10_h3video/pv/subs/未来再见.ass)、[未来再见_1080.ass](../10_h3video/pv/subs/未来再见_1080.ass) | **24/24 句**全部出现；单一字体 Microsoft YaHei；**2026-09-29 修正：1080p 字号随画布等比缩放**（Lyric 77，旧版误为 54） | ¥0 |
| 14 | 合成 | ✅ | [未来再见_PV_v2.mp4](../10_h3video/pv/未来再见_PV_v2.mp4) | 1344×768 / 165.875s / 3981 帧 | ¥0 |
| 15 | 超分 1080p | ✅ | [未来再见_PV_v2_1080p.mp4](../10_h3video/pv/未来再见_PV_v2_1080p.mp4) | 1920×1080 / **210.2 MB**（本地 Real-ESRGAN）；**质量已独立核验：确实更清晰**（见下「1080p 超分质量」） | ¥0 |
| 16 | 核验 | ✅ 7/7 | [report.md](../10_h3video/pv/verify/report.md) + 抽帧 | **7/7 全过**；原创性最大 SSIM 0.522；链式接点 0.788 / 0.885 | ¥0 |
| 17 | 封面 | 🔄 | [cover/](../10_h3video/pv/cover/) | 4 版已出（A/B/C/D × 两种尺寸），**待用户定稿** | ¥0 |
| 18 | 投稿文案 | ✅ | [投稿文案.md](../10_h3video/pv/投稿文案.md) | 含原曲署名 + AI 标识 + 非商用声明 | ¥0 |

> `花费` 列合计 **¥109.50** = 头部累计，与 [成本台账.csv](成本台账.csv) 末行一致。
> 除出片（第 12 行）外全部为本地算力，**¥0**。

---

## 二、操作日志（新→旧）

### 2026-09-29 05:10 ｜ ACE 克隆声线「德丽莎」试听 —— 管线跑通，但渲染全项目无声（阻塞在 ACE 侧）

- 起因（用户原话）：「请在我现在的ACE Studio工作台中，创建一段人声音频，singer使用我自己克隆的声线"德丽莎"，让我测试一下克隆声线效果」。
- **做成了什么**：把项目自己的干声（`02_stems` 人声轨 @29.6s 起 5s）导入 Studio 并跑
  `generative vocal-to-midi`（**免费**）→ 转录出**真实歌词「无言的天空」+ 真实音高曲线**（56/63/61/60/61），
  清掉尾部 5 个伪音后落在克隆声线轨上；另新建一轨手写长音段「再见」（E5→F5）做严苛检验。
  顺带发现 `07_mix\grid_v4_manifest.csv` 的起音时刻在「无」字上**偏晚约 0.96 s**（网格锚点与干声不符）。
- **阻塞**：三种导出（克隆「无言的天空」/ 克隆「再见」/ **用户原轨道 0「啦啦啦」**）用 `astats` 测都是
  **−inf dBFS（数字静音）**。逐条排除：轨道未静音、`transport play` 实测 playhead 正常推进（0→3.14→6.34s）、
  导出范围/时长正确、job 结算后复测仍静音、改音高强制重建后 `synthesis-status` 始终 false；
  **连用户自己那段「啦啦啦」也无声** → 是工程级 Vocal Synth 一个音都没渲染。
  唯一可疑：`sound-source get` 的 **`saveState: "unmixed"`**（克隆声线未完成混音）——倾向账号侧渲染权益 / 克隆音色同步问题。
- **成本：¥0**（vocal-to-midi 与 export audio 均不计费；全程未调 H3/图像 API）。
- 产物与逐项证据：[10_h3video/_probe/README_ACE克隆试听诊断.md](../10_h3video/_probe/README_ACE克隆试听诊断.md)；
  静音导出（留证）：`_probe\德丽莎_克隆试听_无言的天空.wav`、`…_再见.wav`、`_track0_check.wav`、`_during_play_check.wav`；
  有声参考素材：`_probe\ace_test_phrase_29.6s_5.0s.wav`（Peak −0.9 dBFS）。
- 复现脚本：[dev/_probe/ace-clone-test.mjs](../dev/_probe/ace-clone-test.mjs)、[dev/_probe/ab-clone-voice.mjs](../dev/_probe/ab-clone-voice.mjs)。
- 工程改动（仅新增，未覆盖）：轨道 1 = 干声参考（诊断用音频轨）、轨道 2 = 克隆试听「无言的天空」、
  轨道 3 = 克隆试听「再见」；**用户原轨道 0 内容一字未改**；保护区 `01_input`/`02_stems`/`09_aceproject`/`music` 零改动。
- 待用户动作（三步）：①在 Studio 里播放轨道 0 用耳朵确认；②点轨道 0 的 **Mixdown/完成混音**（`unmixed`）；
  ③仍无声则查账号的 Vocal Synth 渲染额度/订阅与克隆音色是否在线。

### 2026-09-29 01:55 ｜ 1080p 字幕按画布等比重烧（用户拍板「改」）

- 起因：核验发现 1080p 交付物与 768p 的**字幕/片头字相对画面小 1.4286×**（两个 ASS 都是 Fontsize 54，
  而画布分别是 1344×768 与 1920×1080）。用户选择「按画布比例放大，与 768p 观感一致」。
- 改动：[83_pv_subs.mjs](../scripts/83_pv_subs.mjs) 引入画布缩放系数 `SCALE = RES_X / BASE_W`（基准画布时为 1），
  字号/Spacing/Outline/Shadow/MarginL/R/V 与片头行距 `step`、片尾行距全部**整体等比缩放**——
  不再只缩画布不缩字。新 1080p 样式：Lyric **77**、Title 112、Info 56、Small 46（旧版全是 54 的字号）。
- 重烧：`node scripts/84_pv_assemble.mjs --from-timeline --timeline "10_h3video/pv/.up/timeline_1080_rebuilt.mp4" --ass "…_1080.ass" --out …`
  **只重烧字幕+混音，未重跑 Real-ESRGAN**，用时 2.2 分钟，花费 **¥0**。
- 核验：字幕带包围盒高 **112 → 153 px（×1.366）**、亮像素 8103 → 14391（×1.78）、文字带顶 911 → 880 px；
  **画面中部（无文字区）新旧 MAD = 0.154**（画面没动，只改了字幕层）；
  响度 **−14.1 LUFS / TP −1.0 dBTP**（与旧版逐项一致）；768p 交付物 sha256 `74A6F35D…` **未变**。
- 回归：默认 768p 字幕重跑后与旧文件**逐字节一致**（`SCALE=1` 分支无副作用）。
- 对比图：[CAPTION_old_top_vs_new_bottom.png](../dev/_probe/reburn-verify/CAPTION_old_top_vs_new_bottom.png)、
  [CARD_old_top_vs_new_bottom.png](../dev/_probe/reburn-verify/CARD_old_top_vs_new_bottom.png)（上=旧 / 下=新）。

#### ⚠️ 本次操作事故（诚实记录，未造成交付物损失）

我在执行重烧时**用错了参数**，把超分中间产物覆盖了：

1. 我误以为 `--timeline <路径>` 就会跳过归一化，**实际还需要显式 `--from-timeline`**
   （[84_pv_assemble.mjs](../scripts/84_pv_assemble.mjs) 第 19 行有写）。于是 84 走了归一化分支，
   从 `clips/` 重拼了一条 768p 时间轴，**把它写进了 `--out` 指定的路径**——而我给的路径恰好
   与它内部的 `rough`（`.up/timeline_1080.mp4`）**同名**，结果 290.5 MB 的超分母版被 768p 覆盖。
2. 同一次误用还产出过一份 **1344×768 的错版**落到了 1080p 交付文件名上（90 MB）。

**损失与恢复**：交付物本身没丢——84 的 `archiveOld` 已把真正的 210.5 MB 1080p
（`F922FF3E…`）先移进 history 才写新文件；16 段超分 `parts/` 全部完好。
我用 `dev/_probe/rebuild-1080.mjs` 从 parts 以 **`-c copy`** 重建了超分母版
（**1920×1080 / 3981 帧 / 165.875s / 290.5 MB，与原件同尺寸同字节数**），再重烧得到最终交付物。
误产的 768p 错版存入 `history/2026-09-29_mistake-768p-in-1080p-slot/` 留痕（未删除）。
`.norm/timeline.mp4`（768p，缓存区可重算）也被重建过一次，768p 交付物未受影响。

**教训（写给下次）**：① `--out` 一律用**绝对路径**且先核对它是否与脚本内部中间变量同名；
② 用 `--plan` 确认走的是哪条分支（日志里找「跳过归一化与拼接」这句）再实跑；
③ 动中间产物前先把 `history/` 当作唯一保险。

### 2026-09-29 01:10 ｜ 工作台 v2 真机验收完成 + 开源 v2.0.0 发布

- 用户重启 `dsh web` 后，宿主半边 v2 生效（`/ping` → `version: 2.0.0`；快照 7 阶段、歌列表 1 首）。
- 真机验收（全程 `console.error = 0`）：6 个页签逐个验（引导 7 / 素材 6 / 歌词 24 / 出片 17 / 账本 4 / 日志 0，都是真实数据）；点「配置自检」→ 作业 done、日志 `problems: []`；在**新建的会话**里点「⌁ 我在哪一步」→ 发送 → 会话被自动命名「工作台进度与断点检查」、消息以 `【工作台】` 前缀进对话、智能体当场开始读文件；用向导真的建了一首测试歌（`E:\Videos\翻填自检_可删`）并看到它的素材清单（阶段 1 缺 原曲音频 / 翻填词 LRC），随后从注册表移除（文件保留）。
- **浏览器上传全链路也验了**：在临时歌 `E:\Videos\翻填自检_上传` 上把 1.6 KB 测试 WAV 交给「原曲音频」槽 → 落盘 `01_input\原曲.wav`（1644 B）+ 配置键 `audio.reference` 回写 + 阶段 1 必填缺项缩为只剩「翻填词 LRC」+ `s1.config` 转 done；改配置前宿主自动写了备份。两首临时歌随后都从注册表移除（磁盘文件保留，可自行删除）。
- **真机抓到一个我自己引入的 bug 并当场修掉**：安全校验拿原始 argv（含 `{{...}}`）去查占位符，把三条正常动作误判成"占位符没解析出来"。改成先解析再校验 + 加回归断言 → 自检 **118/118**。**该修复需再重启一次 `dsh web` 才在线上生效**。
- 发布：staging 96 文件 → 提交 `b53aa4d` → push `master` → tag **v2.0.0** → Release <https://github.com/gychen-NJU/fanfill-video-pipeline/releases/tag/v2.0.0>。
- 花费：**¥0**。保护区零改动；`songs.json`（本机注册表）与 `backup/` 未进仓库。
- 证据：[00_docs/09 §11.5–11.6](../00_docs/09_本次开发产物清单.md)（含 7 张真机截图路径）。

### 2026-09-29 00:30 ｜ 工作台升级为 v2（引导式流水线工作台）

- 起因（用户原话）：工作台「只能起到预览我项目内的资产和状态的效果」，需要「进行交互式引导我一步步完成整个工作流程的工作台……有清单向我索要素材，我可以点击之后提交相关素材，还可以即时和智能体对话让他帮我完成其中的一些环节」。
- 改动：宿主半边重写为 12 端点的单条 prefix 路由（新增 `/lib/{spec,state,writes,jobs}.mjs`）；客户端半边重写为「引导手风琴 + 素材提交（上传/传文件夹/选已有）+ 对话 dock + 作业日志 + 新建歌向导」，v1 的四个只读视图移植为次级页签；新增数据层 [pipeline.default.json](../dev/翻填工作台/pipeline.default.json)（通用 7 阶段骨架）与 [工作台流水线.json](../工作台流水线.json)（本歌覆盖）。
- 产物：`dev\翻填工作台\{index.js, client.js, lib\*.mjs, pipeline.default.json, package.json(v2.0.0)}`；v1 归档 `dev\_probe\backup\翻填工作台-v1-20260929-001152\`；**版本手册** [00_docs/10_翻填工作台v2使用手册.md](../00_docs/10_翻填工作台v2使用手册.md)。
- 花费：**¥0**（全程本地；付费动作宿主侧 403 硬拒，只能派单给智能体）。
- 证据：`node dev\_probe\workbench-v2-test.mjs` **117/117 PASS**；`node dev\_probe\workbench-client-render-test.mjs` **30/30 PASS**；`node dev\_probe\snapshot-test.mjs` **SNAPSHOT OK**（v1 字段与数值一字未变）；保护区 `01_input`/`02_stems`/`09_aceproject`/`music` 内容指纹零改动。
- **补充（同一批工作，独立核验之后）**：派了一个只读子代理做对抗性核验（报告 [dev/_probe/adversarial/REPORT.md](../dev/_probe/adversarial/REPORT.md)），查出 2 个高危 + 4 个中危 + 10 个低危并**全部修掉、逐条补了回归断言**：junction 绕出歌根（加真实落点复核）、本歌覆盖文件是可执行内容（改为未受信 + 强制确认 + 解释器白名单）、`force` 后门（删）、取消后孙进程占管道导致作业卡死（5 秒强制结算）、超限请求看不到 413（先响应后断流）、一行坏数据把 `/snapshot` 打 500（分块容错）。自检因此从 94→**117** 项、客户端 27→**30** 项。另在真实 GUI 里验了 v2 客户端半边：**console.error = 0**、6 页签正常、宿主仍旧版时能优雅降级（截图 `dev\_probe\gui-verify-v2\`）。
- 待办：用户重启 `dsh web` → 真机验收（截图 + `console.error` 计数 + 派单/上传实测）→ 换歌向导端到端演练 → 仓库同步（**推送前单独确认**）。

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

- [ ] **ACE 克隆声线「德丽莎」渲染无声（2026-09-29 05:10 新）**：管线已跑通（真实歌词「无言的天空」+
  音高曲线已落在克隆轨上），但该项目**任何**导出都是数字静音（连用户原轨道 0 也一样）→ 等用户
  ①在 Studio 里播放确认 ②点轨道 0 的 Mixdown（`saveState: unmixed`）③查账号渲染额度/订阅。
  诊断全文：[10_h3video/_probe/README_ACE克隆试听诊断.md](../10_h3video/_probe/README_ACE克隆试听诊断.md)
- [ ] **封面定稿**：已出 A/B/C/D 四版，各两种尺寸（1344×768 / 1146×717）
      → [cover/](../10_h3video/pv/cover/)（配置里暂记 `preset = D_10th`）
- [ ] **是否要 2K 真出片**：`h3-2k-regen` ¥0.30/s，全片 165.86s 约 **¥49.76**（**未实测**，本歌未用过 2K）
- [ ] **LRC 三句超阈值是否回头修**：第 6 句 −0.78s / 第 17 句 −0.57s / 第 24 句 +0.81s
      （阈值 0.4s；字幕已按实测起音走，但 LRC 文件本身未改）

- [x] ~~**1080p 的字幕/片头字比 768p 相对小 1.4286×**~~ → **用户 2026-09-29 决定「改」，已实施并核验**
      （[83_pv_subs.mjs](../scripts/83_pv_subs.mjs) 加画布缩放；1080p 重烧完成，
      交付物 sha256 `63B96A02…`，见上方操作日志）。
- [x] ~~1080p 与主母版存在 +9 px 垂直错位~~ —— **撤销：这是我 01:30 的假警报**（量测误差，非交付物缺陷）。
      真因：我拿 `.norm/timeline.mp4` 按 87 的链路还原参照帧时，把「未裁切直缩」当成了参照；
      交付物实际等于 `uniformScale(源片裁到 1344×756 @ y=6)`，[87_pv_upscale.mjs](../scripts/87_pv_upscale.mjs)
      的公式 `cropH=round(2688×9/16)=1512、cropY=(1536−1512)/2=12` 算出来正是这个结果（node 复算一致）。
      独立核验（另一路子代理逐帧 SSIM 扫描）同解：峰值 oy=6、左右对称、残余位移 ≤0.07 px@1080。
      **结论：几何无缺陷，无需重跑超分。**（顺带改正 87 里一句会误导的旧注释「裁掉上下各 12px」——那是
      2688×1536 空间的 12px，等于源片 6px。）脚本：[ab-offset-search.mjs](../dev/_probe/ab-offset-search.mjs)、
      [crop3-refine.mjs](../dev/_probe/crop3-refine.mjs)、[upscale-verify/report.md](../dev/_probe/upscale-verify/report.md)。

---

## 四、变更历史

- **2026-09-29 00:30 工作台 v1 → v2（引导式）**：用户判定 v1「只能预览项目资产和状态」 → 重做为
  「按阶段索要素材 + 引导 + 白名单本机执行 + 一键派单给会话内智能体 + 实时日志」，换歌改用侧栏向导。
  - v1 源码归档：`dev\_probe\backup\翻填工作台-v1-20260929-001152\`（4 文件，字节级副本，**未删除任何东西**）；
  - 回滚脚本：`dev\_probe\workbench-rollback-v1.mjs`（预览）/ `--apply`（先备份 v2 再复制 v1 回去）；
  - 生效：宿主半边需重启 `dsh web`，客户端半边刷新页面；使用手册见 [00_docs/10_翻填工作台v2使用手册.md](../00_docs/10_翻填工作台v2使用手册.md)。
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
| 3 | 预设「翻填视频工作流」 | ✅ | [dev/翻填工作流预设/](../dev/翻填工作流预设/) | **已在 Web GUI 实测可加载**（2026-09-28）：设置 → Agent 预设 里「翻填视频工作流」不再显示红角标，`broken` 为空。**曾踩坑并修复**：漏写 `plan-mode` 的必填 `config.section` 导致整行激活失败、预设被标「加载失败」——`dsh --dump-config` 查不出来（它只验语法与合成）。排查方法与可复用脚本见下 |
| 4 | 工作台（Web UI 插件） | ✅ v2 | [dev/翻填工作台/](../dev/翻填工作台/) | **v1 已在真实 GUI 截图验收**（证据 [dev/_probe/gui-verify/](../dev/_probe/gui-verify/)）：右侧栏出现「翻填工作台」，Tab 全渲染真实数据、**console.error = 0**。**2026-09-29 升级为 v2（引导式流水线工作台）**：7 阶段引导手风琴 + 素材提交（上传/传文件夹/选已有）+ 白名单本机执行（实时日志/可中止）+ 一键派单给会话内智能体 + 对话 dock + 新建歌向导；自检 **94/94**（宿主）＋ **27/27**（客户端无头渲染），v1 快照回归一字未变。手册：[00_docs/10_翻填工作台v2使用手册.md](../00_docs/10_翻填工作台v2使用手册.md)。真机浏览器验收**待重启 `dsh web` 后进行**，亮/暗主题仍未实测 |
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

把「可复用的那一半」抽成独立仓库并推到 GitHub：**https://github.com/gychen-NJU/fanfill-video-pipeline**（public，51 个文件 / 731 KB，**MIT 许可**，`master` @ `b5f5f46`，**已发 Release [v1.0.0](https://github.com/gychen-NJU/fanfill-video-pipeline/releases/tag/v1.0.0)**）。

- **做法**：不直接在工作区 `git init`（那里有 12.6 GB cache + 6.3 GB venvs + 2.1 GB 产物 + 244 MB 截图，一次失误就提交出几百 MB），而是用
  [dev/_probe/stage-repo.mjs](../dev/_probe/stage-repo.mjs) **复制**到一个干净 staging 目录再发布——工作区原文件零改动。
- **带走**：技能（9 文件）、PV 脚本（10）、出片驱动 + MCP server（4）、工作台插件（4）、预设（2）、文档（7：英文 `INSTALL.md` 与 `BOOTSTRAP.md` + 配置规范 + 能力报告 + 原项目三份 SOP）、`examples/`（8，只放文本：配置/进度/台账/成本/对齐/核验/分镜/文案）、自检工具（2）、根目录 `README.md` / `LICENSE` / `.gitignore`。合计 49 文件。
- **没带走**：任何音频/视频/图片。`01_input`/`02_stems`/`09_aceproject`/`music` 与全部成片都留在本地——它们是第三方二创素材，不适合入库。
- **体格检查（已做）**：无明文密钥、无媒体文件、无 >200KB 文件（最大 42 KB）、`client.js` 模块 id 与包名一致、无机器专属死码。
- **发布前的可移植性修补**（3 处，都同步回本工作区）：
  1. `fanfill-config.mjs` 的 ffmpeg 路径改成**可解析**——`FANFILL_FFMPEG_DIR` 环境变量 > `video.ffmpegDir` 配置 > 历史默认 > PATH 兜底，并打印一次提示；
  2. `82_pv_clips.mjs` 的出片驱动路径支持 `FANFILL_H3` / `video.h3Driver` 覆盖，缺失时前置报错并给出三条出路；
  3. `ui-workbench/client.js` 删掉探测期的 URL 编码兜底死码（换机器必然打不中）。
- **泛化（用户 2026-09-28 追加要求：「删除关于我此次任务的描述，更适用于任意曲目」+「README 要中英双语、默认英文、点击热切换」）**：
  - `README.md`（**英文默认**）+ `README.zh-CN.md`（中文完整对应）—— 本歌专名与本次任务数字全部清出 README，真实数据移入 `examples/`。
  - **GitHub Pages 站点已上线**：<https://gychen-nju.github.io/fanfill-video-pipeline/> —— 单个 `index.html`，
    右上角 `English | 中文` **点击热切换**（localStorage 记忆 + `?lang=` 可分享 + 首访跟随浏览器语言 + 亮暗主题）。
    *GitHub 的 README 由服务端渲染、脚本被剥离，物理上做不到热切换，所以切换器只能放在 Pages 上。*
  - `SKILL.md` 泛化：工具名标注为"参考实现"、去掉"本歌"指代、不再把某目录名写成固定事实。
  - `docs/05_pv-pipeline.md` **重写为通用方法论文档**（标题不再带曲名；段号式模式分配改为按用途描述；
    目录名改为 config 驱动；绝对路径改为占位符；真实数字保留但标注为"一次真实交付的参照"）。
  - `docs/08_project-config-spec.md` 泛化（5 处：目录约定、`source` 示例、`video.dir` 说明、文末实例小节改为指向 `examples/`）。
  - `docs/06_development-plan.md` **移出用户文档**：改名为 `notes/06_building-this-pipeline.md` 并加文首说明
    —— 它是"一次开发任务的记录"，读的是方法（怎么分层、怎么先冻结契约、怎么用换歌验证证明通用），不是命令。
  - `docs/04` 与 `docs/07` 的泛化**进行中**（子代理处理，完成后重新构建推送）。
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

- **预设「加载失败」（2026-09-28 用户报的，已修）**：Web UI 上那张卡带红色「加载失败」角标。
  真因：我写预设时**只抄了 `plan-mode` 的 `name`、漏掉了它的必填 `config.section`**
  （shipped 预设里那段 2339 字的 plan 模式行为准则），
  插件校验抛 `PlanModeConfig needs a non-empty 'section'` → 整行激活失败 → preset row 被标 broken。
  **`dsh --dump-config` 查不出来**——它只验证语法与合成，不验证每行 config 能过插件校验。
  权威诊断在 `@deepseek-ai/dsh-agent-preset-registry` 的 row `broken` 字段，**只有 Web GUI 会显示**：
  设置 → Agent 预设 → hover 红角标看原因；等价做法是在已登录页面执行
  `[...document.querySelectorAll('[class*=brokenTip]')].map(e=>e.textContent)`。
  已从 shipped 预设**逐字**取回那段 section 填进 profile 补丁与 `dev/翻填工作流预设/`，
  改完 **GUI 立刻重读（无需重启）**，5 个预设现全部可加载。
  **该修复已同步进开源仓库**（`agent-preset/cordis.patch.yml`，提交 `b5f5f46`，即 v1.0.0 指向的提交）。
  **固化脚本**：[dev/_probe/check-preset-health.mjs](../dev/_probe/check-preset-health.mjs)（静态体检"包有必填 config 但我没写"+ 打印权威检查步骤）、
  [dev/_probe/read-preset-broken.mjs](../dev/_probe/read-preset-broken.mjs)（从 GUI 抓 broken 原因）。
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

### 1080p 超分质量：独立核验结论（2026-09-29 01:45，这是**质量型**验收，不是参数验收）

派了一个只读子代理独立核验「1080p 到底有没有更清晰」，它自己的结论与数据：

- **画面层：明显更清晰，不是单纯放大。** 公平基线（768p lanczos 到 1920×1080）下全片 3981 帧
  SSIM-Y 均值 **0.9335**（P5 0.8363 / 中位 0.9440 / min 0.8197）、PSNR-Y 均值 27.32 dB。
- **锐度增益随细节量单调**：特写脸 ×3.93 → 人物 ×2.74 → 夜景柱廊 ×1.89 → 近黑云 ×1.69（最高频带能量比）。
  这条单调性是**排除「多出来的高频只是编码噪声」**的关键——若是噪声，最暗、码率最紧处应该最明显。
- **代价**：过冲约为 lanczos 基线 2 倍；暗部出现轻微 8×8 块效应（133.3s 夜景柱廊「基本没差别/略好」）。
- **上限说明**：768p 奈奎斯特以上的频段源里根本不存在，1080p 里那部分能量**必然是生成/锐化出来的**，不算"恢复"。
- 证据：[dev/_probe/upscale-verify/report.md](../dev/_probe/upscale-verify/report.md) +
  `t1_face_41.667s.png` / `t2_text_25.000s.png` / `t3_dark_133.333s.png` / `t4_dark_116.667s.png`
  （每张都是 1:1 三格：neighbor / lanczos / native）。
- **未覆盖**：只抽查 4 个时刻，未逐镜头普查，未做时域稳定性与音频评估；结论是单人看图判断，非盲测。

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
