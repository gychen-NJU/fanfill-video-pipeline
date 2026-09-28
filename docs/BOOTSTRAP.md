# BOOTSTRAP — agent-driven installation

You are reading this because a user asked you to install **fanfill-video-pipeline** for them. Work through the steps in order. Each step has a **command**, an **expected result**, and a **fallback**.

## Rules for you, the agent

1. **Verify every step.** Run the given check and compare against the expected result; do not assume success from "the command exited 0".
2. **Never invent success.** If a check fails and the fallback also fails, stop and report exactly what you tried and what the output was.
3. **Ask for two things only:** the MiniMax API key (a secret you should not hunt for or print), and restarting `dsh web` (you cannot do it for yourself mid-session). Everything else you can do.
4. **Do not install into the system.** Prefer workspace-local or user-scoped installs. On Windows do not write to `C:\Program Files`.
5. **Do not modify the repository's tracked files.** Installation side effects belong in the workspace around it, or in the user's DSH profile.
6. When done, run the acceptance test in step 7 and report the raw result.

---

## Step 0 — Identify the platform and the workspace root

```bash
node -e "console.log(process.platform, process.arch, process.version)"
pwd
```

Expected: `win32 x64 v18…` (or `linux` / `darwin` with `v18.0.0` or newer).

- **Node < 18 → stop** and tell the user to install Node 18+ first. Nothing else will work.
- The current directory must be the cloned repository. If it is not, `cd` into it.

---

## Step 1 — FFmpeg

```bash
ffmpeg -version
ffprobe -version
```

Expected: `ffmpeg version 6.x/7.x/8.x`.

**Fallback A — the bundled ImageMagick build (Windows).** If the output mentions ImageMagick, or a real filter graph later fails with a cryptic error, this is the wrong binary. Find a real one:

```powershell
Get-ChildItem -Path C:\,D:\,E:\ -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'ImageMagick' } | Select-Object -First 5 -ExpandProperty FullName
```

**Fallback B — nothing installed.** Ask the user before downloading ~100 MB. If they agree, the usual route on Windows is a gyan.dev essentials build; on macOS `brew install ffmpeg`; on Debian/Ubuntu `sudo apt install ffmpeg` (this one goes to the system, which is fine on Linux).

Once you have a directory containing **both `ffmpeg` and `ffprobe`**, record it:

```powershell
# Windows, current session
$env:FANFILL_FFMPEG_DIR = "E:\software\FFmpeg\ffmpeg-8.1.1-essentials_build\bin"
# permanent (new sessions)
[Environment]::SetEnvironmentVariable("FANFILL_FFMPEG_DIR", $env:FANFILL_FFMPEG_DIR, "User")
```

```bash
# macOS / Linux
export FANFILL_FFMPEG_DIR="$(dirname "$(command -v ffmpeg)")"   # add to ~/.bashrc to persist
```

**Verify:**
```bash
node -e "import('./scripts/lib/fanfill-config.mjs').then(m=>console.log(m.resolveFfmpeg()))"
```

Expected: `{ ffmpeg: '…', ffprobe: '…', source: '…', ok: true }`. **`ok: true` is the acceptance criterion** — `ok: false` means it fell back to bare `ffmpeg` on `PATH`, which is fine only if `ffmpeg -version` (step 1) was already the real thing.

---

## Step 2 — Verify the pipeline without any assets

```bash
node tools/smoke-test.mjs
```

Expected: `OK: all 13 checks passed`. It builds a synthetic workspace in a temp directory, exercises the workbench's read-only snapshot route, and writes nothing into the repository.

If it fails, read the failing check name — it tells you which subsystem broke. Report the exact name and output; do not patch the repository to make it pass.

---

## Step 3 — Prove the scripts work on a *different* song

```bash
node tools/gensong-test.mjs
```

Expected: ends with `✅ 换歌验证通过` (cross-song validation passed), having created a throwaway workspace with deliberately different parameters and run the shot-list stage in it.

This is the real genericity test: it would fail if any script still hard-coded the reference song's name, length or output directory.

---

## Step 4 — The video driver (only if the user wants to generate video)

`scripts/82_pv_clips.mjs` shells out to a driver for the video API. Check whether it is reachable:

```bash
ls tools/minimax-h3/h3.mjs 2>/dev/null || echo "not in the default place"
```

If missing, place the vendored copy there:

```bash
mkdir -p tools/minimax-h3
cp drivers/minimax-h3/h3.mjs tools/minimax-h3/
```

Or point at it without moving anything:

```bash
export FANFILL_H3="/absolute/path/to/h3.mjs"        # or set video.h3Driver in 翻填项目.json
```

**Then ask the user for the MiniMax API key** (China region, `api.minimaxi.com`). The driver reads it from `MINIMAX_API_KEY`, or from `~/.dsh/.credentials.yaml`. **Do not print the key, do not commit it, do not put it in a tracked file.** A `.gitignore` already excludes `.credentials.yaml` and `.env*`.

**Verify without spending money:**
```bash
node scripts/82_pv_clips.mjs --plan
```
Expected: a per-shot table plus a cost estimate, with `⛔` if the batch would exceed the budget. `--plan` sends no request — if it tries to reach the network, something is wrong.

**Also do this before any real run:** confirm the budget in `翻填项目.json` (`budget.totalCny`, `budget.authorized`) with the user. Stage 5 is the only stage that spends money, and the workflow's rule is *one authorization plus a per-charge ledger*, not per-step confirmation.

---

## Step 5 — Optional extras

- **Real-ESRGAN** (free local upscale): put `realesrgan-ncnn-vulkan` somewhere and either add it to `PATH` or set `video.upscale.tool` in the config. Without it, skip stage 10 — you still get the base-resolution film.
- **ImageMagick**: only two cover layouts use it. Without it those layouts are unavailable; the rest work. Set `FANFILL_MAGICK` if it is not on `PATH`.

---

## Step 6 — DeepSeek Harness integration (optional)

Only if the user runs DSH and wants the skill, the panel and the preset.

```bash
mkdir -p .agents/skills
cp -r skills/fanfill-video-pipeline .agents/skills/
```

The skill filesystem watches `.agents/skills` and picks it up **without restarting**. Verify by asking the agent to list skills — `fanfill-video-pipeline` should appear.

Then follow **[INSTALL.md](INSTALL.md)** §2 for the profile-patch rows (workbench panel + agent preset). That file explains why the two absolute paths must be edited, and why the client module id must match the package name exactly.

---

## Step 7 — Acceptance

```bash
node tools/smoke-test.mjs                # expect: OK: all 13 checks passed
node tools/gensong-test.mjs              # expect: ✅ 换歌验证通过
node scripts/80_pv_shotlist.mjs --plan   # expect: reads 翻填项目.json and prints a shot plan, or says the config is missing
```

Report to the user, verbatim and without embellishment:

- which platform and Node version
- the resolved ffmpeg path and whether `ok` was `true`
- the smoke test result
- the cross-song test result
- what you could **not** install (API key, `dsh web` restart) and what is therefore still untested

**Do not claim the pipeline is "installed and working" beyond what these four commands actually show.** In particular, generating video costs money and must not be attempted as part of installation.
