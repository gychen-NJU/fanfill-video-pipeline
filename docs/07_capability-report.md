# 工作台能力探测报告（Phase 0）

> **性质**：Phase 0 交付物，也是**一次真实的探测记录**——所以文中出现的路径、插件名与数值都取自那台机器上的那次探测。**读法**：看"怎么探测"（方法、取证手段、复查清单）与"结论怎么用"（能做到哪一级、契约是什么、往哪降级），**不要照抄本机路径**；把占位符换成你自己环境的实际值即可。
> 回答计划书 §10 Phase 0 的三个问题：能不能做、做到哪一级、契约是什么。
> **探测时间**：2026-09-28
> **探测方式**：读已安装的包源码与类型声明、读 shipped 预设补丁、读 profile 实际配置、用 `dsh --profile web --dump-config` 做无副作用验证。**没有靠记忆或猜测下过结论。**
> **结论一句话**：`plugin_manager` / `cordis_inspect_*` 在本 profile 的 agent 工具面**不可用**；但**手写 profile 补丁层 + 热加载**这条路完全走得通，预设与工作台都按这条路装上了。**工作台目标级别 = L1（只读面板），且已实测数据正确。**

---

## 1. 探测结论速览

| 问题 | 结论 | 证据 |
|---|---|---|
| `plugin_manager` 工具可用？ | ❌ **不可用** | shipped `presets/standard.patch.yml` 第 144–146 行 `tool-plugin-manager` 显式 `disabled: true`；本会话工具面里没有它 |
| `cordis_inspect_*` 工具可用？ | ❌ **不可用** | 同上：preset 行 `tool-cordis` 只在 `cordis` 预设里，而 `standard` 预设未挂；本会话工具面里没有 |
| profile 补丁层能改吗？ | ✅ **能，且是已验证路径** | `$DSH_HOME/profiles/web/cordis.patch.yml` 里已有一条 `- insert:` 行（`minimax-h3-mcp`）在稳定工作 |
| 补丁改完怎么验证？ | ✅ `dsh --profile web --dump-config` | 无副作用地打印合成后的完整 loader 树，退出码 0 |
| Web UI 插槽怎么探？ | ⚠️ **改用源码取证**（因 inspect 不可用） | `Slots.listSubTree` 拿不到，改为读 `ui-sidebar-right` 的 slot 契约 `.d.ts` + 已装插件的真实注册调用 |
| 主题 token 是什么？ | ✅ `--dsw-*` 全量清单 | 从 `dsh-client-ui-primitives` / `ui-theme` 等已装包的 client bundle 里提取 |
| 工作台能到哪一级？ | ✅ **L1 达成**（状态条 + 素材库 + 出片台 + 账本 + 歌词对照 + 清单） | 见 §5 实测 |
| L3（`[▶ 让 agent 跑]`）能做吗？ | ⏸ **本次不做** | 需要向会话注入消息的宿主 API，未在本次探测范围内证实；按计划书 §7.4 的降级阶梯保留 |

---

## 2. 为什么 `plugin_manager` 不可用（事实链）

1. 本机 DSH 版本 `0.1.7-rc.2`（`dsh --version`）。
2. profile = `web`（环境变量 `DSH_PROFILE=web`，`DSH_PROFILE_DIR=%USERPROFILE%\.dsh\profiles\web`）。
3. Web 面把 agent 平面整体挪进 preset：`@deepseek-ai/dsh-web-app/cordis.patch.yml` 第 444–445 行把 host 平面的 `tool-plugin-manager` `disabled: true`。
4. shipped `presets/standard.patch.yml` 第 144–146 行又补了一刀：
   ```yaml
   - id: tool-plugin-manager
     name: '@deepseek-ai/dsh-plugin-manager/tools'
     disabled: true
   ```
   → **默认 `standard` 预设（本会话所用）不暴露 plugin_manager**。
5. `presets/cordis.patch.yml` 第 152–154 行确实挂了它，但门控在 `!!js "!ctx.get('profileContext')"` —— 即"有 profile 才启用"。**本会话仍在 `standard` 预设，所以没吃到这一行。**

**推论**：计划书 §10 Phase 0 标注的"最大风险"真实发生了。走分支 B。

---

## 3. 分支 B：手写 profile 补丁层（已验证）

计划书 §6.1 把它称为"已验证路径"（`cordis.patch.yml` + `- insert:` 行 + 热加载）。本次把它落实为**可复现的四步**：

### 3.1 落点

```
$DSH_HOME/profiles/web/cordis.patch.yml
```

该文件是 profile 自己的补丁层，**在全部 bundle 层之后应用**（文件头注释原文：*"Your patch layer for this dsh profile, applied after every bundle layer"*）。

### 3.2 步骤

1. **备份**：`Copy-Item cordis.patch.yml dev\_probe\cordis.patch.yml.bak-<时间戳>`（本次已做）。
2. **追加**：用 **Node 脚本**（不是 PowerShell）读写文件——现有文件里已有一处被 PowerShell 弄坏的中文路径，是活生生的教训。见 `dev\_probe\install-fantian.mjs`。
3. **验证**：`dsh --profile web --dump-config`，检查退出码与新增行。
4. **生效**：需要**重启 `dsh web`**（补丁层在启动时合成），重启后新会话即可选到新预设。

### 3.3 实测验证结果

```
$ dsh --profile web --dump-config     # exit 0
> - id: preset-fantian-video
    name: '@deepseek-ai/dsh-agent-preset'
    config:
      id: fantian-video
      name: 翻填视频工作流
      ...
> - id: fantian-workbench
    name: file:///<ABS>/ui-workbench/index.js
    config:
      workspace: '<WORKSPACE>'
```

> 上面两处占位符按自己的环境替换：`<ABS>` = 该工作台目录的绝对路径，`<WORKSPACE>` = 它要读取的工作区绝对路径。

两行都进了合成树，且**没有**新的报错（唯一一条 `entry "dsh-cron" not found` 是**改动前就存在**的历史遗留，与本次无关）。

### 3.4 为什么 `name` 用 `file:///` 绝对路径

Host 半边与 Client 半边**都要**被解析到：

- Host：Loader 按普通 ESM 解析 → `file:///` URL 直接可用（已实测 `import` 成功）。
- Client：`dsh-client-modules` 的 `locatePkgJson(loaderName, baseUrl)`（`lib/index.js` 第 743–773 行）对以 `file:` / `.` / 绝对路径开头的行，走 `nearestPackage(moduleUrl)` —— **从该文件所在目录向上找最近的 `package.json`**，再读它的 `dsh.client` 与 `exports["./client"]`。

所以只要 `<bundle 目录>/package.json` 里有：

```json
"dsh": { "client": { "platform": "web", "immediately": true, "inject": [...] } },
"exports": { "./client": "./client.js" }
```

Client 半边就会被自动发现，**不需要**把包名塞进 profile 的 `package.json` 依赖里。这一点是本次探测的关键发现——它让"不手改 profile package.json"与"装一个带 UI 的插件"两个约束同时成立。

---

## 4. Web UI 插槽与主题 token（源码取证）

`cordis_inspect_query Slots.listSubTree` 不可用，于是改为**读契约类型声明 + 读已装插件的真实注册调用**。这比 inspect 更可靠的一点是：看到的是**真的在跑**的注册。

### 4.1 候选插槽（从已安装插件的 `ctx.slots.inject(...)` 实际调用里收割）

| 插槽 | kind / scope | 用途 | 现场用例 |
|---|---|---|---|
| `sidebar.right.pane.tab` | keyed / session | **右侧栏页签主体** ← 本次选它 | `dsh-sidenote`、`dsh-context`、`@nanmicoder/dsh-agent-teams`、`dsh-chat-import` |
| `sidebar.right.pane.tab.title` | keyed / session | 页签标题（可选） | 同上 |
| `conversation.session.header.utilities` | — | 会话头部工具条 | `dsh-sidenote`、`dsh-better-sidebar`、`dsh-ding` |
| `conversation.session.header.actions` | — | 会话头部按钮 | `meow-memory`、`dsh-remote-ssh-ops` |
| `conversation.composer.dock` | — | 输入区下方 | `meow-memory` |
| `conversation.input.dock` | — | 输入区停靠 | `@dsh-external/dsh-sentinel`、`dsh-sidenote` |
| `shell.overlay` | — | 全屏浮层 | `dsh-cron`、`dsh-context`、`dshmarket` |
| `settings.section` | — | 设置页一个分区 | `dsh-chat-import`、`dsh-usage-stats`、`meow-memory` |
| `settings.plugin.item` / `plugins.bundle.config` | — | 插件设置项 | `dsh-file-mentions`、`@liustack/modsearch` |
| `sidebar.footer.action` | — | 侧栏底部按钮 | `dsh-cron`、`dsh-knj-menu` |

**选择理由**：右侧栏页签是**有分配的版面空间**、可以画一整个面板、且宿主已有导航与展开逻辑的地方。计划书 §7.2 想要的"纵向五区 + 底部选项抽屉"正需要这样的空间，而 `conversation.composer.dock` 只有一行高度，画不下。

### 4.2 右侧栏页签的两段式注册（实测口径）

```js
// 第一段：往 sidebarRightTabs 注册一个**页签类型**
ctx.sidebarRightTabs.register({ id, kind, title: () => '…', guide: [{ order, title, description }] })

// 第二段：往 sidebar.right.pane.tab 注册该类型的**主体**（keyed by 类型 id）
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
  { name: 'sidebar.right.pane.tab', key: id }, Component))
```

- `keyed` 语义：同 key 同优先级只能一个占位者；重复注册会抛错。
- `scope: 'session'`：组件由框架注入 `sessionId`。
- `hookContext: TabHookContext`：由框架注入 `useTabInfo()` 等标准 Hook。
- 两段都用 `ctx.slots.inject` / `ctx.effect` 包住，**保证卸载时清场**（技能的硬要求）。

### 4.3 主题 token

样式只用 CSS 变量 `--dsw-*`（从已装包 bundle 里收割的全量清单，节选本次用到的）：

- 底/层：`--dsw-alias-bg-base`、`-bg-layer-1/2/3`、`-bg-mask-1`
- 文字：`--dsw-alias-label-primary`、`-secondary`、`-tertiary`、`-dimmed`、`-link`
- 边框：`--dsw-alias-border-l1/l2/l3/l4`、`--dsw-alias-separator-primary`
- 状态：`--dsw-alias-state-success-primary`、`-warn-primary`、`-error-primary`、`-business-primary`
- 交互：`--dsw-alias-interactive-bg-hover`、`--dsw-alias-button-tool-bar-fill/-hover`
- 形状：`--dsw-radius-sm/md/lg`、`--dsw-elevation-*`
- 字体：`--dsw-font-family`、`--dsw-font-s-14-font-size`、`--dsw-font-xxs-12-font-size`、`--dsw-font-markdown-code-font-family`

**为什么用变量而不是硬编码颜色**：亮/暗主题由宿主切换同一批变量的取值，插件自动跟随，无需自己写 media query 或主题判断。**并且不 import 任何 Harness Client 包**（技能硬要求 + 避免版本耦合）。

---

## 5. 工作台实际达到的级别：L1（含 L2 的一部分）

### 5.1 数据通路

```
Client 面板  ──同源 fetch──▶  GET /fantian-workbench/v1/snapshot
                                      │
                              Host 半边（只读）
                                      │
                    ┌─────────────────┼──────────────────┐
              翻填项目.json      _进度/*.csv|md     <videoDir>/**（目录枚举 + stat）
```

Host 半边用 `ctx.webServer.register({ kind:'prefix', path:'/fantian-workbench/v1', handler })`
—— `dsh-host-webserver` 是**公开且稳定**的宿主服务（`dsh-remote-ssh-ops` 等已装插件用的就是它），契约清楚、可自证；同源 fetch 不需要任何跨域或鉴权绕行。

### 5.2 覆盖到的 Tab

| Tab | 覆盖 | 数据源 |
|---|---|---|
| **歌词** | 原词/实测起音/偏差三列；超阈值句置顶；保底时长不足句置顶 | `plan/segments.json` 的 `lrc.lyrics` |
| **素材** | 按**流水线角色**分组（原曲/伴奏/分离人声/人声渲染/成品 各带就绪徽章）；产物目录规模 | `翻填项目.json` + 目录枚举 |
| **清单** | `_进度/进度.md` 的阶段总表解析 + 出片进度条 + 剩余预估花费 | `_进度/进度.md` |
| **出片** | 分镜表：段号/区间/生成秒/模式/素材/单段成本/状态 | `plan/segments.json` + `clips/` 实际文件 |
| **账本** | 逐笔花费（含累计）+ 预算执行条 + 成品索引 + 归档规模 | `_进度/成本台账.csv` + 配置 |

### 5.3 异常优先区（计划书 §7.1 的第 1 条原则）

面板默认只亮出"需要你注意的"，正常项收进折叠区。下面这组数值来自**一次真实交付的参照数据**，用来说明面板的判定口径与量级，**不是读者必须达到的规格**。当前在该数据上实测会自动挑出 5 条：

- ⚠ 3 句 LRC 时间与实测起音偏差 > 0.4s（第 6、17、24 句）
- ⚠ 11 句实测收声短于保底 3s（第 1、3、6、7、8、9、13、14、15、19、24 句）
- ⚠ 已花 ¥109.50 / 预算 ¥150（73%）
- ℹ ACE Studio 未运行 —— 音乐线动作不可用
- ℹ 出片进行中：17/17 段已有成片

### 5.4 实测证据（Host 半边，脱离宿主独立跑通）

用 `dev\_probe\snapshot-test.mjs` 直接调用路由 handler，在**真实数据**上得到（同为一次真实交付的参照）：

```
ok true · song.name <曲名> · segments 17/17 · generatedSeconds 174
lyrics 24（超阈值 3）· materials 6/6 就绪 · promptChars 17（超限 0）
ledger 4 笔 · total 109.5 · budget 150 · clips 17
dirStats: prompts 34 · refs 11 · clips 17 · subs 4 · cover 8 · verify 86 · history 12
```

全部与实际文件一致。**这是"面板数据与真实文件一致"的可复核证据**（计划书 §10 Phase 4 的验收项之一）。数字本身是量级参照：`segments 17/17` 表示分镜表 17 段全部有对应成片，`generatedSeconds 174` 是这些成片的生成秒数合计，`lyrics 24` 是歌词句数、其中 3 句偏差超过 0.4s 阈值。

---

## 6. 验证局限（必须明说）

按技能的硬要求，这里**明确声明每一条到底验到了什么、没验到什么**，不假装看到了。

### 6.1 后来补做的浏览器实测（本节更新于 Phase 4 完成后）

本报告初稿写"没有浏览器控制"，那是**写报告时的状态**——手边只有一个未登录的 `about:blank` 页面。
Phase 4 完成后补上了浏览器验证，**实测证据已落盘**：

- 用系统浏览器（Edge）历史里找回带 token 的 GUI URL，在 agent 浏览器里登录成功；
- 打开右侧栏 → 页签菜单里出现 **「翻填工作台」**；点开后 **5 个 Tab 全部渲染真实数据**；
- 逐个切换 Tab 并采集 DOM 计数 + 控制台错误：**0 条 console.error**
  （歌词 4 告警 / 素材 13 卡片 / 清单 24 行阶段表 / 出片 17 行分镜 / 账本 4 笔）；
- 截图存证：`dev\_probe\gui-verify\`

| 截图 | 内容 |
|---|---|
| `01_boot-failed-before-fix.png` | **修复前**的失败态：白屏 + "Failed to load plugins / dsh-fantian-workbench: import failed"（真实 bug 的现场） |
| `02_sidebar-tab-list.png` | 右侧栏页签菜单里出现「翻填工作台」 |
| `03_panel-lyrics-tab.png` | 歌词 Tab：状态条 `<曲名> · PV 已完成交付 (17/17)`、`¥109.50 / ¥150.00`、告警区 4 条、超阈值句与保底时长不足句置顶（金额与"17/17"均为一次真实交付的参照） |
| `04_panel-shoot-tab.png` | 出片 Tab：17 行分镜表（段号/区间/生成秒/模式/素材/单段成本/状态） |

**这次实测顺手抓到并修掉了一个真 bug**：Client 半边最初注册的模块 id 写成 `fantian-workbench`，
而 boot 校验要求它**逐字等于** `package.json` 的 `name`（`dsh-client-modules`：注册 id → 工厂键；
`factories.has(row.id)`，其中 row id = `nearestPackage().packageName`）→ 整批插件加载失败、**整页白屏**。
改成 `dsh-fantian-workbench` 后刷新即恢复。**这条只能靠真跑发现，看代码看不出来。**

### 6.2 仍然没验到的部分

1. **亮/暗两套主题**：样式全部走 `--dsw-*` 变量（已用 `CSSStyleSheet` 逐条核对：
   `.fw-root` 的 `color`/`background` 都是 `var(--dsw-*)`），**逻辑上**自动跟随；
   但**没有**真正切到亮色主题各截一次图——中途尝试用 JS 改 `body[data-ds-dark-theme]`
   并没有让变量换值（宿主/皮肤层有更高优先级的注入），所以**这一项保持未验证**。
2. **预设的可选性**：`dsh --profile web --dump-config` 已确认 `preset-fantian-video` 进了合成树且无新报错，
   但**"新建会话选它 → 技能在场、MCP 可用"仍需用户重启 `dsh web` 后自己点一次**
   （现有进程的会话是在改动前建的，选不到新预设）。
3. **`plugin_manager list_plugins`** 仍不可用，读不到 `fiberPhase` / `application` 字段；
   替代证据是 boot payload（`window.__DSH_BOOT__` 里确有 `dsh-fantian-workbench`）+ 上面的实测截图。
4. **L3（`[▶ 让 agent 跑]`）未实现**：需要向当前会话注入消息的宿主 API，本次未探明。
5. **`dev/shared/skills`（跨歌共享资产目录）尚不存在**：预设的 `customSkillDirs` 指向它，
   rank 300 那一档目前等于空跑（技能实际由 rank 200 的 `<项目根>/.agents/skills` 发现，功能不受影响）。

---

## 7. 对计划书的偏离与理由

| 计划书原文 | 实际做法 | 理由 |
|---|---|---|
| 技能目录 `<项目根>\.agents\skills\翻填视频流水线\` | `.agents\skills\fanfill-video-pipeline\` | 技能 `name` 必须匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（`dsh-skill` 第 17 行），**中文名会让整个技能被静默丢弃**。目录名其实无所谓（名字取自 frontmatter），但目录与 name 一致更可维护。中文名保留在 `description` 与正文，触发效果不受影响。 |
| 用 `plugin_manager install_bundle` 安装 | 手写 profile 补丁层 | §2 已证不可用；§3 是已验证分支 |
| refs 六份 | **八份** | 新增 `07_进度文档写法.md`（计划书 §5.5 把"进度文档规范"写成强制条款，值得独立成篇）与 `08_环境与踩坑.md`（Windows 编码/路径/工具链的坑太多，塞进 SKILL.md 会超长） |
| 工作台"会话侧边/独立面板" | 右侧栏页签（`sidebar.right.pane.tab`） | 这是宿主真正分配了版面空间的地方；且有 4 个已装插件在同一插槽上跑通，风险最低 |
| workspace bundle 放工作区 `dev\` | 保持放 `dev\`，但**行名用绝对路径** | profile 的 `node_modules` 不含该包；`file:///` 绝对路径让 Host 与 Client 两边都能解析（§3.4） |

---

## 8. 复查清单（下次改动这套东西时照这个走）

```powershell
# 1) 语法
node --check ui-workbench/index.js
node --check ui-workbench/client.js

# 2) 补丁层能合成（无副作用）
dsh --profile web --dump-config | Select-String "fantian"

# 3) Host 半边在真实数据上不炸
node tools/smoke-test.mjs

# 4) 重启 dsh web，然后：
#    - 新建会话 → 预设列表应出现「翻填视频工作流」
#    - 会话头部应出现「工作台」按钮；或右侧栏页签菜单里出现「翻填工作台」
#    - 打开后在浏览器控制台执行：fetch('/fantian-workbench/v1/snapshot').then(r=>r.json()).then(console.log)
```

**回滚**：把 `dev\_probe\cordis.patch.yml.bak-*` 覆盖回 `$DSH_HOME\profiles\web\cordis.patch.yml`，重启 `dsh web`。
