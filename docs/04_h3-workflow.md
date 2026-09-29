# 04 · MiniMax H3 视频生成工作流（DSH 实测版）

> 建立：2026-09-27　|　环境：Win11 + Node 24.16.0 + DSH　|　**实测出片证据：任务 `446283055206708`**（一次真实交付的参照）
> 关联：[03_Gate0_验收报告.md](./03_Gate0_验收报告.md)　工具：[tools/minimax-h3/h3.mjs](../tools/minimax-h3/h3.mjs)

---

## 0. 一句话结论

**H3 已经上线官方 API，不需要 RunningHub 之类的中间平台。** 本仓库内置零依赖驱动脚本 `tools\minimax-h3\h3.mjs`，2026-09-27 实测全链路跑通：提交 → 轮询 → 下载 → 校验，**5 秒 768P 出片耗时 111 秒、实付 ¥2.50**（一次真实交付的参照）。

先回答接入前最常见的两个疑问：

| 常见疑问 | 答案 |
| --- | --- |
| "查到的都是 runninghub 等平台上的工作台" | 那些是**转卖/代理**。官方 API 直连更便宜、更完整，且能脚本化 |
| "或许 MiniMax Hub 可以？" | **Hub 是真实存在的官方产品**，但它是**桌面客户端**（已改名 MiniMax Design），**不提供 API/CLI/MCP**，DSH 驱动不了它 —— 只能人手点。详见 §1.2 |

---

## 1. 先把检索到的信息理顺

### 1.1 为什么搜到的都是"平台工作台"

H3 的能力（多模态参考 + 原生音频）在第三方平台上通常被包成"云 ComfyUI 工作流"，所以搜索结果全是工作台。但同一模型，**官方 API 是源头**，各家只是转卖：

| 平台 | H3 的精确 model / 端点 | 计费 | 是否必须跑对方工作台 |
| --- | --- | --- | --- |
| **MiniMax 官方（推荐）** | `MiniMax-H3` / `MiniMax-H3-Max`，`POST /v2/video_generation` | **¥0.50/s（768P）、¥0.80/s（2K）** | 否，纯 REST |
| RunningHub（最常见的搜索结果） | `POST /openapi/v2/minimax/hailuo-h3/text-to-video` | ¥0.48/s（768P）、¥0.77/s（2K） | 模型 API 不必；工作流玩法需其云端。**标准模型 API 要企业级-共享 Key** |
| fal.ai | `minimax/h3/*`、`minimax/h3-max/*` | $0.05–0.16/s | 否（H3 Max 是 fal 跟 MiniMax 联合后训练的） |
| Replicate | `minimax/h3` | $0.08/s（768P） | 否 |
| 阿里云百炼 | `MiniMax/MiniMax-H3` | 同官方刊例 | 否 |
| ComfyUI 官方节点 | `MinimaxHailuo03*`（Max/Turbo 实为 fal 代理） | H3 768p $0.1287/s（比官方贵） | 否；本地节点另可用开源权重 |
| OpenRouter / 硅基流动 / 火山方舟 | **未上架** | — | — |

> 结论：**用官方 API**。第三方只在"没有官方 key"或"要用 fal 的 LoRA/特效端点"时才有意义。

### 1.2 MiniMax Hub 到底是什么（"Hub 能出片"这个猜测对了一半）

| 项 | 事实 |
| --- | --- |
| 它是什么 | **官方桌面客户端**（Electron 应用，内部代号 `minimax-hub`，包名 `com.minimax.hub.global`） |
| 域名 | `hub.minimax.io` / `hub.minimaxi.com` → 现已 **302 到 `design.minimax.io` / `design.minimax.cn`** |
| 现用名 | **MiniMax Design**，官方定位「Your local multimodal AI creative studio」 |
| 能出 H3 片吗 | **能**。官方 H3 仓库的技能里写明「Default model is MiniMax-H3」，画布里直接出片，还带 music-2.6 生成 BGM |
| 免费吗 | 新用户 3000 积分 + **3 次免费 H3** |
| 支持 Windows 吗 | Windows 10+ **x64**（ARM 不支持）；安装包 381 MB |
| **能被 DSH 驱动吗** | **不能。** 没有任何面向外部的 API key / CLI / MCP 入口；SDK 层面它就是人手操作的 GUI |

> 所以：Hub/Design 适合**手动试片、比稿**；要自动化、批量或接进流水线，一律走 API（本文档 §4）。

---

## 2. 三条通路对比

| | **A. 本仓库驱动脚本 `h3.mjs`**（推荐） | B. 官方 CLI `mmx-cli` | C. Hub / MiniMax Design |
| --- | --- | --- | --- |
| 可被 agent / 脚本自动调用 | ✅ 命令行直接调 | ✅ | ❌ 只能人点 |
| 分辨率可选 | ✅ 768P / 2K / 480P | ❌ **恒发 2K，没有 `--resolution`** | ✅ |
| H3-Max 可用 | ✅ | ❌ v1.0.26 会错落到 V1 端点 | ✅ |
| Context-IR 提示词增强 | ✅ | ❌ 无此子命令 | 内部自动 |
| 2K 再生成 | ✅ | ❌ | ✅ |
| 本地素材上传 | ✅ 自动 `mm_file://` | ✅ | ✅ |
| 成本预估/上限保护 | ✅ `--max-cost` | ❌ | ❌ |
| 额外安装 | 无（零依赖 Node） | `npm i -g mmx-cli`（33 包 / 37 MB） | 381 MB 桌面端 |

**CLI 装在**：**你自己工作区**下的 `<workdir>/tools/minimax-h3/cli/node_modules/mmx-cli`（工作区本地安装，未装全局、不在 PATH），bin 是 `tools/minimax-h3/cli/node_modules/.bin/mmx.cmd`（POSIX 下为同目录的 `mmx`）。

---

## 3. 实测证据（2026-09-27，一次真实交付的参照）

### 3.1 出片链路

```
命令: node tools\minimax-h3\h3.mjs run --model MiniMax-H3 \
        --prompt-file 10_video\prompts\<NN>_<slug>.txt \
        --duration 5 --resolution 768P --ratio 16:9 --out ... --max-cost 5 --yes

11:43:43  已提交任务 task_id=446283055206708
11:43:44  状态：running
11:45:35  状态：succeeded  （用时 111.1s）
11:45:37  已保存 0.79 MB → 10_video\out\<slug>_H3_768P_5s.mp4
```

### 3.2 产物技术核验（ffprobe 原文）

| 项 | 实测值 | 是否合官方规格 |
| --- | --- | --- |
| 分辨率 | **1344×768**（16:9，短边 768） | ✅ 768P 档 |
| 帧率 | **24 fps**（124 帧 / 5.167s） | ✅ 官方写明 24 FPS |
| 视频编码 | H.264 High | — |
| **音频** | **AAC LC / 32000 Hz / 2ch stereo** | ✅ 官方写明「32 kHz 立体声」原生音频 |
| 音量 | mean −19.1 dB，**无 ≥0.3s 静音段** | ✅ 确实连续有声 |
| 体积 | 831,952 B（1.29 Mbps） | — |
| 计费 | usage.output_seconds=5 → **¥2.50** | ✅ 与刊例一致 |

> ⚠️ 已注意：max_volume 0.0 dB 且有 101 个采样点摸到 0 dB —— 有轻微削顶，混音时留 −1 dBTP 余量。

### 3.3 端点授权探测（免费，靠"参数非法则不建任务"原理）

| 端点 | 探测结果 | 含义 |
| --- | --- | --- |
| `GET /v2/query/video_generation` | `{"items":[],"total":0}` → 现在能列出任务 | ✅ 有 V2 读权限 |
| `POST /v2/video_generation`（H3，duration=99） | `model MiniMax-H3 does not support duration 99s, supported: 4s…15s` | ✅ H3 授权通过；时长 4–15s |
| `POST /v2/video_generation`（H3-Max，duration=4） | `MiniMax-H3-Max does not support duration 4s, supported: 5s…15s` | ✅ **H3-Max 也已授权**，且最短 5s |
| `POST /v2/h3_context_ir` | `t2va(纯文本)场景必须显式指定 ratio` | ✅ Context-IR 可用 |
| `POST /v2/video_regeneration` | `either source_task_id or exactly one base_video … is required` | ✅ 2K 再生成可用 |

### 3.4 抽帧

`10_video\out\frames\` 下取 0.5s / 2.5s / 4.5s 三帧，抽帧核对**画面与 prompt 是否吻合**。
**但要如实说**：该次交付里 2.5s 与 4.5s 两帧的差异偏小 —— 说明那条 prompt 里关键动作的幅度写得不够显式，H3 更多是做了缓慢推镜。**这是 prompt 写法问题，不是工具问题**，改进见 §5.4。

---

## 4. 快速上手

### 4.1 凭据

Key 存放在 `~/.dsh/.credentials.yaml` 的 `MINIMAX_API_KEY`（`sk-api…`，**中国区按量付费 key**）。脚本按 `--key` → `MINIMAX_API_KEY` 环境变量 → `~/.mmx/config.json` → `~/.dsh/.credentials.yaml` 顺序自动查找，**无需把 key 写进任何脚本或命令行**。

### 4.2 常用命令

```powershell
$H = "tools\minimax-h3\h3.mjs"

# ① 文生视频（最常用）：提交→轮询→下载 一步到位
node $H run --prompt-file 10_video\prompts\<NN>_<slug>.txt `
  --duration 5 --resolution 768P --ratio 16:9 `
  --out-dir 10_video\out --max-cost 5 --yes

# ② 先估费（不发请求，不花钱）
node $H estimate --model MiniMax-H3 --resolution 768P --duration 10

# ③ 首帧图生视频（宽高比由图片决定，ratio 自动 adaptive）
node $H run --prompt-file p.txt --image 01_input\<参考图>.png --duration 6 --resolution 2K --yes

# ④ 首尾帧（图与图之间的连续运动）
node $H run --prompt-file p.txt --image first.png --last-frame last.png --duration 8 --yes

# ⑤ 多模态参考（角色一致性：参考图+参考视频+参考音频，≤9图/3视频/3音频）
node $H run --prompt-file p.txt --ref-image 01_input\<参考图>.png `
  --ref-video motion.mp4 --ref-audio rhythm.mp3 --duration 10 --yes

# ⑥ 粗糙想法 → 官方结构 prompt（H3-Context-IR，按 token 计费，很便宜）
node $H context-ir --prompt "女孩在海边提着灯回望" --duration 5 --out 10_video\prompts\enhanced.txt

# ⑦ 768P 成片 → 2K 再生成
node $H regenerate --source-task-id <task_id> --out 10_video\out\<NN>_2K.mp4

# ⑧ 任务管理
node $H list --size 10
node $H get 446283055206708
node $H cancel 446283055206708
```

### 4.3 官方 CLI 的用法（备用，注意两条硬伤）

```powershell
$mmx = "tools\minimax-h3\cli\node_modules\.bin\mmx.cmd"
& $mmx video generate --model MiniMax-H3 --prompt "..." --duration 5 `
     --ratio 16:9 --download out.mp4 --region cn --poll-interval 10 --non-interactive
```

> **硬伤 1**：没有 `--resolution`，**恒发 2K（¥0.80/s）**；要 768P（¥0.50/s）必须用 `h3.mjs`。
> **硬伤 2**：v1.0.26 传 `--model MiniMax-H3-Max` 会落到旧的 V1 端点。

---

## 5. Prompt 写法（T2VA 三段式）

H3 的 prompt **不是一句话描述**，而是一段**带时间轴的多模态脚本**。官方要求三个字段：

```text
integrated_multimodal_description: [Shot 1] 风格 + 构图 + 主体 + 动作 + 运镜 + 台词
（切镜用 [Shot 2] At 00:03.500, the camera cuts to ...）

overall_soundscape: 环境音 / 动作音 / 非语言人声（1–4 句英文）

non_diegetic_music: 只有观众能听到的配乐：乐器 + 速度 + 节奏 + 动态（1–3 句）
```

### 5.1 硬规则

| 规则 | 说明 |
| --- | --- |
| 用英文写 | 台词、歌词、画面上的文字**保留原语言**，放进 `<d>[Chinese] …</d>` |
| 时长要匹配 | 描述的时间轴必须对得上 `--duration`（4–15s 整数） |
| 运镜写全三维 | 类型 + 幅度 + 速度，如 `pushes in with small amplitude at slow speed` |
| 不要抽象词 | 别写 "cinematic, beautiful"；写"什么样的光、什么样的动作、什么声音" |
| 对白标说话人 | `(S1)` / `(S2)`，同一角色跨镜头保持同一 ID |
| 画外音 | 用 `says in an off-screen voiceover`，并补一句"嘴唇完全不动" |

### 5.2 运镜词表（官方）

`Zoom In/Out`｜`Push In/Pull Out`｜`Pan Left/Right`｜`Truck Left/Right`｜`Tilt Up/Down`｜`Pedestal Up/Down`｜`Arc Shot`｜`Tracking Shot`｜`Static Shot`｜`Shake Slightly/Strongly`｜`POV`｜`Roll Clockwise/Counterclockwise`
幅度 `with small/large amplitude`，速度 `at slow/fast speed`。

### 5.3 关键帧模式的指令行（必须放在 prompt 第一行）

| 模式 | 第一行写什么 |
| --- | --- |
| I2VA（首帧） | `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.` |
| FL2VA（首尾帧） | `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark ...; Picture 2 (from Shot N) aligns with the S.SS-second mark ...` |
| L2VA（尾帧） | `How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.` |

完整的 H3 提示词写作规范见 `h3-prompt-writing` 技能的 `references/base-en.txt`（技能装在 `~/.agents/skills/h3-prompt-writing/`，含 Ref2VA 六段式）。

### 5.4 一次真实交付中使用的 prompt（可直接当模板改）

见 `10_video\prompts\<NN>_<slug>.txt`，全文如下：

```text
integrated_multimodal_description: [Shot 1] 2D-animated, cinematic anime film style, a medium shot frames a girl with long silver-white hair and a white-and-dark-blue summer uniform standing alone on wet stone steps at the edge of the sea just after sunset, holding a small paper lantern in both hands. She is still at first, looking down at the unlit lantern; the camera pushes in with small amplitude at slow speed as she slowly lifts her head toward the horizon. A single flame catches inside the lantern and warm light moves across her face, her hair, and the damp stone under her feet; far behind her on the beach a low bonfire burns and its embers drift upward into the dark sky. She says quietly: <d>[Chinese] <台词>。</d> The sea breeze lifts the hem of her skirt and the lantern flame steadies as she raises the lantern slightly higher in the final moment.

overall_soundscape: Gentle sea waves break against the stone steps while wind moves through her hair and clothing. The lantern's paper crinkles softly, a small flame pops into life, and her shoes shift on the wet stone. A distant bonfire crackles from the beach below.

non_diegetic_music: A slow solo piano figure with sustained warm string pads underneath, joined near the end by a single low cello note that swells slightly as the lantern lights, then fades.
```

**可复用的改进点**（针对"动作幅度偏小"这一类问题）：
1. 把动作拆成**带时序的节拍**：`At 00:01.200 she lowers her chin… At 00:02.800 she raises the lantern to eye level… At 00:04.000 her lips part and she says…`
2. 加**可观察的结果**："火焰在她瞳孔里的倒影变大"这类能落到像素上的描述。
3. 若必须保证某个动作，**用首帧/尾帧图把两端钉死**（FL2VA），让模型只能走中间路径。

---

## 6. 计费与限额

### 6.1 刊例价（中国站，按输出秒数）

| 模型 | 分辨率 | 单价 | 5 秒成本 |
| --- | --- | --- | --- |
| `MiniMax-H3` | 768P | ¥0.50/s | ¥2.50 |
| `MiniMax-H3` | 2K | ¥0.80/s | ¥4.00 |
| `MiniMax-H3-Max` | 480P | ¥0.33/s | ¥1.65 |
| `MiniMax-H3-Max` | 768P | ¥0.50/s | ¥2.50 |

输入素材：**音频免费**；图片 5 张内免费、超出 ¥0.20/张；参考视频按时长 × 输出分辨率计费。2K 再生成 ¥0.30/s。Context-IR 按 token：5.80 元/百万输入、23.00 元/百万输出（**一次几厘钱**）。

### 6.2 限额

- Video Generation V2（H3）：**RPM 300，最大并行任务 30**（旧 Hailuo 系列只有 RPM 20）
- 任务与上传素材**只保留 7 天**，过期查询报 `invalid task_id`
- 成片下载 URL **有时效**（官方未给具体数字，V1 文件是 1 小时）→ **拿到就下载，别攒**

### 6.3 想免费验证权限的小技巧

用**非法参数**打端点：服务端在参数校验阶段就返回错误，**不会建任务、不计费**，但能证明"鉴权 + 模型授权"已通过。例如 `--duration 99` 会回一句"支持 4–15s"。

---

## 7. 实测踩到的坑（照抄避雷）

| # | 坑 | 现象 / 处置 |
| --- | --- | --- |
| 1 | **H3 必须用"按量付费"key** | Token Plan 订阅 key / OAuth 都不行，会报 2013。用来跑通的那把 `sk-api…` 正是按量付费类型，✅ 实测可用 |
| 2 | **区域不通** | 同一把 key 打国际站 `api.minimax.io` → `invalid api key`；打国内站 `api.minimaxi.com` → 正常。**国内 key 只能打国内域名** |
| 3 | 官方 CLI 无法选分辨率 | 恒 2K。想省钱用 `h3.mjs` |
| 4 | 两代 API 状态枚举不通用 | V2 全小写 `queued/running/succeeded/failed/cancelled`；V1 是 `Preparing/Queueing/Processing/Success/Fail` |
| 5 | 图生视频与参考生视频**互斥** | 同时给 `first_frame` 和 `reference_*` 会被拒 |
| 6 | t2va 必须显式给 ratio | 不给报 2013；`adaptive` 不允许 |
| 7 | H3-Max 档位更窄 | 最短 5s、不支持 2K |
| 8 | PowerShell 传中文 prompt 不可靠 | 一律写进 `.txt` 用 `--prompt-file` 传，绕开引号/编码地狱 |
| 9 | 服务端响应偶尔带 BOM | 脚本已做 `\uFEFF` 剥离 |
| 10 | 上传素材 7 天过期 | 长期任务要重传 |

---

## 8. 原生工具接入（已接通：DSH MCP）

**H3 现在就是 DSH 里的原生工具**（2026-09-27 实测上线，一次真实交付的参照），工具名前缀 `mcp__h3__`：

| 工具 | 作用 |
| --- | --- |
| `h3_estimate_cost` | 费用预估（纯本地计算，不发请求、不花钱） |
| `h3_generate_video` | 【会花钱】异步提交任务并返回 task_id；预估超 `maxCostCny`（默认 ¥5）时必须显式 `confirmSpend: true` |
| `h3_fetch_result` | 轮询进度；成功后自动下载并返回落盘路径 |
| `h3_task_status` / `h3_list_tasks` / `h3_cancel_task` | 任务查询与管理 |
| `h3_enhance_prompt` | 用 H3-Context-IR 把粗糙想法扩写成三段式 prompt |
| `h3_regenerate_2k` | 768P → 2K 再生成 |
| `h3_upload_asset` | 本地素材 → `mm_file://file_id` |

### 8.1 为什么没用官方 `minimax-mcp-js`

实测其源码：`VALID_VIDEO_MODELS = ['T2V-01','T2V-01-Director','I2V-01','I2V-01-Director','I2V-01-live','S2V-01','MiniMax-Hailuo-02']`，且视频路径走**已过时的 V1 端点** `/v1/video_generation`（还要 file_id 换下载地址）——**它做不了 H3**。所以「H3 变原生工具」只能自建 MCP 服务器。官方包另有价值（TTS / 文生图 / 声音克隆 / 音色设计），见 §9。

### 8.2 实现要点

- 服务器：`tools/minimax-h3/mcp-server/minimax-h3-mcp.mjs`，基于官方 `@modelcontextprotocol/server` v2（2026-07-28 规范）的 `serveStdio`。**不重写任何 API 逻辑，全部复用 `h3.mjs`**（单一事实源）。

> **从仓库取用时的两步**（本仓库把源文件放在 `drivers/minimax-h3/mcp-server/`）：①先把整个目录复制到 `tools/minimax-h3/mcp-server/`；②在那个目录里跑 `npm install` —— **驱动 `h3.mjs` 是零依赖的，但这个 MCP 服务器不是**（需要官方 MCP SDK v2：`@modelcontextprotocol/server` + `client` + `zod`，`node_modules` 不入仓）。
- **异步设计**：MCP 单次请求默认超时 **60 秒**（`DEFAULT_REQUEST_TIMEOUT_MSEC`），而一次 5 秒出片实测要 111 秒（一次真实交付的参照）→ `generate` 只提交、立刻返回 task_id，由 `h3_fetch_result` 分次轮询（单次上限 50 秒）。
- **金额保护**：预估超上限且未确认 → **提交前**直接拒绝，零扣费（一次真实交付里 15s@2K = ¥12 的请求被拒）。
- **密钥不入配置文件**：服务器自行从 `~/.dsh/.credentials.yaml` 读取（DSH 的 MCP stdio 客户端还会按 `/KEY|PASSWORD|SECRET|TOKEN/` 清洗环境变量，所以也不该靠 env 传）。
- **stdout 纪律**：MCP 的 stdout 是 JSON-RPC 协议通道，服务器所有诊断信息一律走 stderr —— 为此把 `h3.mjs` 的日志输出也改到了 stderr，并让每个命令在 `--output json` 时只向 stdout 吐纯 JSON。

### 8.3 注册方式

写进 profile 补丁层 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（Windows 上即 `C:\Users\<你>\.dsh\profiles\web\cordis.patch.yml`）：

```yaml
- insert:
    - id: minimax-h3-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: h3
        transport: stdio
        command: node
        args: ['<WORKSPACE>/tools/minimax-h3/mcp-server/minimax-h3-mcp.mjs']
        cwd: '<WORKSPACE>'
        failOnStartupError: false
```

> 把上例中的 `<WORKSPACE>` 换成**你的工作区绝对路径**（Windows 下写 `E:/path/to/workspace` 这种正斜杠形式最稳）。

- 改动前的原文件已备份至 `tools/minimax-h3/backups/`。
- 补丁 YAML 结构可用 `node tools/minimax-h3/check-profile-patch.mjs` 校验。
- **回归自测**：`node tools/minimax-h3/mcp-server/_selftest.mjs`（用官方客户端 SDK 拉起服务器、列工具、调只读工具、验证超额拒绝）。

## 9. 下一步可选项

1. **是否再挂官方 `minimax-mcp-js`**：可补 TTS（30+ 中文音色）、文生图、声音克隆、音色设计（共 9 个工具），但**视频只有旧的 Hailuo-02**；且它默认 host 是老的 `api.minimax.chat` 域名，需先确认国内区 key 能否使用。
2. **装 MiniMax Design（原 Hub）桌面端** → 手动试片/比稿用，有 3 次免费 H3。
3. **接进本仓库的 PV 流水线** → 用已定稿的人声轨（例如 ACE Studio 工程导出的成品）+ 本工具出画，再合轨。

---

## 10. 文件清单

| 文件 | 作用 |
| --- | --- |
| `tools\minimax-h3\h3.mjs` | **主驱动**：零依赖 Node，全端点覆盖 + 费用保护（日志走 stderr，`--output json` 时 stdout 只出 JSON） |
| `tools\minimax-h3\mcp-server\minimax-h3-mcp.mjs` | **MCP 服务器**：把 H3 变成 DSH 原生工具（基于官方 server SDK v2，复用 h3.mjs） |
| `tools\minimax-h3\mcp-server\_selftest.mjs` | MCP 回归自测（官方客户端 SDK 拉起服务器、列工具、验超额拒绝） |
| `tools\minimax-h3\check-profile-patch.mjs` | 校验 profile 补丁 YAML 结构 |
| `tools\minimax-h3\backups\` | 改动 DSH profile 前的配置备份 |
| `tools\minimax-h3\cli\` | 官方 CLI `mmx-cli@1.0.26`（工作区本地安装） |
| `tools\minimax-h3\mcp-js\` | 官方 `minimax-mcp-js@0.0.18`（**已核实不含 H3**，暂未挂载） |
| `10_video\prompts\<NN>_<slug>.txt` | 一次真实交付用的 prompt（模板） |
| `10_video\out\<slug>_H3_768P_5s.mp4` | **实测成片**（一次真实交付的参照：5.17s / 1344×768 / 含音频） |
| `10_video\out\<slug>_H3_768P_5s.json` | 任务元数据（task_id / usage / 费用 / 链接） |
| `10_video\out\frames\` | 抽帧 0.5s / 2.5s / 4.5s |

> **非破坏性说明**：本工具只新增文件，不覆盖既有素材；成片下载与本地产物命名冲突时脚本会自动加 `-2`/`-3` 后缀，**永不覆盖同名文件**。
