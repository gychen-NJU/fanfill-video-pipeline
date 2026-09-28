# Release notes — v2.0.0

**Workbench: read-only panel → guided pipeline.** / **工作台：只读面板 → 引导式流水线。**

---

## English

### What changed

`ui-workbench/` is now a guided workbench instead of a status viewer.

| Before (v1.0.0) | Now (v2.0.0) |
|---|---|
| Right-sidebar panel with five read-only tabs | Same slot, but the primary tab is a **seven-stage guide**: goal, gate, what to hand over, how, who runs it, artefacts, sub-steps |
| Assets listed per role | **Material slots you can fill in**: upload a file, upload a folder, or point at a file already in the workspace — the host writes it to the slot's directory and updates the matching key in your project config (backup + sha256 lock, never overwrite) |
| Nothing could be executed | **Whitelisted local actions** with live logs and cancel (`--plan` previews, read-only checks, config self-test, environment probe) |
| — | **One-click hand-off**: a stage's self-contained prompt is sent into the *current chat session*, so the agent executes it with full context. A bottom dock lets you talk to that session freely |
| Single-file host half | Host half is a small package (`index.js` + `lib/{spec,state,writes,jobs}.mjs` + `pipeline.default.json`) |
| One song per install | **New-song wizard**: pick a parent directory → the skeleton, generic PV scripts, skill, config, progress doc and an empty per-song override are created; songs are switchable from the header |

### Design decisions worth knowing

- **The pipeline is data.** General stages live in `ui-workbench/pipeline.default.json`; per-song tweaks go in
  `<song workspace>/工作台流水线.json`. Editing the override needs only a page refresh.
- **The host refuses to spend money.** `kind: paid` / `costCny > 0` actions are rejected with 403; the panel can only
  hand them to the agent with a prompt that demands a cost estimate first.
- **Per-song override files are executable content.** Actions declared there are marked *untrusted*: they always ask
  for confirmation, their interpreter must live inside the song workspace or be listed in `allowedInterpreters`, and
  `argv` may not escape. Do not trust a song directory that came from someone else without reading that file.
- **No machine-specific paths in the shipped code.** ffmpeg, venvs, ASCII junctions, template root, browse roots and
  the interpreter allow-list all come from the plugin's config block (see `INSTALL.md` §2).

### New API surface (host half, single prefix route)

`/fantian-workbench/v1`: `ping`, `snapshot`, `ls`, `upload`, `link`, `config`, `state`, `songs`, `run`, `job`,
`job/cancel`, `reveal`. Mutation endpoints require the custom header `x-fantian: 1`; no CORS, no OPTIONS.

### Compatibility

The `/snapshot` contract is **additive**: every v1 field keeps its meaning, so existing consumers (including this
repo's `tools/smoke-test.mjs`, 13 assertions) still pass unchanged. v1 source is archived by the author, and a
one-command rollback script exists locally.

### Verification (what is actually proven)

- Host half: **118** headless assertions (uploads, traversal including junctions, optimistic lock, paid-action
  refusal, job tree-kill, concurrency cap, v1 contract regression, adversarial regressions).
- Client half: **30** headless render assertions (six tabs, hand-off really reaches the session interface,
  untrusted actions force the confirm dialog).
- `tools/smoke-test.mjs` **13/13**; `tools/gensong-test.mjs` passes (a deliberately different synthetic song runs the
  shot-list stage with zero errors).
- An **independent adversarial review** (2 high / 4 medium / 10 low findings) — all fixed, each pinned by a regression
  assertion; the report ships in the authoring workspace, not this repo.
- The v2 panel was then exercised **in a real browser, end to end** (0 console errors): six tabs of live project data,
  a whitelisted local action run from the panel, a stage handed to the agent inside a newly created session, the
  new-song wizard creating a real skeleton, and a material submitted through the panel (file on disk, config written
  back behind a backup, checklist advanced). It also degrades gracefully when the host half is older.
  **Not** verified: the panel's *light* theme (the reference machine's appearance is owned by a skin plugin, which
  blocked the light variant) and uploading more than ~50 MB through the panel.

### Upgrading from v1.0.0

1. Replace `ui-workbench/` (it is now multi-file — copy the whole directory).
2. Extend the profile-patch row's `config` block with the optional keys you need (`templateRoot`, `ffmpegDir`,
   `venvsRoot`, `junctions`, `browseRoots`, `allowedInterpreters`, `maxUploadMb`).
3. **Restart `dsh web`** — the host half is loaded at startup. Client-only changes afterwards need just a refresh.

---

## 中文

### 改了什么

`ui-workbench/` 从"状态查看器"变成**引导式工作台**。

| v1.0.0（之前） | v2.0.0（现在） |
|---|---|
| 右侧栏五个只读页签 | 同一个插槽，但主页面是**七阶段引导**：目标 / 验收门槛 / 要你交什么 / 怎么做 / 谁做 / 产物 / 子步骤 |
| 素材按角色平铺 | **可按"素材槽"交东西**：上传文件、传文件夹，或指向工作区里已有的文件——宿主落到该槽目录并回写项目配置对应键（先备份 + sha256 乐观锁，绝不覆盖） |
| 什么都不能执行 | **白名单本机动作**，带实时日志与中止（`--plan` 预览、只读校验、配置自检、环境探活） |
| —— | **一键派单**：把该阶段的自包含提示词发进**当前会话**，智能体带着上下文执行；底部 dock 可随时和它对话 |
| 宿主半边单文件 | 宿主半边是一个小包（`index.js` + `lib/{spec,state,writes,jobs}.mjs` + `pipeline.default.json`） |
| 一份装一首歌 | **新建歌向导**：选父目录 → 建出骨架、通用 PV 脚本、技能、配置、进度文档与一份空的覆盖骨架；顶部可切歌 |

### 值得知道的设计决定

- **流水线是数据**：通用阶段在 `ui-workbench/pipeline.default.json`，本歌微调在 `<歌曲工作区>/工作台流水线.json`；
  改覆盖文件**刷新页面即生效**。
- **宿主拒绝花钱**：`kind: paid` / `costCny > 0` 一律 403；面板只能把它派给智能体，且提示词里强制要求先报价。
- **本歌覆盖文件等于可执行内容**：来自它的动作标 `untrusted`——每次都要二次确认，解释器必须在工作区内或写进
  `allowedInterpreters`，`argv` 不许越界。**别把别人给的工作区目录连同这个文件一起信任。**
- **代码里零机器专属路径**：ffmpeg、venv、ASCII junction、模板根、可浏览目录、解释器白名单全部来自插件 config 块
  （见 `INSTALL.md` §2）。

### 新增接口（宿主半边，单条 prefix 路由）

`/fantian-workbench/v1`：`ping`、`snapshot`、`ls`、`upload`、`link`、`config`、`state`、`songs`、`run`、`job`、
`job/cancel`、`reveal`。变更类端点要自定义头 `x-fantian: 1`；不发 CORS、不实现 OPTIONS。

### 兼容性

`/snapshot` 契约**只增不改**：v1 的每个字段含义不变，所以既有消费者（包括本仓库的 `tools/smoke-test.mjs` 13 条
断言）原样通过。v1 源码由作者另行归档，本机另有一键回滚脚本。

### 验证（到底证明了什么）

- 宿主半边：**118** 条无头断言（上传、穿越含 junction、乐观锁、付费拒绝、作业树杀、并发上限、v1 契约回归、对抗性回归）；
- 客户端半边：**30** 条无头渲染断言（六个页签、派单真的进了会话接口、未受信动作强制确认）；
- `tools/smoke-test.mjs` **13/13**；`tools/gensong-test.mjs` 通过（参数刻意不同的合成曲目跑通分镜阶段、零报错）；
- 一轮**独立对抗性核验**（2 高危 / 4 中危 / 10 低危）全部修复并钉成回归断言（报告留在作者工作区，不入本仓库）；
- v2 面板随后在**真实浏览器里端到端验过**（console 错误 0 条）：6 个页签实时数据、从面板跑白名单本机动作、
  在新建会话里把某阶段派给智能体、新建歌向导建出真骨架、从面板交素材（落盘 + 备份后回写配置 + 清单推进）；
  宿主旧版时也能优雅降级。**未验**：面板的**亮色**主题（参考机器外观被皮肤插件接管，切不到）与通过面板上传 >50 MB 的素材。

### 从 v1.0.0 升级

1. 替换 `ui-workbench/`（现在是多文件包，要整目录复制）；
2. 给 profile 补丁的 `config` 块补上你需要的可选键（`templateRoot`/`ffmpegDir`/`venvsRoot`/`junctions`/
   `browseRoots`/`allowedInterpreters`/`maxUploadMb`）；
3. **重启 `dsh web`**——宿主半边是启动时加载的；之后只改客户端半边刷新页面即可。
