# Installing the DSH integration

This covers the three DeepSeek Harness (DSH) pieces: the **skill**, the **workbench panel** and the **agent preset**. The scripts work without any of this — DSH just makes them discoverable and adds a UI.

> **Why manual?** On the machine this was built on, the profile's agent tool surface did **not** expose `plugin_manager` / `cordis_inspect_*` — the shipped `standard` preset disables that row (`presets/standard.patch.yml`: `tool-plugin-manager: disabled: true`). So the validated path is to append rows to the profile patch layer by hand. If your profile *does* expose `plugin_manager`, prefer `install_bundle` — it does the package installation and bundle selection for you.

---

## 1. Skill (easiest — no config needed)

The skill filesystem scans a fixed set of roots, **one level deep**, and watches them with Chokidar, so a copied skill becomes live without restarting DSH:

| rank | root |
|---|---|
| 100 | `<project root>/.dsh/skills` |
| 200 | `<project root>/.agents/skills` |
| 300 | `customSkillDirs` (from config) |
| 400 | `$DSH_HOME/skills` |
| 500 | `~/.agents/skills` |

```bash
mkdir -p .agents/skills
cp -r skills/fanfill-video-pipeline .agents/skills/
```

Verify by asking the agent to list skills — `fanfill-video-pipeline` should appear.

**Two rules that fail silently if you break them:**

1. The frontmatter `name` must match `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. A non-ASCII name makes the whole skill **disappear with no error** (`parseSkillFile` returns `undefined`, the scanner `continue`s). The *directory* name does not matter — only the frontmatter does.
2. The layout must be exactly `<root>/<name>/SKILL.md`. A nested `**/SKILL.md` is not recognised.

---

## 2. Workbench panel + agent preset

Both are installed by appending rows to **your profile patch**:

```
$DSH_HOME/profiles/<profile>/cordis.patch.yml
```

The profile path on Windows defaults to `C:\Users\<you>\.dsh\profiles\<profile>\cordis.patch.yml`. **Back it up first.**

### 2.1 Workbench row

Edit the two absolute paths to match your machine, then append:

```yaml
# 翻填工作台 (workbench): host half serves the panel's routes (snapshot, upload,
# config write-back, whitelisted runs, jobs) at /fantian-workbench/v1; client half
# registers a right-sidebar panel. Registered at HOST level so the panel is
# available under every preset, not just the pipeline preset.
- insert:
    - id: fantian-workbench
      name: 'file:///<ABSOLUTE/PATH/TO>/ui-workbench/index.js'
      config:
        workspace: '<ABSOLUTE/PATH/TO/your/workspace>'
        # ── all of the below are OPTIONAL; they only feed the panel's environment probe
        templateRoot: '<ABSOLUTE/PATH/TO/this/repo>'   # where "new song" copies scripts/ + skill from
        ffmpegDir: '<ABSOLUTE/PATH/TO>/ffmpeg/bin'     # else: FANFILL_FFMPEG_DIR env → video.ffmpegDir → tools/ffmpeg → PATH
        venvsRoot: '<ABSOLUTE/PATH/TO>/venvs'          # where the sep/ and pitch/ venvs live
        junctions:                                     # ASCII junctions your music scripts need (optional)
          - '<ABSOLUTE/ASCII/JUNCTION>'
        maxUploadMb: 512                               # upload cap for material submission
        browseRoots:                                   # dirs the "new song" wizard may browse / create in
          - '<ABSOLUTE/PARENT/OF/YOUR/SONGS>'
        allowedInterpreters:                           # interpreters ALLOWED OUTSIDE the song root
          - '<ABSOLUTE/PATH/TO>/venvs/pitch/Scripts/python.exe'
        # registryPath: '<path>/songs.json'            # where the multi-song registry lives (default: next to index.js)
```

The plugin deliberately contains **no machine-specific paths**: everything local (ffmpeg, venvs, junctions, template root, interpreter allow-list, browse roots) comes from this config block, which is why the shipped `ui-workbench/` is portable.

Two safety properties worth knowing before you install it:

- **The host refuses paid actions outright.** The panel can only *hand* a paid stage to the agent (with a prompt that asks for a cost estimate first). `paid`/`costCny > 0` never runs from the panel.
- **`<song workspace>/工作台流水线.json` is executable content.** It may name an interpreter and a command line, so actions defined there are marked *untrusted*: the panel always asks for confirmation before running them, the interpreter must be inside the song root or listed in `allowedInterpreters`, and `argv` may not contain escaping paths. That also means: **do not trust a song directory that came from someone else** without reading that file.

Why `file:///…` and not a package name: `dsh-client-modules` resolves a loader row's client half by walking up from the row's file to the nearest `package.json` (`locatePkgJson` → `nearestPackage`) and reading its `dsh.client` declaration. A `file:///` URL therefore makes **both** halves resolvable without putting anything into the profile's `node_modules`.

**The client module id must equal the package `name` byte-for-byte.** `client.js` calls `window.__ModuleLoader__.load({ id: 'dsh-fantian-workbench' })`, which matches `ui-workbench/package.json`'s `name`. If you rename the package, change both — a mismatch fails the boot check and **blanks the entire page** with `Failed to load plugins`.

### 2.2 Preset row

The preset lives in `agent-preset/cordis.patch.yml` — copy its single `- insert:` block into the same profile patch. It declares:

```yaml
config:
  id: fantian-video
  name: 翻填视频工作流
  order: 20
  plugins: [ … ]
```

(`name` is the display label; keep it or translate it — `id` is what the preset roster keys on.)

The preset's persona hard-codes the six standing rules (non-destructive, one budget authorization plus a ledger, 1:1 comparison for quality-type acceptance, absolute paths then stop, append-only progress document, local-first) and tells the agent to load the skill **first thing**.

### 2.3 Verify without side effects

```bash
dsh --profile <profile> --dump-config | grep -i -E "fantian|preset-"
```

Exit code 0 with both rows present means the patch composes. The same command is the fastest way to catch YAML mistakes — it prints the fully composed loader tree.

**Hot reload vs restart.** Appending rows takes effect immediately for *new* work in a running `dsh web` (the routes and the boot payload update without a restart — verified: the snapshot route answered `200` right after the patch was written). But **sessions created before the change cannot select the new preset** — restart `dsh web` (or open a fresh session) and pick it from the preset list.

### 2.4 Rollback

```bash
cp <your-backup>/cordis.patch.yml "$DSH_HOME/profiles/<profile>/cordis.patch.yml"
# then restart dsh web
```

An unparseable profile patch is a hard startup failure, which is why the backup is step one.

---

## 3. Verifying the panel

1. Open the DSH web GUI, open a session in your workspace.
2. Open the right sidebar → **+** (new tab) → the panel appears in the list as **翻填工作台**.
3. The **引导 (guide)** tab should show seven stages, with the first unfinished stage expanded; the secondary tabs are assets / lyrics / shots / ledger / jobs. **⛶** expands the sidebar to full screen.
4. Cross-check the data against the files:

```bash
curl http://127.0.0.1:<port>/fantian-workbench/v1/ping      # {"ok":true,"workspace":"…","version":"2.0.0"}
curl http://127.0.0.1:<port>/fantian-workbench/v1/snapshot  # the full snapshot (v1 fields + pipeline/songs/env/jobs)
```

5. Run the two headless suites if you want to check it before trusting the UI (they need no assets and no network):

```bash
node tools/smoke-test.mjs     # host half on a synthetic workspace (13 assertions, v1 contract)
# the fuller suites live next to the plugin in the authoring workspace:
#   workbench-v2-test.mjs (95) / workbench-client-render-test.mjs (27)
```

**What it writes:** material uploads land in the slot's target directory (never overwriting — a clash becomes `-2`), and the matching key in `翻填项目.json` is updated **after** backing the file up and checking a sha256/mtime lock. Paid actions are refused by the host outright — the panel can only hand them to the agent. Nothing else in your project is touched.

**Restart vs refresh:** editing the plugin's **host** half (`index.js`, `lib/*.mjs`) or the profile patch needs a `dsh web` restart; editing the **client** half (`client.js`) only needs a page refresh. Measured: a JS edit is *not* hot-reloaded (the HMR watcher ships with `root: []`), while a profile-patch edit applies in about two seconds.

---

## 4. Video-generation driver

`scripts/82_pv_clips.mjs` shells out to a driver that knows how to talk to the video API. A copy lives at `drivers/minimax-h3/h3.mjs` (dependency-free Node ≥ 18, reads its key from `~/.dsh/.credentials.yaml`).

Place it where the script expects, or point at it:

```bash
# option A — project default location
mkdir -p tools/minimax-h3 && cp drivers/minimax-h3/h3.mjs tools/minimax-h3/

# option B — environment variable
export FANFILL_H3=/absolute/path/to/h3.mjs

# option C — in 翻填项目.json
#   "video": { "h3Driver": "tools/minimax-h3/h3.mjs" }
```

`82 --plan` reports a missing driver explicitly rather than failing at submission time.

### 4.1 Optional — the H3 MCP server (turns H3 into agent-native tools)

The repo also ships an MCP server (`drivers/minimax-h3/mcp-server/`). It wraps the *same* driver, so registering it gives the agent native tools (prefix `mcp__h3__*`: estimate, submit, poll+download, status, list, cancel, prompt-enhance, 2K regenerate, upload asset) instead of a command line.

> **The driver is dependency-free; the MCP server is not.** It uses the official MCP SDK v2 (`@modelcontextprotocol/server` + `client` + `zod`) and `node_modules` is never committed, so install its dependencies once:

```bash
mkdir -p tools/minimax-h3/mcp-server
cp drivers/minimax-h3/mcp-server/* tools/minimax-h3/mcp-server/
cd tools/minimax-h3/mcp-server && npm install
```

Then append the `insert` row from [`docs/04_h3-workflow.md`](04_h3-workflow.md) §8.3 to your profile patch (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`), replacing `<WORKSPACE>` with your absolute workspace path. A profile-patch edit usually applies in about two seconds; if `mcp__h3__*` still is not there, restart `dsh web`.

**Verify it without spending money:**

```bash
node tools/minimax-h3/mcp-server/_selftest.mjs   # starts the server through the official client SDK, lists tools, calls a read-only one, checks the over-budget refusal
```

## 5. Sanity checks

```bash
node tools/smoke-test.mjs        # config loader + shot-list pipeline on a synthetic workspace
node tools/gensong-test.mjs      # cross-song genericity: a throwaway workspace with different parameters
```

Both are free and touch nothing outside a temp directory.
