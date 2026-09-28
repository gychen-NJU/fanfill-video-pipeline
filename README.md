# fanfill-video-pipeline

Turn a song plus a rewritten lyric sheet into a finished **cover song + PV music video** — driven by a coding agent, on a file-based pipeline with no database.

This repository is the reusable half of a real, completed production run: the Chinese cover PV *未来再见 (See You in the Future)*, a fan rewrite of the insert song from *Honkai Impact 3rd — Cooking with Valkyries II*. The run produced a 165.875 s / 1920×1080 PV from 17 AI-generated segments, plus a mixed master audio track, a cover image and a upload description — for **¥109.50** in paid video-generation spend, everything else local and free.

That run is now frozen into three reusable pieces:

| Piece | What it is | Why it exists |
|---|---|---|
| **Skill** `skills/fanfill-video-pipeline/` | Markdown SOP: workflow stages, commands, thresholds, pitfalls | **The brain.** Loaded on demand, costs context only when used |
| **Scripts** `scripts/` | 9 parameterised `.mjs` tools (shotlist → refs → clips → subs → assemble → verify → cover → upscale) | **The hands.** Every one reads a single project config; every one supports `--plan` |
| **Workbench** `ui-workbench/` | A read-only web panel: lyrics / assets / pipeline / shots / ledger | **The eyes.** See what's missing and what it cost, without reading logs |

Plus `agent-preset/` — a preset that puts the skill, the tools and the discipline in place at session start.

---

## The one idea worth stealing

**Files are the source of truth. No database.**

```
                        ┌──────────────┐
   agent (skill + scripts) ────┤  翻填项目.json  │──── web workbench (read-only)
                        └──────────────┘
                                 │
              _进度/进度.md   (human-readable progress)
              _进度/成本台账.csv (per-charge ledger)
              <planDir>/segments.json (the shot list)
```

Everything — the config, the shot list, the progress document, the cost ledger — is a plain file you can open in an editor. The UI is a *view* over those files, never a second copy of the truth. Changing songs means changing a workspace directory, not migrating a database.

---

## How the pipeline works

Two delivery lines that meet in the middle:

```
MUSIC   source ─► stems ─► transcription / alignment ─► vocal render ─► (voice conversion) ─► mix ─► master
VIDEO   LRC alignment ─► shot list ─► reference images ─► prompts ─► video generation ─► subtitles ─► assemble ─► upscale ─► verify
```

The coupling point: **the shot list is cut against the *measured* vocal onsets, not the lyric file's nominal timestamps.** In the reference run the lyric file was off by up to 0.810 s, and one cut point had to be snapped from 157.0 s to 159.5 s to land in a real silence valley. Cutting on nominal timestamps cuts through words.

### Stages

| # | Stage | Command | Output | Paid? |
|---|---|---|---|---|
| 1 | Survey + config | — | `<planDir>/material_survey.md` | no |
| 2 | Separate / transcribe / render / mix | `scripts/10–71` | `02_stems/`, `03_midi/`, `05_vocals/`, `07_mix/` | no (local) |
| 3 | Lyric alignment + shot list | `node scripts/80_pv_shotlist.mjs` | `segments.json`, `lyrics_timing.csv`, `alignment_report.md` | no |
| 3b | Prompt self-check | `node scripts/80b_check_prompts.mjs` | pass/fail report | no |
| 4 | Reference images (delogo + resize) | `node scripts/81_pv_refs.mjs` | `<refDir>/ref_*.jpg` | no |
| 5 | **Video generation** | `node scripts/82_pv_clips.mjs --only 1,2,3 --max-cost 25` | `<clipDir>/NN_slug.mp4`, `cost_log.csv` | **yes** |
| 6 | Subtitles | `node scripts/83_pv_subs.mjs --w 1920 --h 1080 --tag 1080` | `<subDir>/*.ass`, `*.srt` | no |
| 7 | Assemble | `node scripts/84_pv_assemble.mjs` | `…_PV_v2.mp4` | no |
| 8 | Verify (7 checks) | `node scripts/85_pv_verify.mjs --w 1920 --h 1080` | `verify/report.md` + frames | no |
| 9 | Cover | `node scripts/86_pv_cover.mjs --only D` | `cover/*.jpg` | no |
| 10 | Upscale (Real-ESRGAN) | `node scripts/87_pv_upscale.mjs` | `…_1080p.mp4` | no (slow) |

Every script takes `--plan`: it prints exactly what it would do and what it would cost, writes nothing, and sends nothing. **Use `--plan` first, always.**

---

## Quick start

### 0. Install

The video pipeline itself has **no package dependencies** — every script is a standalone `.mjs` file. What you need are a few external binaries.

| Dependency | Needed for | Required? |
|---|---|---|
| **Node.js ≥ 18** (tested on 24) | every script | **yes** |
| **FFmpeg + ffprobe** | alignment, reference images, subtitles, assemble, verify | **yes** |
| **A MiniMax API key** (China region) | shot generation — the only paid stage | only for stage 5 |
| **Real-ESRGAN ncnn-vulkan** | free local upscale to 1080p/2K | optional |
| **ImageMagick** | two cover layouts | optional |
| **DeepSeek Harness** | skill / preset / workbench integration | optional |

```bash
git clone https://github.com/gychen-NJU/fanfill-video-pipeline my-song
cd my-song

node --version          # expect v18+
ffmpeg -version         # must be REAL ffmpeg, see warning below
node tools/smoke-test.mjs   # 13 self-checks on a synthetic workspace — writes nothing outside a temp dir
```

`tools/smoke-test.mjs` needs no assets and no network: it builds a throwaway workspace, renders the workbench snapshot and asserts 13 things. If it passes, your Node side is good.

**The one install trap on Windows:** `ffmpeg` on `PATH` is often the ImageMagick bundled build, which fails on real filter graphs. Point at a real one:

```powershell
$env:FANFILL_FFMPEG_DIR = "E:\software\FFmpeg\ffmpeg-8.1.1-essentials_build\bin"
& "$env:FANFILL_FFMPEG_DIR\ffmpeg.exe" -version   # expect "ffmpeg version 8.x ..."
```

Set it permanently (or put `"ffmpegDir": "…/bin"` in the config). The resolver order is: `FANFILL_FFMPEG_DIR` → `video.ffmpegDir` → a legacy hard path → bare `ffmpeg` on `PATH`, and it prints a one-time notice when it falls back.

Full, step-by-step setup — including the DSH skill/preset/panel wiring and the video driver — is in **[docs/INSTALL.md](docs/INSTALL.md)**.

### Let an agent do the install

This repo is meant to be driven by a coding agent. Paste this into a fresh session **in the cloned directory** and it will work through the checklist and verify as it goes:

```
Read docs/BOOTSTRAP.md and install this project for me, following it step by step.
Verify each step with the command it gives, stop and ask me only for things you
cannot do yourself (the MiniMax API key, and restarting dsh web if needed).
When you finish, run `node tools/smoke-test.mjs` and report the result.
```

`docs/BOOTSTRAP.md` is written for that: every step has an exact command, an expected result, and a "if this fails, do this instead" fallback. A shorter form that also works, if you just want the agent to figure it out from the README:

```
Install fanfill-video-pipeline from the README: check Node and ffmpeg, set
FANFILL_FFMPEG_DIR to a real ffmpeg (not the ImageMagick one), then run
node tools/smoke-test.mjs and tell me what it says.
```

Python is **not** required for anything in this repository — the only Python files in the reference project belong to its music line, which is not shipped here.

Environment variables this repo understands:

| Variable | Meaning | Default |
|---|---|---|
| `FANFILL_FFMPEG_DIR` | directory containing `ffmpeg` / `ffprobe` | a legacy hard path, then `PATH` |
| `FANFILL_H3` | absolute path to the video driver `h3.mjs` | `<workspace>/tools/minimax-h3/h3.mjs` |
| `FANFILL_MAGICK` | `magick` binary for cover layouts | a legacy hard path |
| `FANFILL_WORKSPACE` | workspace to inspect, for `tools/*.mjs` | the current directory |
| `MINIMAX_API_KEY` | read by `drivers/minimax-h3/` via the credentials store | `~/.dsh/.credentials.yaml` |

### 1. Get the files into a workspace

```bash
git clone <this repo> my-song
cd my-song
```

### 2. Create the project config

Write `翻填项目.json` (project config, schema v1). This is the **single source of parameter truth** — no script hardcodes the song name, total length, segment count or resolution.

```jsonc
{
  "schema": 1,
  "song": { "name": "My Song", "source": "…", "lrc": "music/lyrics.lrc", "bpm": 156, "totalSec": 166.0, "fps": 24 },
  "audio": {
    "reference": "01_input/original.mp3",
    "instrumental": "02_stems/instrumental.wav",
    "aceVocal": "05_vocals/vocal.wav",
    "master": "07_mix/master.wav",
    "separation": "python-audio-separator",
    "voice": { "target": "…", "engine": "ace-studio" },
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
  "credits": { "original": { "词": "…" }, "thisVersion": { "改词": "…", "tools": [], "disclaimer": "AI-generated, non-commercial" } },
  "budget": { "totalCny": 150, "spentCny": 0, "authorized": false },
  "cover": { "title": "My Song", "subtitle": "…", "preset": "D", "sizes": [[1344, 768], [1146, 717]], "logos": [] }
}
```

Full field reference: [`docs/08_project-config-spec.md`](docs/08_project-config-spec.md) (Chinese).

### 3. Run the free stages

```bash
node scripts/80_pv_shotlist.mjs --plan    # read-only rehearsal
node scripts/80_pv_shotlist.mjs           # writes the shot list
node scripts/80b_check_prompts.mjs        # prompt lint
node scripts/87_pv_upscale.mjs --plan
```

### 4. Wire it into DSH (optional but recommended)

```bash
# skill: one level deep, discovered automatically, hot-reloaded
mkdir -p .agents/skills
cp -r skills/fanfill-video-pipeline .agents/skills/

# panel + preset: append rows to your profile patch
#   $DSH_HOME/profiles/<profile>/cordis.patch.yml
```

The two rows to append (edited to your absolute paths) are in
[`docs/INSTALL.md`](docs/INSTALL.md). Verify without side effects:

```bash
dsh --profile <profile> --dump-config | grep -i fanfill
```

See [`ui-workbench/`](ui-workbench/) and [`agent-preset/`](agent-preset/).

---

## Hard constraints (learned the hard way)

These are not style preferences — each one cost real time or real money:

| Constraint | Why |
|---|---|
| **A prompt is capped at 7000 characters** | API hard limit. The reference run used 1987–6649. |
| **Reference images and a first-frame image are mutually exclusive** | Want "reference *and* continuity"? Use **Ref2VA for the opening shot, then chain each later shot from the previous clip's last frame.** |
| **Reference-image routing must go through the video model's Ref2VA mode** | The image model's `subject_reference` accepts only publicly reachable URLs; a local file cannot be referenced. |
| **Never extract frames from the finished film** | It already has burned-in subtitles. Extract from the per-shot clips. |
| **Re-burn subtitles at the target resolution** | Scaling a video that already has subtitles baked in scales the text too. |
| **Real upscaling ≠ resampling** | Lanczos / a DAW resample makes a *bigger file*, not a *sharper picture*. Use Real-ESRGAN. |
| **Measure onsets, don't trust the lyric file** | Nominal timestamps were off by up to 0.810 s in the reference run. |
| **Use absolute paths for ffmpeg** | A bundled ImageMagick `ffmpeg` on `PATH` will shadow the real one. |
| **Write `.mjs` files; never `node -e`** | PowerShell 5.1 eats inline scripts. |
| **Read and write files containing non-ASCII with Node** | A PowerShell `Get-Content` → `ConvertFrom-Json` round-trip will silently corrupt UTF-8. |

## Discipline the pipeline assumes

- **Non-destructive by default.** Inputs are read-only. Replaced outputs move to `history/<timestamp>/` with a README; new outputs get `vN` names. Never overwrite.
- **One authorization, then a ledger.** Ask once for a budget; record every charge in `_进度/成本台账.csv`; stop only when the estimate would exceed the budget. Do not ask per step.
- **Quality-type acceptance needs a 1:1 comparison.** If the ask is "sharper" / "better", a passing spec sheet is not delivery — produce same-frame / same-passage A/B evidence.
- **Absolute paths, then stop for review.** Hand over what to look at, then wait.
- **Local-first.** Upscaling, separation and mixing all run on your own machine for free.

---

## Layout

```
fanfill-video-pipeline/
├── skills/fanfill-video-pipeline/   # the SOP: SKILL.md + references/01..08
├── scripts/                          # 80–87 + 80b + lib/fanfill-config.mjs
├── drivers/minimax-h3/               # dependency-free video-gen driver + MCP server
├── ui-workbench/                     # DSH UI plugin (host route + client panel)
├── agent-preset/                     # DSH agent preset
├── tools/                            # reuse checks (smoke + cross-song genericity)
├── examples/                         # a real, completed production run
│   ├── project-config.json           #   the config that drove it
│   ├── progress.md                   #   the human progress document
│   ├── cost-ledger.csv               #   the per-charge ledger
│   └── stage-metrics.md              #   the numbers + how they were verified
└── docs/                             # install guide + config spec + capability report
```

---

## Reference run metrics

Everything below was measured, not estimated.

| Metric | Value |
|---|---|
| Shots / nominal length / frames | 17 / 165.86 s / 3981 @ 24 fps |
| Delivered resolution | 1344×768 + 1920×1080 (local upscale) |
| Generated seconds billed | 174 s (per-shot ceiling) |
| Nominal cost estimate | ¥87.00 |
| **Actual video spend** | **¥109.50** (¥9 trial + ¥71.50 batch + ¥29.00 re-shoots) |
| Upscale | ¥0, 28.1 min local |
| Verification | 7/7 — −14.1 LUFS, TP −1 dBFS, max SSIM 0.522, chain joints 0.788 / 0.885 |
| Lyric alignment | max deviation 0.810 s; 20/24 lines within 0.32 s |
| Cut-point snapping | 157.0 s → 159.5 s (silence margin 73.195 dB) |

## Verification status — read this before trusting anything

Honesty matters more than a green checkmark, so here is what is and is not established.

**Verified**
- The full pipeline ran end to end and produced the delivered PV; the verification report was reproduced byte-for-byte after the scripts were parameterised.
- The shot-list script, re-run after refactoring, reproduced the delivered shot list **byte-for-byte** (17 shots, boundaries, 174 s, ¥87.00, lyric timing CSV).
- **Cross-song genericity:** an empty shell workspace with deliberately different parameters (different name, 30 s, 40 BPM, 9:16, `10_video` instead of `10_h3video`, 12 s shot cap) ran to the shot-list stage with zero errors and honoured every config value.
- Non-destructiveness: the read-only zones' content fingerprints are identical before and after.
- The workbench panel was opened in a real browser and screenshotted; all five tabs rendered live data with **0 console errors**.

**Not verified — treat as untested**
- **Light/dark theme rendering.** Styles use theme tokens exclusively (checked rule by rule), but only the dark theme was actually screenshotted.
- **The 2K paid path**, dissolve transitions, and the `L2VA` / `<Video N>` / `<Audio N>` prompt forms were never used in the reference run.
- **Which upscaling model was actually used** — no argument log survives; the script default is recorded, not measured.
- The master audio file has true peak **−0.22 dBTP**, above the −1 dBTP target; the delivery masters in `08_release/` do pass. Whether to swap them is an open decision.

## License

Pipeline code is [MIT licensed](LICENSE) — use it, fork it, ship it.

**Assets are not included, and the MIT license does not cover them.** The reference run's source art, song audio and rendered video are third-party fan-work assets and are deliberately absent from this repository. The `examples/` directory contains only text: configuration, metrics and ledger entries, published for documentation value.

If you publish anything built with this pipeline, mark it as AI-generated, non-commercial, and credit the original work. That is not optional in the workflow this repo encodes — the skill's reference documents treat it as a delivery blocker.
