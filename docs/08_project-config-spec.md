# 翻填项目配置规范（schema v1 · 冻结）

> **性质**：数据契约。`翻填项目.json` 是脚本、工作台、技能三方**唯一的参数来源**。
> **冻结时间**：2026-09-27 ｜ **版本**：`schema: 1`
> **落地文件**：`<歌曲工作区>\翻填项目.json`
> **配套**：`00_docs\06_翻填视频工作流_开发计划.md`（总计划）、`00_docs\07_工作台能力探测报告.md`（能力边界）

---

## 0. 设计原则

1. **文件即真相源，不引入数据库。** Agent 与 Web 工作台读写同一批文件，UI 只是"视图 + 最小写回"。
2. **脚本零硬编码。** 任何脚本不得写死歌名、总长、段数、LRC 路径、分辨率；一律从这里读。
3. **换歌 = 换工作区。** 新歌新建一个目录、放一份 `翻填项目.json`，脚本原样可用。
4. **路径一律工作区相对 + POSIX 分隔符**（`/`）。脚本内部用 `path.resolve(workspaceRoot, rel)` 转本地路径——**绝不硬编码中文绝对路径**。
5. **向后兼容优先于整洁。** 已经交付过的工程，其 PV 产物**保留在原有目录**，不改名不搬迁（非破坏性优先）。迁移已有工程的成本，永远高于忍受一个旧目录名。

---

## 1. 顶层结构

```jsonc
{
  "schema": 1,              // 必填。规范版本号；脚本据此做兼容分支
  "song":     { ... },      // 必填。歌本身
  "audio":    { ... },      // 必填。音乐线输入/产物
  "video":    { ... },      // 必填。视频线参数与目录
  "credits":  { ... },      // 必填。署名（成片/封面/投稿文案共用）
  "budget":   { ... },      // 必填。成本纪律
  "cover":    { ... },      // 必填。封面参数
  "segments": [ ... ]       // 可选。分镜表；缺省时由 80_shotlist 生成到 plan/segments.json
}
```

> `segments` **可以不写在配置里**。分镜是 `80_shotlist.mjs` 的产物，落在 `plan/segments.json`（脚本与工作台共享）。
> 配置里只写"分镜的约束"（`segMaxSec` / `transition` / `aspect`），不写分镜本身。

---

## 2. `song` — 歌

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 歌名。用于产物命名与工作台标题 |
| `source` | string | ✅ | 出处（写清作品名，用于片头卡与署名），如 `某作品 第 N 话 插曲` |
| `lrc` | relpath | ✅ | 翻填词 LRC（**工作区相对**） |
| `bpm` | number | ✅ | 目标工程 tempo。ACE 导入前必须与 MIDI tick 口径一致 |
| `totalSec` | number | ✅ | 成品音频总长（秒），对齐与分镜的基准 |
| `fps` | number | ⭕ | 默认 24。合成与核验帧率 |

**约定**：`totalSec` 必须等于 `audio.master` 的实测时长（用 ffprobe 核，不靠手填）。

---

## 3. `audio` — 音乐线

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `reference` | relpath | ✅ | 原曲（用于对比/对照） |
| `referenceLocal` | relpath | ⭕ | 原曲的工作区本地副本（规避中文/空格路径） |
| `instrumental` | relpath | ✅ | 伴奏（分离产物） |
| `stemsVocals` | relpath | ⭕ | 分离出的人声（做对齐/校验用） |
| `aceVocal` | relpath | ✅ | ACE 渲染出的人声干声 |
| `master` | relpath | ✅ | 混音成品。**`song.totalSec` 的事实来源** |
| `separation` | `"ace"` \| `"python-audio-separator"` | ✅ | 分离路线 |
| `separationModel` | string | ⭕ | 如 `bs_roformer_ep_317_sdr_12` |
| `voice.target` | string | ✅ | 目标音色名（用于产物命名与署名） |
| `voice.engine` | string | ✅ | `ace-studio` / `ddsp-svc` |
| `voice.svcModelDir` | relpath | ⭕ | SVC 模型目录 |
| `loudness.iLufs` | number | ✅ | 整体响度目标（默认 −14） |
| `loudness.toleranceLufs` | number | ⭕ | 容差（默认 ±1） |
| `loudness.truePeakDbtp` | number | ✅ | 真峰值上限（默认 −1） |

**约定**：`reference` 指向的原始素材 **只读**——非破坏性红线。

---

## 4. `video` — 视频线

### 4.1 目录（全部 relpath；除 `cgDir` 是输入目录外，其余均为**产物目录**）

| 字段 | 默认（新歌） | 说明 |
|---|---|---|
| `dir` | `10_video` | PV 根目录。**已有工程可显式指向它原来的目录**（兼容，不搬迁） |
| `planDir` | `<dir>/plan` | 分镜表、时间轴、台账、素材盘点 |
| `promptDir` | `<dir>/prompts` | 每段 prompt 的 `.txt` |
| `refDir` | `<dir>/refs` | 去水印 + 缩放后的参考图 |
| `clipDir` | `<dir>/clips` | 每段成片 |
| `subDir` | `<dir>/subs` | `.ass` / `.srt`（多分辨率各一份，带 tag） |
| `coverDir` | `<dir>/cover` | 封面 + `logos/` |
| `verifyDir` | `<dir>/verify` | 核验报告与抽帧 |
| `historyDir` | `<dir>/history` | 被替换的旧产物 + README |
| `cgDir` | `01_input/CG` | **输入**目录（本表唯一的非产物项）：CG 原图源。`81_pv_refs` 把这里的图去水印 + 缩到 1536 宽后写进 `refDir` |

> 显式写目录而不是只写 `dir` 再拼后缀，是为了让"已有工程沿用旧布局"和"新工程用新布局"都能表达。

### 4.2 画幅与分辨率

| 字段 | 类型 | 说明 |
|---|---|---|
| `aspect` | `"16:9"` \| `"9:16"` \| `"1:1"` | 画幅 |
| `baseRes` | `"768P"` \| `"2K"` \| `"480P"` | **送 H3 的分辨率档**（决定单价） |
| `baseSize` | `[w, h]` | 基准成片尺寸，如 `[1344, 768]`。合成/字幕/核验都用它 |
| `deliverRes` | array | 交付分辨率列表，每项 `{name, size, method, tag}` |
| `model` | `"MiniMax-H3"` \| `"MiniMax-H3-Max"` | 出片模型 |
| `pricePerSecond` | number | 该模型 × 该分辨率档的**单价（元/秒）**，预算与 `--plan` 用 |

`deliverRes[].method` 取值：

- `realesrgan-x2-then-downsample` — 本地真超分（免费，耗时）
- `h3-2k-regen` — H3 原生 2K 重生成（**花钱**）

### 4.3 字幕

| 字段 | 说明 |
|---|---|
| `subtitle.font` | 字体名（烧录进 ASS） |
| `subtitle.size` | 字号（**按基准尺寸**，多分辨率时按比例缩放） |
| `subtitle.minDisplaySec` | 保底显示时长（默认 3.0s） |
| `subtitle.lineLevel` | `true` = 行级字幕（一句一行），不整段塞 |
| `subtitle.followMeasuredOnset` | `true` = 跟随**实测起音**而非 LRC 名义时间 |

### 4.4 分镜约束

| 字段 | 说明 |
|---|---|
| `segMaxSec` | 单段上限（默认 15s） |
| `transition` | `cut` \| `dissolve` |
| `transitionDurSec` | 溶解时长 |
| `maxPromptChars` | prompt 字符上限（H3 = **7000**，硬约束） |

### 4.5 超分

| 字段 | 说明 |
|---|---|
| `upscale.tool` | Real-ESRGAN 可执行文件（relpath） |
| `upscale.model` | `realesrgan-x4plus` 等 |
| `upscale.scale` | 放大倍数 |

### 4.6 `deliverables` — 成品索引

工作台"账本/成品"页直接读这几个字段，不猜文件名。

### 4.7 参考图、指定画面与接缝

| 字段 | 类型 | 说明 |
|---|---|---|
| `delogo` | array | 送 H3 当参考图前的**去水印矩形**列表，**空数组 = 不擦**。每项 `{x,y,w,h,note}` 的四个数都是**源图宽高的比例（0–1）**；可选 `anchor`：`top-left`（默认，x/y 为左/上边距）或 `bottom-right`（x/y 为右/下边距）。由 `81_pv_refs.mjs` 按源图的 logo 位置取用 |
| `mandated` | array | 核验时**必抽**的指定画面：`[{sec, segIdx, note}]`。`sec` 是抽帧时间点，`segIdx` 是它应落在的段号，`note` 是抽这帧的理由。由 `85_pv_verify.mjs` 写进报告 |
| `chainedThreshold` | number | 链式接点的末帧/首帧 SSIM 门槛，默认 `0.60`。"链式接点"= `segments.json` 里 `chainFrom != null` 的那些段（不是写死的段号） |

---

## 5. `credits` — 署名

```jsonc
"credits": {
  "original":    { "词": "…", "曲": "…", "原唱": ["…"] },   // 原曲方
  "thisVersion": { "改词": "…", "tools": [ {"role":"…","name":"…"} ],
                   "disclaimer": "…" }                      // 本版
}
```

**硬纪律**：成片、封面、投稿文案三处署名必须**同源**（都从这个字段渲染），不得各写一套。
`disclaimer` 必须含 **AI 生成 + 非商用 + 原曲署名** 三要素。

---

## 6. `budget` — 成本

| 字段 | 说明 |
|---|---|
| `totalCny` | 总预算 |
| `spentCny` | 已花（由台账汇总，脚本只读不写，除非显式 `--sync-budget`） |
| `authorized` | 是否已有用户总授权 |
| `authorizationNote` | 授权原话（留痕） |

**纪律**：一次总授权 + 逐笔台账，**不做逐步确认**（用户明确要求"不要太多瓶颈"）；
只在**预估会突破 `totalCny`** 时停下来问。台账落在 `_进度/成本台账.csv`。

---

## 7. `cover` — 封面

| 字段 | 说明 |
|---|---|
| `title` / `subtitle` | 封面主副标题 |
| `preset` | 选定的版式（如 `D_10th`） |
| `sizes` | 输出尺寸列表；B站封面固定含 `[1146, 717]` |
| `logos` | 官方 logo 路径列表（跨歌共享资产的引用，不复制） |

---

## 8. 状态文件（非配置，但同属数据契约）

| 文件 | 性质 | 谁写 |
|---|---|---|
| `_进度/进度.md` | 人读进度 + 产物索引 | Agent 每批次**追加** |
| `_进度/成本台账.csv` | 逐笔花费 | 出片脚本自动追加 |
| `<planDir>/segments.json` | 分镜表（含实测对齐数据） | `80_shotlist.mjs` 生成 |
| `<planDir>/cost_log.csv` | 出片逐次尝试（含失败） | `82_clips.mjs` 追加 |
| `<planDir>/lyrics_timing.csv` | 逐句 LRC vs 实测起音 | `80_shotlist.mjs` 生成 |

`成本台账.csv` 列固定：

```csv
时间,阶段,项目,金额CNY,累计CNY,备注
```

---

## 9. 校验规则（脚本启动即执行，失败就报错退出）

1. `schema === 1`，否则提示"配置版本不匹配"。
2. `song` / `audio` / `video` / `credits` / `budget` / `cover` 六个键齐全。
3. 所有 relpath **不得是绝对路径**，不得含 `..`。
4. `audio.master` 存在；`song.totalSec` 与实测差 ≤ 0.05s（不满足只**警告**，不阻断）。
5. `video.maxPromptChars` ≤ 7000（超过则警告，因为那是 API 硬顶）。
6. `video.pricePerSecond > 0` 且 `budget.totalCny > 0`。

---

## 10. 换歌清单（新歌开工必做）

1. 建目录，复制 §5.6 的结构。
2. 写 `翻填项目.json`：至少填 `song.name/source/lrc/bpm/totalSec`、`audio.*`、`video.dir = "10_video"`、`credits`、`budget`、`cover`。
3. 跑 `node scripts/80_shotlist.mjs --plan` 自检配置能不能被读出。
4. 目录里**没有的**素材（如人声渲染）保持空字符串或省略键——脚本按"缺"处理，工作台按 ⛔ 显示。

---

## 附：一份完整实例

本规范配了一份可直接参照的完整配置：仓库根目录的 `examples/project-config.json`。
它是**一次真实交付实际用的那份配置**（含真实路径与取值），配上 `examples/` 下的
`progress.md`、`cost-ledger.csv`、`segments.json` 等同期产物，能看清各字段在真实项目里的样子。

**读法**：字段结构照抄，字段取值按你自己的素材改。特别是这几项不要照搬——

| 字段 | 为什么不能照搬 |
|---|---|
| `song.totalSec` | 你的音频多长就写多长（必须与 `audio.master` 实测一致，±0.05s） |
| `song.bpm` | 目标工程 tempo，影响 MIDI tick 换算 |
| `video.dir` | 新工程用默认 `10_video`；已有工程指向它原来的目录 |
| `video.pricePerSecond` | 按你实际用的模型与分辨率档填（这是预算与 `--plan` 的唯一单价来源） |
| `budget.*` | 预算与已花金额，随项目推进更新 |
| `audio.*` / `video.ffmpegDir` / `video.h3Driver` | 你的本地路径 |
