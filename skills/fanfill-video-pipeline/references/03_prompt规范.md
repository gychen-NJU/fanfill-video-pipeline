# 03 · H3 提示词规范（本项目落地版）

> **本文件定位**：细节、模板、实例、阈值。SKILL.md 只讲"什么时候写 prompt、硬约束是什么"，
> 具体怎么落笔看这里。
> **上游口径**（写前必读，本文件不得与之冲突）：
> - `~/.agents/skills/h3-prompt-writing/SKILL.md`
> - `~/.agents/skills/h3-prompt-writing/references/base-en.txt`（T2VA / I2VA / FL2VA / L2VA 权威规范）
> - `~/.agents/skills/h3-prompt-writing/references/ref-en.txt`（Ref2VA 六段式权威规范）
> - `~/.agents/skills/minimax-h3-video/SKILL.md`（硬约束与调用方式）
>
> **本项目证据源**：`10_h3video/pv/prompts/**`（17 段真实 prompt）、`plan/segments.json`、
> `plan/shotlist.csv`、`plan/keyframes.json`、`00_docs/05_PV制作流水线.md`、`00_docs/04_MiniMax-H3视频生成工作流.md`

---

## 0. 一句话

H3 的 prompt **不是一句话描述，而是一段带时间轴的多模态脚本**；写错结构会直接报 `2013 invalid params`，
写对结构但动作幅度不够，模型就只给你一段缓慢推镜（本歌实测踩过，见 §11.3）。

---

## 1. 五种模式速查

| 模式 | 全称 | 输入 | 第一行 | 本项目实际用量 |
|---|---|---|---|---|
| **T2VA** | 纯文生视频 | 无图 | **无对齐指令**，直接 `integrated_multimodal_description:` 开头 | 段 2 / 3（前奏信息卡） |
| **I2VA** | 首帧图生视频 | 1 张首帧 | `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.` | 段 12 / 13（间奏，链式续拍） |
| **FL2VA** | 首尾帧 | 2 张（首 + 尾） | `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark …; Picture 2 (from Shot N) aligns with the S.SS-second mark …` | 段 5（规划模式；实作改 Ref2VA，见 §9.2） |
| **L2VA** | 末帧图生视频 | 1 张尾帧 | `How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.` | **本歌未使用**（模板见 §6，未实测） |
| **Ref2VA** | 六段式多模态参考 | 1–9 张参考图（+参考视频/音频，本项目未用） | `subject_definitions:` 开头，**无对齐指令** | 段 1 / 4 / 6 / 8 / 9 / 10 / 11 / 14 / 15 / 16 / 17 |

> **方括号陷阱**：I2VA 写 `(from [Shot 1])`（**带**方括号），FL2VA / L2VA 写 `(from Shot 1)`（**不带**）。
> `80b_check_prompts.mjs` 会专门抓这一条（"FL2VA 对齐指令误用方括号"）。

---

## 2. 三段式结构（T2VA / I2VA / FL2VA / L2VA 共用）

```text
integrated_multimodal_description: [Shot 1] 风格 + 构图 + 主体 + 动作 + 运镜 + 台词
（切镜写 [Shot 2] At 00:03.500, the camera cuts to …）

overall_soundscape: 环境音 / 动作音 / 非语言人声

non_diegetic_music: 只有观众能听得到的配乐
```

| 字段 | 该写什么 | 不该写什么 |
|---|---|---|
| `integrated_multimodal_description` | 视觉风格、初始构图、主体外观与位置、场景与道具、动作与反应、切镜、说话人、同步的画内音 | 剧情概括；抽象形容词（`cinematic`、`beautiful` 单独用）；与时长不符的时间轴 |
| `overall_soundscape` | 全片**汇总**的环境音、物理动作音、非语言人声（风/雨/脚步/布料/碰撞/呼吸/笑），1–4 句英文，一段连续 | 对白、歌唱、画内音乐（那些属于第一段）；重复第一段已写过的内容 |
| `non_diegetic_music` | 角色听不到、只有观众听得到的配乐：乐器 + 速度 + 节奏 + 动态，1–3 句 | 抽象情绪词（"悲伤地"）；解释配乐的情绪功能 |

**本项目的特殊纪律**：配乐用母版音频（`09_aceproject/初调/翻填.wav`），所以
**`non_diegetic_music` 一律写 `N/A`**，17 段无一例外。`80b_check_prompts.mjs` 硬校验这一条
（必须是**纯** `N/A`，写 `N/A (BGM from master)` 会被判不合格）。

**切镜写法**：第一镜**不加时间码**；后续镜按 `[Shot 2] At 00:03.500, the camera cuts to …` 递增。

本歌 17 段**正文本镜数**实测分布（2026-09-28 复核）：

| 正文镜数 | 段 | 数量 |
|---|---|---|
| **1 镜**（单镜到底） | 2 / 3 / 5 / 17 | 4 |
| **2 镜** | 7 / 9 / 10 / 12 / 14 | 5 |
| **3 镜** | 1 / 4 / 6 / 8 / 11 / 13 / 15 / 16 | 8 |

> **统计口径**：数 `prompts/NN_slug.txt` 里 `[Shot N]` 的出现次数，再**减去首行对齐指令那一处**
> （I2VA / FL2VA 的首行固定含 `(from [Shot 1])` / `(from Shot 1)`，不清掉就会把每段多算一镜；
> T2VA 没有对齐指令，直接数即可）。
> **本歌最长只切 3 刀**：单段生成时长上限 15s，切得越多每镜分到的动作时间越短，
> 越容易出现"镜头变了但动作没发生"。

---

## 3. T2VA 模板与实例

### 3.1 骨架（`prompts/NN_slug.txt`）

```text
integrated_multimodal_description: [Shot 1] <风格后缀> <构图> <主体> <带时序节拍的动作> <运镜>
[Shot 2] At 00:0X.XXX, the camera cuts to <新信息：主体 / 空间 / 状态 / 视点 / 时间>
…（末拍收束）… the frame holds steady until the video ends at 00:0N.000.

overall_soundscape: <1–4 句>

non_diegetic_music: N/A
```

### 3.2 真实实例：段 1 `prompts/01_intro_title.txt`（曲名卡，11s，3 镜）

要点摘录（全文见源文件）：

- **第一镜**以风格串起手，随后是"极广角建立镜头 + 圆形金属平台 + 三名角色站位 + 两台机甲"的完整空间描述；
  再给运镜 `The camera pedestals up with small amplitude at slow speed`，然后才是 `At 00:02.400` / `At 00:03.400` 两个节拍。
- **第二镜**是**为 ASS 字幕预留空位**的写法（曲名卡文字由字幕轨道叠，不入画）：

  > `a medium shot of the white-haired girl at the centre, framed from the waist up against the dark sky, with her head and shoulders held in the upper two-thirds of the frame and the lower third left as an unbroken band of dark sky and smooth platform that nothing crosses`

- **第三镜**收束：`At 00:09.600, all three settle into a final stillness … and the frame holds steady until the video ends at 00:11.000.`

> **可复用套路**：凡是"要压字幕"的镜头，都在构图句里钉死"哪一块区域是空的、且**没有东西穿过**"
> （`left as an unbroken band … that nothing crosses`）。段 1 第三镜、段 17 都用这一招。

---

## 4. I2VA 模板与实例

### 4.1 骨架

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
<空一行>
integrated_multimodal_description: [Shot 1] <风格后缀> <先锚定图里的主体/外观/构图>
，再写"从该状态继续发展"：first-frame anchor → action onset → continuous development → result
… <末拍收束到 00:0N.000>

overall_soundscape: …

non_diegetic_music: N/A
```

### 4.2 真实实例：段 12 `prompts/12_inter_a.txt`（间奏 A，10s，2 镜，链式续拍）

第一行（规范原文）：

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

正文的关键句（说明"首帧被完整引用 + 延续其构图"）：

> `a medium-wide shot continues the star-field composition of <Picture 1>, preserving the three white- and blue-haired girls in ornate white-and-blue battle dress, the drawn glowing weapons they hold, the vast violet-blue nebula band across the lower sky, and the radiating pink-white petal wings flaring behind them.`

随后是 `The camera pushes in with small amplitude at slow speed`，再跟 3 个 `At 00:0X.XXX` 节拍，
`[Shot 2] At 00:05.000, the camera cuts to …`，最后 `… until the 10.00-second mark.`

> **段 12 的首帧不是参考图，是段 11 的末帧**：`82_pv_clips.mjs` 的 `CHAIN = {2:1, 3:2, 12:11, 13:12}`，
> 用 `ffmpeg -sseof -0.15` 抽上一段末帧，再 `--image` 传入。所以正文里的 `<Picture 1>` 指的就是那张 jpg。

---

## 5. FL2VA 模板与实例

### 5.1 骨架

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the S.SS-second mark of the target video.
<空一行>
integrated_multimodal_description: [Shot 1] <起点状态（Picture 1）> → <可观察的中间变化> → <差异逐步收窄> → <终点状态（Picture 2）>
```

- `S.SS` = 实际生成时长，**两位小数**；`80b` 会核对 `NN.00-second mark` 里的 `NN` 是否等于该段 `genDur`。
- FL2VA 官方**倾向单镜**（便于插值），本项目段 5 就是单镜。

### 5.2 真实实例：段 5 `prompts/05_v1_growth.txt`（11.72s → 生成 12s）

第一行：

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 12.00-second mark of the target video.
```

正文的**路径写法**（不是把两张图各描述一遍，而是写"怎么从 A 走到 B"）：

| 时间 | 原文节拍 | 作用 |
|---|---|---|
| 0.00 | `a low-key grey steel chamber opens exactly in the framing of Picture 1` | 钉住起点（`exactly in the framing`） |
| 00:02.000 | `the purple-haired woman lowers her blade and the light along its edge goes out … a thin violet line rises from the circular etching in the floor` | 可观察的变化 1 |
| 00:04.000 | `that line widens into a bright ring that sweeps outward across the floor and the steel walls begin to peel away` | 可观察的变化 2（场景解除） |
| 00:06.000 | `the whole chamber dissolves into a deep blue-violet starfield, and the three girls lift their heads` | 转折 |
| 00:08.500 | `their battle suits bloom into glowing white … pairs of luminous feathered wings unfold from their backs and spread wide` | 逼近终点 |
| 00:10.500 | `the woman at the left raises a slim curved blade … the centre girl's crystal greatsword settles point-down … the girl at the right levels the blue lance` | 逐项收窄差异 |
| 结尾 | `Toward the end the moving light slows and settles into the pose, spacing, glow and composition established by Picture 2 at the 12.00-second mark.` | **显式落点**（必须写） |

---

## 6. L2VA 模板（本项目未使用 / 未实测）

```text
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
<空一行>
integrated_multimodal_description: [Shot 1] <合理的前置状态> → <明确的动作与过渡路径> → <末镜逐步收敛> → <落在 Picture 1>
```

- `N` 是**实际最后一镜**的序号；`<Picture 1>` 天然属于 `[Shot N]`，**不属于 Shot 1**。
- **未实测**：本歌 17 段没有一段用 L2VA。首次使用时应先 `estimate` 探一次链路，别直接批量。

---

## 7. Ref2VA 六段式（本项目主力模式）

### 7.1 六个 section，顺序固定

| section | 写什么 |
|---|---|
| `subject_definitions` | 逐个定义被追踪的引用内容与标签：`<Subject N>` / `<Picture N>` / `<Video N>` / `<Audio N>`；一行一个，写明"是什么 + 参考角色 + 要跟住的特征" |
| `summary` | 一段话概述目标视频与引用关系，**以方括号任务类型起手**（本项目全部是 `[reference generation]`） |
| `retention_analysis` | 逐标签一行，用固定英文标记：`fully_preserved` / `partially_preserved` / `attribute_transfer` / `weak_reference`（音频另有一套） |
| `detailed_description` | 按播放顺序写画面、动作、镜头、声音、台词。**这是主体，要写得比三段式更细** |
| `overall_soundscape` | 同三段式 |
| `non_diegetic_music` | 本项目一律 `N/A` |

### 7.2 标签规则（项目实践）

- `<Subject N>` 是**"会被真正用进成片的内容单元"**（人 / 场景 / 服装 / 道具 / 特效 / 风格），不是源文件本身。
- 一张图只用来定义角色、场景、服装、风格时，**不要单独开 `<Picture N>` 行**，把图写进对应 `<Subject N>` 的定义里
  （如 `<Subject 1> is the girl in <Picture 1>, …`）。
- 图片**确实承担某一镜的首帧/关键帧/构图锚点**时，才单开 `<Picture N>` 行，并在 `retention_analysis` 里给一行，
  本项目写法统一为：

  ```text
  <Picture 1> (design, palette, and staging anchor): weak_reference - the image guides … only; its high downward angle and its exact lineup are not reproduced.
  ```

  > 这条 `weak_reference` 是**原创性纪律的书面承诺**：明确写出"原图的什么**不**被复现"。
  > 核验第 5 项（最大 SSIM < 0.90）就是它的量化对照，实测 0.522。
- **本项目 17 段全部只用 `<Picture 1>` + `<Subject N>`**，没有用过 `<Video N>` / `<Audio N>`（已 grep 确认）。
  参考视频/音频的用法见 `ref-en.txt`，本项目无实证。

### 7.3 真实实例：段 9 `prompts/ref2va/09_c1_lantern.txt`（7s，2 镜）

```text
subject_definitions:
<Subject 1> is the girl in <Picture 1>, a young woman with long silver-white hair tinged lavender, pale blue-violet eyes,
a small gold flower hairpin, gold flower earrings, a short teal ribbon and one long braid ending in a small gold ring ornament,
wearing a white robe with a thick white fur collar, jade-blue trim panels, and small gold flower ornaments.
<Subject 2> is the large glowing orange sky lantern in <Picture 1>, an angular paper lantern with a warm orange body
that fades toward its open mouth and a small tie at its base, held above her upturned open hands.
<Subject 3> is the night garden referenced from <Picture 1>, defined by white magnolia branches with dark twigs crowding
the upper and lower edges of the frame, a deep blue-violet starry sky with faint clouds, fine golden motes floating in the air,
and a soft dark band of foliage along the bottom.

summary:
[reference generation] The target video is a seven-second 2D anime night sequence that reuses the appearance of <Subject 1>,
the glow and shape of <Subject 2>, and the night-garden vocabulary of <Subject 3> from <Picture 1>, while generating new action,
new camera positions, and a re-staged environment. …

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - …
<Subject 2> (appears in [Shot 1], [Shot 2]): fully_preserved - …
<Subject 3> (appears in [Shot 1], [Shot 2]): partially_preserved - …

detailed_description:
The target video is a 2D anime animation frame, cel-shaded, Miyoho-style key animation, with clean line art, soft rim light,
and high-contrast cinematic lighting, and it contains no on-screen text, no watermark, no logo.
[Shot 1] The target video does not reproduce the framing of <Picture 1>: …
```

**可复用的三句式**（`detailed_description` 起手）：

1. 风格 + 负面清单句（见 §12）；
2. `The target video does not reproduce the framing of <Picture 1>: …` ——**先声明不复刻构图**；
3. 再写新生成的镜头，主体用 `<Subject N>, the girl …,` 的同位语形式复述一遍外观（把定义"接"回画面）。

### 7.4 `retention_analysis` 措辞清单（固定英文，不要自造）

| 可见内容标记 | 含义 | 音频标记 | 含义 |
|---|---|---|---|
| `fully_preserved` | 定义的角色被完整保留 | `fully_copy` | 整段源音频原样成为成片音轨 |
| `partially_preserved` | 仍在用，但部分特征改变或只保留一部分 | `partially_copy` | 只复制部分时间轴/音层，或复制后又增删 |
| `attribute_transfer` | 参考特征被转移到另一个可识别主体上 | `reference` | 不复制信号，只参考音色/节奏/风格/内容 |
| `weak_reference` | 只保留风格、类别、构图或氛围的宽泛相似 | `weak_reference` | 只保留类别或氛围的宽泛相似 |

> 本项目只用可见内容的四个标记（音频无参考）。

---

## 8. 硬约束（写错就报 `2013 invalid params`）

| 约束 | 值 | 本项目实测 |
|---|---|---|
| **单条 prompt 字符上限** | **7000 字符**（API 硬顶） | 三段式 **1987–3230**；Ref2VA 六段式 **4114–6649**。全部有余量 |
| 时长 | H3 `4–15s`；H3-Max `5–15s` | 本项目逐段 6–13s，取整后 10 段为奇数秒 |
| 分辨率 | H3 `768P` / `2K`；H3-Max `480P` / `768P` | 全片 768P（1344×768），单价 ¥0.50/s |
| ratio | T2VA **必须显式给**且不能 `adaptive`；I2VA 恒 `adaptive`；Ref2VA 默认 `adaptive` | 本项目 T2VA/Ref2VA 均显式传 `--ratio 16:9` |
| 台词标记 | `<d>[Chinese] …</d>` | **本项目一律不用**（人声来自母版）→ `80b` 见到 `<d>` 直接判不合格 |
| 参考图数量 | ≤9 张（≤30MB/张、边长 256–5760） | 本歌最多 2 张（段 5） |
| 参考视频/音频 | ≤3 个（单段 2–15s，合计 ≤15s） | 未使用 |
| 首帧图 vs 参考图 | **互斥**（同给 `first_frame` 与 `reference_*` 会被拒） | 见 §9 |
| 时间轴 | 描述总长必须等于 `--duration`；节拍用 `At MM:SS.mmm` | `80b` 校验"时间码 < genDur"且"至少 1 个节拍" |
| 状态枚举 | 全小写 `queued/running/succeeded/failed/cancelled` | — |
| 素材保留 | 任务与上传素材**只留 7 天** | — |

---

## 9. 参考图与首帧图互斥：怎么同时要"像"和"连"

### 9.1 铁律

同一段**不能**既给首帧图又给参考图。所以想要"参考形象的连续性"，只有两条路：

| 需求 | 做法 |
|---|---|
| 要**参考**（形象/画风来自 CG） | 该段用 **Ref2VA**（`--ref-image`） |
| 要**连续**（接着上一段的画面走） | 该段用 **I2VA**，首帧 = 上一段**实际末帧**（`--image`） |
| 两者都要 | **首镜 Ref2VA + 后续用上一段末帧续拍** |

### 9.2 本歌的真实编排（`82_pv_clips.mjs`）

```js
const REFMAP = {
  1: ['ref_10th.jpg'],
  4: ['ref_德丽莎2022生日.jpg'],
  5: ['ref_星海绘卷.jpg', 'ref_然后向着明天.jpg'],
  6: ['ref_ElysianRealm.jpg'], 7: ['ref_薪火传承.jpg'], 8: ['ref_星海绘卷.jpg'],
  9: ['ref_屏幕截图(115).jpg'], 10: ['ref_屏幕截图(163).jpg'], 11: ['ref_然后向着明天.jpg'],
  14: ['ref_月下1.jpg'], 15: ['ref_月下3.jpg'], 16: ['ref_星海绘卷.jpg'], 17: ['ref_然后向着明天.jpg'],
}
const CHAIN = { 2: 1, 3: 2, 12: 11, 13: 12 }   // 该段首帧 ← 前一段末帧
```

- 段 **1 → 2 → 3**：段 1 用参考图（Ref2VA），段 2 取段 1 末帧（I2VA），段 3 取段 2 末帧（I2VA）。
  核验里 **1→2 = 0.866、2→3 = 0.929**，这就是"三镜必须连续"的量化证据。
- 段 **11 → 12 → 13**：段 11 用参考图，段 12 / 13 依次续拍，**0.788 / 0.885**。
- 段 **5** 的 A→B 转化（星海绘卷 → 然后向着明天）**没有用 FL2VA**，因为图生视频与参考图驱动互斥；
  改用**双参考图 + 时序描述**实现（见 §5.2）。这是 `00_docs/05_PV制作流水线.md` §8.3 记录的取舍。
- 链式段**必须串行**：`82_pv_clips.mjs` 把独立段按 `--wave 6` 并行提交，链式段等前一段下载完再补交。

---

## 10. `<Subject N>` 编号：跨段一致怎么做

### 10.1 事实：每一次 API 调用是独立的

H3 单次调用没有跨轮记忆。`subject_definitions` 的作用域**只在这一条 prompt 内**，
所以**编号必须在该 prompt 的六个 section 里保持一致**（这是规范原文的硬要求），
但**不存在"全片全局的 `<Subject 3>`"**。

### 10.2 实践纪律（本项目已验证的两条）

1. **同一张参考图驱动的段落，编号与顺序保持一致。**
   实证：段 8 与段 16 都用 `ref_星海绘卷.jpg`，两段的定义完全同序 ——
   `<Subject 1>` 紫发女子（左）、`<Subject 2>` 白发少女（中）、`<Subject 3>` 银发少女（右）、
   `<Subject 4>` 两台机甲、`<Subject 5>` 深灰石台。
   （反例：段 11 与段 17 同用 `ref_然后向着明天.jpg`，编号顺序就不同 —— 说明这是**约定不是机制**，
   靠人守，别指望模型帮你对齐。）
2. **同一主体在不同段的外观描述不得漂移**：机甲数量、翼形、武器归属、发色瞳色这类"硬事实"，
   必须回看原图逐项核对。`00_docs/05_PV制作流水线.md` §5 明确说这是"并行撰写最容易翻车的地方，
   靠**独立评审 agent 回看原图**抓出来"。

> ⚠️ **本歌真实存在的一处口径差异（照实记录，不要当成范例）**：段 9 与段 10 在计划里是
> "同一夜的第二个机位"，但最终 `ref2va/09`（源自 `屏幕截图(115)`）与 `ref2va/10`（源自 `屏幕截图(163)`）
> 对少女的**服装描述不同**（白色毛领长袍 vs 藏青中式裙）。原因是两段实际用了不同 CG。
> **教训**：写"第二机位"类段落前，先确认两张 CG 里的人物是不是同一套造型；不是就改文案，别硬写"the same girl"。

---

## 11. 运镜写法

### 11.1 必须写全「类型 + 幅度 + 速度」

| 维度 | 可选表达 |
|---|---|
| 类型 | `Zoom In/Out`、`Push In/Pull Out`、`Pan Left/Right`、`Truck Left/Right`、`Tilt Up/Down`、`Pedestal Up/Down`、`Arc Shot`、`Tracking Shot`、`Static Shot`、`Shake Slightly/Strongly`、`POV`、`Roll Clockwise/Counterclockwise` |
| 幅度 | `with small amplitude` / `with large amplitude` |
| 速度 | `at slow speed` / `at fast speed` |

官方说"幅度与速度只在有意义时才写"；**本项目纪律更严：每处运镜都写全三维**
（`80b` 虽不逐句校验，但这是全片节奏一致的前提）。

### 11.2 正例（本歌真实句子）

```text
The camera pushes in with small amplitude at slow speed.
The camera tilts up with large amplitude at slow speed, leaving the silhouettes behind and following the rising petals into the dark upper sky.
The camera pedestals up with small amplitude at slow speed, lifting the horizon line as thin clouds slide across the lower half of the frame.
The camera dollies in with small amplitude at slow speed and lifts slightly as she approaches.
The camera cranes up with small amplitude at slow speed, lifting past the balustrade.
```

写法要点：**把运镜写成镜头内的自然动作**，而不是句末堆标签。`dollies in` / `cranes up` 是本歌的实际用词，
与官方词表里的 `Push In` / `Pedestal Up` 同义，可混用但**同一段内保持一致**。

### 11.3 反例

| 反例 | 为什么不行 |
|---|---|
| `cinematic camera movement` / `the camera moves dramatically` | 没有类型/幅度/速度，模型只能自由发挥 |
| `运镜流畅，缓缓推进` | prompt 用英文写（台词与画面文字才保留原语言） |
| `The camera pushes in.` | 本项目要求三维写全，缺幅度与速度 |
| 只写运镜不写节拍 | 会退化成"整个镜头匀速推"，见下 |

> **本歌实测教训**（`00_docs/04_MiniMax-H3视频生成工作流.md` §3.4）：
> 首次试片的 prompt 写了"抬灯"，但**没写成带时序的节拍**，结果 2.5s 与 4.5s 两帧差异极小 ——
> 模型只做了缓慢推镜。**改进三招**：
> 1. 把动作拆成带时序的节拍：`At 00:01.200 she lowers her chin… At 00:02.800 she raises the lantern to eye level…`
> 2. 加**可观察的结果**（能落到像素上的描述）：如"火焰在她瞳孔里的倒影变大"；
> 3. 若必须保证某个动作，用**首帧/尾帧图把两端钉死**（FL2VA），让模型只能走中间路径。

---

## 12. 风格后缀：`video.promptStyleSuffix`

### 12.1 配置里的原文（`翻填项目.json`）

```json
"promptStyleSuffix": "2D anime animation frame, cel-shaded, Miyoho-style key animation, clean line art, soft rim light, high-contrast cinematic lighting, no on-screen text, no watermark, no logo, no signature, cinematic 16:9 composition"
```

`plan/keyframes.json` 的 `styleSuffix` 与之一致。`80b_check_prompts.mjs` 只校验它的**前 3 项**：

```js
const STYLE_KEY = '2D anime animation frame, cel-shaded, Miyoho-style key animation'
```

> **照实说明**：本歌 17 份 prompt 实际只带了后缀的**前 10 项**
> （到 `no on-screen text, no watermark, no logo,` 为止，**没有** `no signature, cinematic 16:9 composition`）。
> 因为 `80b` 只查前 3 项，所以当时全绿。
> **新歌请带全**，或把配置后缀与实际用法对齐后再冻结 —— 不要让"配置写的"和"实际写的"长期分叉。

**分叉的准确边界（2026-09-28 逐文件复核）**：

| 文件 | 实际带的后缀 | 复核方式 |
|---|---|---|
| **28 份手写 prompt**（17 份 `prompts\NN_slug.txt` + 11 份 `prompts\ref2va\NN_slug.txt`） | 只到 `no on-screen text, no watermark, no logo.` —— **负面清单到此为止** | 28 份全文检索，`no signature` 命中 **0** 次 |
| 17 份**骨架**（`prompts\NN_slug.skeleton.txt`） | **完整后缀**，含 `no signature, cinematic 16:9 composition` | 骨架由 `80_pv_shotlist.mjs`（`fsp.writeFile(...skeleton.txt)`）生成，直接读配置的 `promptStyleSuffix` |

> 也就是说：**骨架已经是对的，是人手补写时把尾巴截掉了**。
> 补写纪律：**从骨架复制整串后缀，不要重打一遍**。`80b` 只查前 3 项，截短了它不会报错。

### 12.2 为什么每段都必须带

1. **H3 无跨调用记忆**：不带后缀，第 9 段和第 16 段就会各画各的画风。
2. **后缀里内含负面清单**：`no on-screen text, no watermark, no logo` 就是"**禁止画面出现任何文字**"这条项目铁律的**实现方式**——
   靠自然语言声明，不是靠后处理。
3. **它是自检锚点**：`80b` 用 `STYLE_KEY` 反查"这段是不是漏了统一前缀"。

### 12.3 项目铁律：禁止画面出现任何文字

- 不允许出现字幕、招牌、霓虹、条幅、书页文字、UI 文字、水印、logo、签名。
- 曲名/信息卡/署名**全部由 ASS 字幕轨道叠加**（`83_pv_subs.mjs`），**不交给 H3 画**。
- `80b` 还会抓描述里的 `subtitle|signboard|neon sign|caption` 等词 —— 连"提到"都不许。

---

## 13. `image-01` 与 H3 的分工

### 13.1 结论

> **参考图路线一律走 H3 Ref2VA。`image-01` 不要用于"二创关键帧"。**

### 13.2 依据（2026-09-27 四次真实调用，全部有据）

| 试过的取值形态 | 服务端返回 |
|---|---|
| `subject_reference: "<dataURL>"`（字符串） | `status_code=2013 invalid params` |
| `subject_reference: {type:'character', image:<dataURL>}`（裸对象） | `invalid params` |
| `subject_reference: [{type:'character', image:<dataURL>}]`（数组，**形态正确**） | `status_code=1000 disallowed image url: localhost or private address not allowed` |
| 同上，`image` 换成 `mm_file://<file_id>` / 裸 `file_id` | 同样 `1000 disallowed image url` |

→ **`subject_reference[].image` 只接受公网可访问的 http(s) URL**。本机没有图床，这条路走不通。
（排查心得：`aspect_ratio` 校验发生在参考图解析**之前**，所以拿"故意传错 ratio"当判别器会得到大量**假阳性**——
必须用合法参数真实调用才能判定。）

### 13.3 两条路线的取舍对照

| | `image-01` 关键帧路线（**废弃**） | H3 原生参考路线（**采用**） |
|---|---|---|
| 原图用法 | 只作 `subject_reference` 风格/角色参考 | 只作 `reference_image` 风格/角色参考 |
| 是否把原图画进成片 | 否 | 否（SSIM 实测 0.522，远低于 0.90 红线） |
| 构图可控性 | 高（可先定关键帧） | 低（构图由模型决定） |
| 成本 | 多一层图像费用 | **0 额外成本** |
| 首帧连续性 | 可用关键帧钉死 | 用链式续拍（上一段末帧 → 下一段首帧）或参考图 |

> **若日后有了公网图床**，可以回到 `image-01` + FL2VA 路线；届时 §5 的 FL2VA 模板才真正派上用场。

---

## 14. 文件落点与骨架模板

| 模式 | 落点 | 谁生成 |
|---|---|---|
| T2VA / I2VA / FL2VA | `<promptDir>/NN_slug.txt`（`NN` 两位、`slug` 与 `segments.json` 一致） | `80_pv_shotlist.mjs` 出 `.skeleton.txt`，人/AI 补写 |
| Ref2VA | `<promptDir>/ref2va/NN_slug.txt` | 同上（骨架 + 六段式改写） |

本歌实况（`10_h3video/pv/prompts/`）：17 份 `NN_slug.skeleton.txt` + 17 份 `NN_slug.txt`，
外加 11 份 `ref2va/NN_slug.txt`（段 1 / 4 / 6 / 8 / 9 / 10 / 11 / 14 / 15 / 16 / 17）。

**`82_pv_clips.mjs` 的选文件规则（决定哪一份真被用）**：

```js
function promptPathFor(s) {
  const ref = path.join(PV, 'prompts', 'ref2va', `${String(s.idx).padStart(2,'0')}_${s.slug}.txt`)
  if (fs.existsSync(ref)) return { file: ref, kind: 'ref2va' }   // 有 ref2va 版就优先用
  return { file: path.join(PV, 'prompts', `${String(s.idx).padStart(2,'0')}_${s.slug}.txt`), kind: 'base' }
}
```

> **纪律**：`ref2va/` 里存在同名文件 = **该段的实际 prompt**。两者并存时，`prompts/NN_slug.txt` 只是旧版，
> 改 prompt 前先确认该段走的是哪一份，别改错文件。

#### 14.1 本歌 17 段总表（照抄用；数据来自 `segments.json` + `cost_log.csv` + `REFMAP`/`CHAIN`）

| 段 | slug | 计划 `mode` | 参考图（`REFMAP`） | 链式首帧（`CHAIN`） | 生成秒 | **实际用的文件** | 最终 `task_id` |
|---|---|---|---|---|---|---|---|
| 01 | `intro_title` | T2VA | `ref_10th.jpg` | — | 11 | `ref2va/01_intro_title.txt` | 446340896858535 |
| 02 | `intro_origin` | T2VA | — | ← 段 1 末帧 | 11 | `02_intro_origin.txt` | 446340050055483 |
| 03 | `intro_credits` | T2VA | — | ← 段 2 末帧 | 11 | `03_intro_credits.txt` | 446344546615696 |
| 04 | `v1_story` | I2VA | `ref_德丽莎2022生日.jpg` | — | 12 | `ref2va/04_v1_story.txt` | 446324989968819 |
| 05 | `v1_growth` | FL2VA | `ref_星海绘卷.jpg` + `ref_然后向着明天.jpg` | — | 12 | `05_v1_growth.txt` | （试片轮，未记入 `cost_log`） |
| 06 | `v1_miss` | I2VA | `ref_ElysianRealm.jpg` | — | 12 | `ref2va/06_v1_miss.txt` | 446343537967363 |
| 07 | `v1_xinyan` | I2VA | `ref_薪火传承.jpg` | — | 6 | `07_v1_xinyan.txt` | （试片轮，未记入 `cost_log`） |
| 08 | `c1_bloom` | I2VA | `ref_星海绘卷.jpg` | — | 13 | `ref2va/08_c1_bloom.txt` | 446330026357021 |
| 09 | `c1_lantern` | I2VA | `ref_屏幕截图(115).jpg` | — | 7 | `ref2va/09_c1_lantern.txt` | 446327265423749 |
| 10 | `c1_heart` | I2VA | `ref_屏幕截图(163).jpg` | — | 7 | `ref2va/10_c1_heart.txt` | 446324475126205 |
| 11 | `bridge_wake` | I2VA | `ref_然后向着明天.jpg` | — | 11 | `ref2va/11_bridge_wake.txt` | 446326440833294 |
| 12 | `inter_a` | I2VA | — | ← 段 11 末帧 | 10 | `12_inter_a.txt` | 446328154558867 |
| 13 | `inter_b` | I2VA | — | ← 段 12 末帧 | 10 | `13_inter_b.txt` | 446329726001411 |
| 14 | `c2_moon` | I2VA | `ref_月下1.jpg` | — | 10 | `ref2va/14_c2_moon.txt` | 446327021572488 |
| 15 | `c2_thanks` | I2VA | `ref_月下3.jpg` | — | 13 | `ref2va/15_c2_thanks.txt` | 446324251660715 |
| 16 | `out_replay` | I2VA | `ref_星海绘卷.jpg` | — | 11 | `ref2va/16_out_replay.txt` | 446327299236226 |
| 17 | `out_credits` | I2VA | `ref_然后向着明天.jpg` | — | 7 | `ref2va/17_out_credits.txt` | 446327106429195 |

**看这张表要注意三件事**：

1. **`计划 mode` 与"实际用的文件"经常对不上**：`segments.json` 的 `mode` 是分镜设计时的口径
   （段 4/6/8/9/10/11/14/15/16/17 都标 `I2VA`），但只要有 `ref2va/` 版就会被优先选用。
   **唯一权威是 `82_pv_clips.mjs` 实际选中的文件**，不是 `mode` 字段。
2. **段 1 / 2 / 3 出过两轮**：首轮三段都是 `base`（`cost_log.csv` 第 1–3 行），
   用户要求"三镜必须连续"后，段 1 改走 `ref2va/01`（参考 `10th.jpg`）、段 2/3 仍用 `base` 文本续拍 ——
   所以表里的 `task_id` 是**第二轮**的（`15:50:09` 那批），不是首轮的。
3. **`cost_log.csv` 缺一条**：`_进度/成本台账.csv` 记了 `17:00 重出段13 ¥6.50`，
   但 `plan/cost_log.csv` 最后一行是 `15:50:09`，**没有这条**。对账时以 `成本台账.csv` 为准。

**骨架模板长什么样**（`prompts/12_inter_a.skeleton.txt` 全文，2026-09-28 复核，15 行）：

```text
# 段 12 · inter_a  （01:47.250–01:57.250，10s → 生成 10s）
# 模式：I2VA｜素材：(上一段末帧)｜接点：cut
# 参考图：（无）｜链式首帧 ← 段 11 末帧
# 歌词：（无歌词：前奏/间奏/尾奏）
# 说明：间奏 A（链式衔接）
#
# 要求：英文书写；三段式；禁止 <d> 对白；禁止画面出现任何文字；
#       时间轴总长必须等于 10 秒；运镜写全「类型+幅度+速度」；
#       提示词总长 ≤ 7000 字符（H3 硬顶）。

integrated_multimodal_description: [Shot 1] 2D anime animation frame, cel-shaded, Miyoho-style key animation, clean line art, soft rim light, high-contrast cinematic lighting, no on-screen text, no watermark, no logo, no signature, cinematic 16:9 composition, <待撰写：构图 → 主体与动作（带时序节拍）→ 运镜>

overall_soundscape: <待撰写：1–4 句环境音/动作音>

non_diegetic_music: N/A
```

骨架头部把**九件事**写死了：段号 / 时间区间 / 实际段长 → 生成秒数 / 模式 / 素材 / **参考图（含链式来源）** /
接点 / 歌词 / 说明；"要求"段再钉三条硬约束（三段式、`7000 字符`、运镜三维）。
**补写时先看这几行**，尤其：

1. **"生成 N 秒"** —— 时间轴总长必须等于它，`80b` 会核对时间码是否越过这个数；
2. **"参考图"** —— 决定这段该写成三段式还是六段式 Ref2VA；
3. **`模式` 字段只是"计划口径"**，不等于实际写法（见 §9.2 与 §14 的选文件规则）。

> **骨架会被 `80_pv_shotlist.mjs` 整体重写**（`fsp.writeFile(... NN_slug.skeleton.txt)`）——
> 所以**不要在骨架上做手改**，改了下次跑 80 就被覆盖；要长期生效的约束写进配置或写进 `80_pv_shotlist.mjs`。
> 引用骨架内容前先重新读一遍文件（2026-09-28 本工作区的骨架刚被整批重生成过一次）。

---

## 15. 自检：`80b_check_prompts.mjs` 到底检什么

```powershell
node scripts\80b_check_prompts.mjs
```

逐份检查 `<promptDir>/*.txt`（**注意：只扫 `prompts/`，不扫 `prompts/ref2va/`**），8 类问题：

| # | 检查项 | 判定 |
|---|---|---|
| 1 | **三段式字段齐全** | `integrated_multimodal_description:` / `overall_soundscape:` / `non_diegetic_music:` 三个行首字段都要有 |
| 2 | `non_diegetic_music` **必须是纯 `N/A`** | 正则 `^N/A\s*$`，多写一个字都不行 |
| 3 | **禁止对白** | 出现 `<d>` / `</d>` / `<d ` 即不合格 |
| 4 | **禁止画面文字** | 必须**显式**写 `no on-screen text`，以及 `no watermark` 或 `no logo`；描述里出现 `subtitle/signboard/neon sign/caption` 也判不合格 |
| 5 | **统一风格前缀** | 正文必须包含 `2D anime animation frame, cel-shaded, Miyoho-style key animation` |
| 6 | **首行对齐指令按模式区分** | I2VA 必须逐字匹配规范句（含 `[Shot 1]`）；FL2VA 必须以 `How the reference pictures align with the target video —` 开头、**不得含 `[Shot`**、且 `NN.00-second mark` 里要出现该段 `genDur`；T2VA 首行必须是 `integrated_multimodal_description:` |
| 7 | **时间码不超时** | 所有 `At MM:SS.mmm` 必须 `< genDur`；且**至少要有一个**节拍 |
| 8 | **收束到片尾** | 必须出现 `holds until` / `video ends at 00:0N.000` / `NN.00-second` 之一 |

退出码非 0 = 有不合格文件，脚本会逐条打印问题原因。

### 15.1 已知缺口（照实说明，别误以为"全绿=万事大吉"）

| 缺口 | 说明 | 补救 |
|---|---|---|
| **不检字符数** | 7000 上限**不在** 80b 的检查里 | 自行统计（见下） |
| **不扫 Ref2VA** | `prompts/ref2va/*.txt` 完全不检查；但本歌 11 段实际用的是它 | 人工核对六个 section 名齐全 + 字符数 + `N/A` + 负面清单 |
| **不检运镜三维** | 无法用正则可靠判断 | 抽查 + 独立评审 |

字符数统计（PowerShell，注意**按字符数不是字节数**）：

```powershell
Get-ChildItem 10_h3video\pv\prompts -Recurse -Filter *.txt |
  Where-Object { $_.Name -notlike '*.skeleton.txt' } |
  ForEach-Object { '{0,-40} {1,5} chars' -f $_.FullName.Replace($PWD.Path + '\',''), ([System.IO.File]::ReadAllText($_.FullName).Length) }
```

### 15.2 出片前的完整顺序

```powershell
node scripts\80_pv_shotlist.mjs         # 1. 生成分镜 + 骨架 + 对齐预检
# …补写 prompts\NN_slug.txt 与 prompts\ref2va\NN_slug.txt…
node scripts\80b_check_prompts.mjs      # 2. 合规自检（必须全绿）
node scripts\81_pv_refs.mjs             # 3. 参考图去水印 + 缩放
node scripts\82_pv_clips.mjs --plan     # 4. 只打印计划与预算，不发请求
node scripts\82_pv_clips.mjs --max-cost 78   # 5. 实跑（唯一花钱的一步）
```

---

## 16. 留白与未实测（宁可不写，不要编）

1. **L2VA 未实测**：本歌 17 段没有一段使用；§6 的模板来自官方 `base-en.txt`，未经本项目验证。
2. **Ref2VA 的 `<Video N>` / `<Audio N>` 未实测**：本歌只用 `<Picture 1>` + `<Subject N>`。
3. **多镜 FL2VA 未实测**：段 5 是单镜；官方说 FL2VA 倾向单镜，多镜行为未知。
4. **`image-01` 的真实可用性未验证**：只验证了"本机无法提供公网 URL"，没验证"有公网 URL 时效果如何"。
5. **风格后缀的完整版（含 `no signature, cinematic 16:9 composition`）未在真实出片中用过**。
6. **`--wave` 并发上限实践值**：脚本默认 `--wave 6`，本歌实际按此跑通；H3 官方允许 30 并发，本项目未压测到上限。
