# fanfill-video-pipeline（翻填视频流水线）

[English](README.md) · [中文](README.zh-CN.md) · [文档站 ↗](https://gychen-nju.github.io/fanfill-video-pipeline/?lang=zh)

把一首歌 + 一份翻填词，做成完整的**翻唱成品母带 + PV 成片** —— 由编码智能体驱动，走文件式流水线，不引入数据库。

> **设计上就是通用的。** 这里没有任何东西绑定某一首歌。给它任意一首曲目和任意一份翻填词，流水线读同一份项目配置、产出同一套固定结构的产物。这套工具是从一次真实交付里抽出来的，那次运行的数据单独记在 [`examples/`](examples/) —— 想看真实数字再去看。

---

## 唯一值得抄走的设计

**文件即真相源，不引入数据库。**

```
                        ┌──────────────────┐
   智能体（技能 + 脚本） ────┤    项目配置      │──── 网页工作台（引导式）
                        └──────────────────┘
                                 │
              进度文档   （人可读的进度 + 产物索引）
              成本台账   （每笔花费一行）
              分镜表     （切点，脚本与界面共享）
```

配置、分镜、进度、台账——全都是你能用编辑器直接打开改的纯文本文件。界面只是这些文件上的一个**视图**，绝不是第二份真相。换歌 = 换一个工作区目录，不需要迁移数据库。

---

## 流水线怎么跑

两条交付线在中间会合：

```
音乐线  原曲 ─► 分离 ─► 扒谱 / 对齐 ─► 出人声 ─►（换音色）─► 混音 ─► 成品母带
视频线  歌词对齐 ─► 分镜 ─► 参考图 ─► 提示词 ─► 视频生成 ─► 字幕 ─► 合成 ─► 超分 ─► 核验
```

两者的耦合点是：**分镜切点必须踩在「实测人声起音」上，而不是歌词文件的名义时间戳上。** 歌词文件是手工对的艺术品、不是测量结果——它会漂，有时漂掉大半秒，而按名义时间下刀会把一个词切成两半。所以脚本会去读人声干声轨的 RMS 包络，找出真实的起音与真实的静音，再把每个切点**吸附进静音谷**。

### 阶段

| # | 阶段 | 命令 | 产物 | 花钱？ |
|---|---|---|---|---|
| 1 | 素材盘点 + 写配置 | — | `material_survey.md` | 否 |
| 2 | 分离 / 扒谱 / 出人声 / 混音 | 用你自己的音乐工具链 | stems / MIDI / vocals / mix | 否（本地） |
| 3 | 歌词对齐 + 分镜 | `node scripts/80_pv_shotlist.mjs` | `segments.json`、`lyrics_timing.csv`、`alignment_report.md` | 否 |
| 3b | 提示词自检 | `node scripts/80b_check_prompts.mjs` | 通过/不通过报告 | 否 |
| 4 | 参考图（去水印 + 缩放） | `node scripts/81_pv_refs.mjs` | `refs/ref_*.jpg` | 否 |
| 5 | **视频生成** | `node scripts/82_pv_clips.mjs --only 1,2,3 --max-cost 25` | `clips/NN_slug.mp4`、`cost_log.csv` | **是** |
| 6 | 字幕 | `node scripts/83_pv_subs.mjs --w 1920 --h 1080 --tag 1080` | `subs/*.ass`、`*.srt` | 否 |
| 7 | 合成 | `node scripts/84_pv_assemble.mjs` | `…_PV_v2.mp4` | 否 |
| 8 | 核验（7 项） | `node scripts/85_pv_verify.mjs --w 1920 --h 1080` | `verify/report.md` + 抽帧 | 否 |
| 9 | 封面 | `node scripts/86_pv_cover.mjs --only D` | `cover/*.jpg` | 否 |
| 10 | 超分（Real-ESRGAN） | `node scripts/87_pv_upscale.mjs` | `…_1080p.mp4` | 否（耗时） |

**阶段 2 是故意不做的**：分离、扒谱、歌声合成、混音各有各的工具、各有各的难题。这个仓库负责的是**视频线，以及把它和音乐绑在一起的那些决策**（时间、成本、验收、非破坏性）。

每个脚本都支持 `--plan`：只打印"将要做什么 + 预估花费"，**不写文件、不发请求**。回放与自检一律先用 `--plan`。

---

## 快速开始

### 0. 安装

视频流水线本身**没有任何包依赖** —— 每个脚本都是独立的 `.mjs` 文件。你需要的只是一些外部二进制。

| 依赖 | 用途 | 必需？ |
|---|---|---|
| **Node.js ≥ 18**（24 上测过） | 全部脚本 | **是** |
| **FFmpeg + ffprobe** | 对齐 / 参考图 / 字幕 / 合成 / 核验 | **是** |
| **视频生成 API key** | 出片（唯一花钱阶段） | 仅阶段 5 |
| **Real-ESRGAN ncnn-vulkan** | 免费本地超分 | 可选 |
| **ImageMagick** | 两个封面版式 | 可选 |
| **DeepSeek Harness** | 技能 / 预设 / 工作台集成 | 可选 |

```bash
git clone https://github.com/gychen-NJU/fanfill-video-pipeline my-song
cd my-song

node --version          # 期望 v18+
ffmpeg -version         # 必须是真 ffmpeg，见下面的坑
node tools/smoke-test.mjs   # 在合成工作区上做 13 项自检 —— 不往仓库里写任何东西
```

`tools/smoke-test.mjs` 不需要任何素材、不联网：它现造一个临时工作区、跑通工作台快照、断言 13 件事。它过了，说明你 Node 这一侧没问题。

**Windows 上唯一的安装坑**：`PATH` 里的 `ffmpeg` 常常是 ImageMagick 自带的那份，跑真实滤镜链会失败。指向真的：

```powershell
$env:FANFILL_FFMPEG_DIR = "E:\software\FFmpeg\ffmpeg-8.1.1-essentials_build\bin"
& "$env:FANFILL_FFMPEG_DIR\ffmpeg.exe" -version   # 期望 "ffmpeg version 8.x ..."
```

永久生效也可以，或在配置里写 `"ffmpegDir": "…/bin"`。解析优先级：`FANFILL_FFMPEG_DIR` → `video.ffmpegDir` → 一条历史默认路径 → `PATH` 上的裸名；一旦回退会打印一次性提示。

完整的分步安装（含 DSH 技能/预设/面板接线与出片驱动）见 **[docs/INSTALL.md](docs/INSTALL.md)**（英文）。

### 让智能体帮你装

这个仓库本来就是给编码智能体驱动的。把下面这段贴到**克隆目录下**的新会话里：

```
Read docs/BOOTSTRAP.md and install this project for me, following it step by step.
Verify each step with the command it gives, stop and ask me only for things you
cannot do yourself (the API key, and restarting dsh web if needed).
When you finish, run `node tools/smoke-test.mjs` and report the result.
```

`docs/BOOTSTRAP.md` 就是为这个写的：每步都有确切命令、期望结果、失败回退。更短的说法也行：

```
Install fanfill-video-pipeline from the README: check Node and ffmpeg, set
FANFILL_FFMPEG_DIR to a real ffmpeg (not the ImageMagick one), then run
node tools/smoke-test.mjs and tell me what it says.
```

这个仓库**任何环节都不需要 Python**。

仓库认识的环境变量：

| 变量 | 含义 | 默认 |
|---|---|---|
| `FANFILL_FFMPEG_DIR` | 含 `ffmpeg` / `ffprobe` 的目录 | 一条历史默认路径，再退到 `PATH` |
| `FANFILL_H3` | 出片驱动 `h3.mjs` 的绝对路径 | `<工作区>/tools/minimax-h3/h3.mjs` |
| `FANFILL_MAGICK` | 封面版式用的 `magick` | 一条历史默认路径 |
| `FANFILL_WORKSPACE` | `tools/*.mjs` 要检查的工作区 | 当前目录 |

### 1. 建工作区

**一首歌 = 一个工作区目录。** 仓库本身就是工作区根：

```bash
git clone https://github.com/gychen-NJU/fanfill-video-pipeline my-song
cd my-song
mkdir -p 01_input 02_stems 03_midi 04_lyrics 05_vocals 06_svc 07_mix 08_release 10_video _进度
```

### 2. 写项目配置

`翻填项目.json` 是**脚本的唯一参数来源** —— 没有任何脚本硬编码歌名、总长、段数、分辨率。文件名是固定的（脚本按它找），里面的**值**是你的。

```jsonc
{
  "schema": 1,
  "song": { "name": "我的歌", "source": "出处", "lrc": "music/lyrics.lrc", "bpm": 156, "totalSec": 166.0, "fps": 24 },
  "audio": {
    "reference": "01_input/原曲.mp3",
    "instrumental": "02_stems/instrumental.wav",
    "aceVocal": "05_vocals/vocal.wav",
    "master": "07_mix/master.wav",
    "separation": "python-audio-separator",
    "voice": { "target": "目标音色", "engine": "ace-studio" },
    "loudness": { "iLufs": -14, "toleranceLufs": 1, "truePeakDbtp": -1 }
  },
  "video": {
    "dir": "10_video",
    "aspect": "16:9", "baseRes": "768P", "baseSize": [1344, 768],
    "deliverRes": [{ "name": "1080p", "size": [1920, 1080], "method": "realesrgan-x2-then-downsample", "tag": "1080" }],
    "model": "MiniMax-H3", "pricePerSecond": 0.5,
    "maxPromptChars": 7000, "segMaxSec": 15, "transition": "cut",
    "subtitle": { "font": "Microsoft YaHei", "size": 54, "minDisplaySec": 3.0, "lineLevel": true, "followMeasuredOnset": true },
    "ffmpegDir": "E:/path/to/ffmpeg/bin",
    "h3Driver": "tools/minimax-h3/h3.mjs"
  },
  "credits": { "original": { "词": "…" }, "thisVersion": { "改词": "…", "tools": [], "disclaimer": "AI 生成 · 非商用" } },
  "budget": { "totalCny": 150, "spentCny": 0, "authorized": false },
  "cover": { "title": "我的歌", "subtitle": "…", "preset": "D", "sizes": [[1344, 768], [1146, 717]], "logos": [] }
}
```

`video` 里**只有 `video.dir` 是必填**，九个产物子目录缺省按 `<video.dir>/<名字>` 推导。完整字段说明见 [`docs/08_project-config-spec.md`](docs/08_project-config-spec.md)（中文）。

### 3. 跑不花钱的阶段

```bash
node scripts/80_pv_shotlist.mjs --plan    # 只读彩排
node scripts/80_pv_shotlist.mjs           # 写出分镜
node scripts/80b_check_prompts.mjs        # 提示词自检
node scripts/87_pv_upscale.mjs --plan
```

还没有切点也没关系，`80` 可以从一组粗边界起步，自己把它们吸附到静音谷：

```bash
node scripts/80_pv_shotlist.mjs --boundaries 0,12,24,36
```

### 4. 接进 DeepSeek Harness（可选）

```bash
mkdir -p .agents/skills
cp -r skills/fanfill-video-pipeline .agents/skills/     # 热加载，不用重启
```

工作台面板与预设是往 DSH profile 补丁层追加两行 —— 见 [`docs/INSTALL.md`](docs/INSTALL.md) §2，那里解释了为什么那两条绝对路径要你手动改。面板能做什么、怎么自定义它的阶段表、它强制的信任模型：见 [`docs/09_workbench.md`](docs/09_workbench.md)。

---

## 硬约束（都是踩出来的）

这些不是风格偏好 —— 每一条都花过真实时间或真实金钱：

| 约束 | 为什么 |
|---|---|
| **单条提示词上限 7000 字符** | API 硬顶。 |
| **参考图与首帧图互斥** | 既要"参考"又要"连续"→ **首镜用 Ref2VA，后续每段拿上一段成片的末帧做首帧续拍**。 |
| **参考图必须走视频模型的 Ref2VA 模式** | 图像模型的 `subject_reference` 只接受公网可访问 URL，本地文件引用不了。 |
| **绝不要从成片取帧** | 成片已经烧进字幕了。要从每段原始片段取。 |
| **字幕必须在目标分辨率重烧** | 对已烧录字幕的视频做缩放，字也会被一起缩放。 |
| **真超分 ≠ 重采样** | lanczos / DAW 重采样只是把文件变大，不是把画面变清楚。用 Real-ESRGAN。 |
| **测起音，别信歌词文件** | 名义时间戳会漂；按错的时间下刀会把词切断。 |
| **ffmpeg 用绝对路径** | `PATH` 上 ImageMagick 自带的 `ffmpeg` 会把真的那个挡掉。 |
| **写 `.mjs` 文件，不要 `node -e`** | PowerShell 5.1 会把内联脚本吃掉。 |
| **含非 ASCII 的文件用 Node 读写** | PowerShell 的 `Get-Content` → `ConvertFrom-Json` 往返会静默写坏 UTF-8。 |
| **单段 ≤ `segMaxSec`（默认 15s）** | 模型限制；段越长漂得越厉害。 |
| **字幕有最短显示时长（默认 3s）** | 低于这个值读不清。 |

## 流水线默认的纪律

- **默认非破坏性。** 输入只读。被替换的产物移入 `history/<时间戳>/` 并附 README；新产物用 `vN` 命名。**绝不覆盖。**
- **一次总授权 + 逐笔台账。** 预算是问一次；每笔花费都记；只在预估会突破预算时停。不逐步确认。
- **质量型需求必须做 1:1 对比。** 用户要"更清晰/更好看"时，参数全绿不算交付 —— 要出同帧/同段的 A/B 证据。
- **给绝对路径，然后停下等检查。** 告诉他该看什么，然后等。
- **本地免费优先。** 超分、分离、混音都跑在你自己机器上。
- **署名是交付阻塞项，不是加分项。** 成品必须带 AI 生成标识、非商用声明、以及完整原作出处。

---

## 目录结构

```
fanfill-video-pipeline/
├── skills/fanfill-video-pipeline/   # 技能：SKILL.md + references/01..08
├── scripts/                          # 80–87 + 80b + lib/fanfill-config.mjs
├── drivers/minimax-h3/               # 零依赖出片驱动 + MCP server
├── ui-workbench/                     # DSH UI 插件（引导式流水线面板）
├── agent-preset/                     # DSH Agent 预设
├── tools/                            # 复用检查（自检 + 换歌验证）
├── examples/                         # 一次真实运行的产物，供参照
├── docs/                             # 安装指南、配置规范、深入文档
├── notes/                            # 这套流水线是怎么建起来的（背景说明，非操作指南）
└── index.html                        # 中英双语文档站（GitHub Pages）
```

## 哪些验过、哪些没验

诚实比一片绿勾重要。

**验证过**
- 整条流水线端到端跑通并交付了成片；脚本配置化之后，核验报告**逐字节复现**。
- 分镜脚本重构后重跑，**逐字节复现**了交付时的分镜（切点、生成秒数、成本预估、歌词时间轴 CSV）。
- **换歌通用性**：`tools/gensong-test.mjs` 现造一个参数刻意不同的临时工作区（不同歌名、总长、BPM、画幅、输出目录、单段上限），在里面跑通分镜阶段，零报错，且每个配置项都真的生效。
- **非破坏性**：整轮跑完前后，只读保护区的内容指纹完全一致。
- **工作台面板（v2）**——引导式七阶段流水线：每个阶段按"素材槽"向你要文件（可上传，也可直接指向已有文件），白名单动作可本机跑并看实时日志，一个按钮就把该阶段派给当前会话里的智能体，底部还有对话 dock。两套无头自检（宿主 **117** 条 + 客户端渲染 **30** 条，都含对抗性回归）全过；v1 的快照契约没动（仓库自带的 `tools/smoke-test.mjs` 13 条断言在 v2 上照样全过）。付费动作被宿主直接拒绝；**来自本歌覆盖文件的命令一律标为未受信、每次都要二次确认**。

**没验证 —— 请当未测**
- **v2 工作台在真实浏览器里的表现**（它自己的点击路径、上传、亮/暗主题）：上面两套是无头自检，写文档时还没补跑真机那一遍；**v1** 面板是真机验过的（5 个 Tab、console.error = 0）。
- 面板的**亮/暗主题**渲染。样式确实全走主题 token（逐条核对过），但只截过暗色主题。
- **2K 花钱路线**、溶解转场、以及 `L2VA` / `<Video N>` / `<Audio N>` 这几种提示词形态，那次运行里从未用过。
- **超分实际用的是哪个模型** —— 没留下传参日志，记的是脚本默认值而不是实测值。
- 那次运行的音频母带真峰值超出目标，而交付母带是达标的。这对你的素材算不算问题，是判断题，不是设置项。

上面每条主张的原始证据都在 [`examples/`](examples/)。

## 许可

流水线代码是 [MIT](LICENSE) —— 随便用、随便改、随便发。

**素材不在授权范围内。** 你喂进去或产出的任何第三方美术/音频/视频都由你自己负责。`examples/` 里只有文本：配置、指标与台账条目，出于文档价值而公开。

用这套流水线发布任何东西时，请标注 AI 生成、非商用，并完整署名原作。在这个仓库编码的工作流里这不是可选项 —— 技能把它当作交付阻塞项。
