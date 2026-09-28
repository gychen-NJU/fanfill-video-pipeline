# fanfill-video-pipeline

[English](README.md) · [中文](README.zh-CN.md) · [Docs site ↗](https://gychen-nju.github.io/fanfill-video-pipeline/)

Turn a song plus a rewritten lyric sheet into a finished **cover master + PV music video** — driven by a coding agent, on a file-based pipeline with no database.

> **Generic by design.** Nothing here is specific to any one song. Give it any track and any rewritten lyrics; the pipeline reads a single project config and produces the same fixed set of artefacts. The reference run that these tools were extracted from is documented separately in [`examples/`](examples/) — read that only if you want to see real numbers.

---

## The one idea worth stealing

**Files are the source of truth. No database.**

```
                        ┌──────────────────┐
   agent (skill + scripts) ────┤  project config  │──── web workbench (guided)
                        └──────────────────┘
                                 │
              progress doc    (human-readable progress + artefact index)
              cost ledger     (one row per charge)
              shot list       (the cuts, shared by scripts and UI)
```

Everything — the config, the shot list, the progress notes, the cost ledger — is a plain file you can open in an editor. The UI is a *view* over those files, never a second copy of the truth. Changing songs means changing a workspace directory, not migrating a database.

---

## How the pipeline works

Two delivery lines that meet in the middle:

```
MUSIC   source ─► stems ─► transcription / alignment ─► vocal render ─► (voice conversion) ─► mix ─► master
VIDEO   lyric alignment ─► shot list ─► reference images ─► prompts ─► video generation ─► subtitles ─► assemble ─► upscale ─► verify
```

The coupling point: **the shot list is cut against the *measured* vocal onsets, not the lyric file's nominal timestamps.** Lyric files are hand-made timing art, not measurements — they drift, sometimes by most of a second, and a cut placed on a nominal timestamp will slice through a word. The scripts therefore read the vocal stem's RMS envelope, find the true onsets and the real silences, and snap each cut into a silence valley.

### Stages

| # | Stage | Command | Output | Paid? |
|---|---|---|---|---|
| 1 | Survey + config | — | `material_survey.md` | no |
| 2 | Separate / transcribe / render / mix | your own music toolchain | stems, MIDI, vocals, mix | no (local) |
| 3 | Lyric alignment + shot list | `node scripts/80_pv_shotlist.mjs` | `segments.json`, `lyrics_timing.csv`, `alignment_report.md` | no |
| 3b | Prompt self-check | `node scripts/80b_check_prompts.mjs` | pass/fail report | no |
| 4 | Reference images (delogo + resize) | `node scripts/81_pv_refs.mjs` | `refs/ref_*.jpg` | no |
| 5 | **Video generation** | `node scripts/82_pv_clips.mjs --only 1,2,3 --max-cost 25` | `clips/NN_slug.mp4`, `cost_log.csv` | **yes** |
| 6 | Subtitles | `node scripts/83_pv_subs.mjs --w 1920 --h 1080 --tag 1080` | `subs/*.ass`, `*.srt` | no |
| 7 | Assemble | `node scripts/84_pv_assemble.mjs` | `…_PV_v2.mp4` | no |
| 8 | Verify (7 checks) | `node scripts/85_pv_verify.mjs --w 1920 --h 1080` | `verify/report.md` + frames | no |
| 9 | Cover | `node scripts/86_pv_cover.mjs --only D` | `cover/*.jpg` | no |
| 10 | Upscale (Real-ESRGAN) | `node scripts/87_pv_upscale.mjs` | `…_1080p.mp4` | no (slow) |

Stage 2 is deliberately out of scope: separation, transcription, vocal synthesis and mixing are their own problem, with their own tools. This repository owns **video line + the decisions that bind it to music** (timing, cost, verification, non-destructiveness).

Every script takes `--plan`: it prints exactly what it would do and what it would cost, writes nothing, and sends nothing. **Use `--plan` first, always.**

---

## Quick start

### 0. Install

The video pipeline itself has **no package dependencies** — every script is a standalone `.mjs` file. What you need are a few external binaries.

| Dependency | Needed for | Required? |
|---|---|---|
| **Node.js ≥ 18** (tested on 24) | every script | **yes** |
| **FFmpeg + ffprobe** | alignment, reference images, subtitles, assemble, verify | **yes** |
| **A video-generation API key** | shot generation — the only paid stage | only for stage 5 |
| **Real-ESRGAN ncnn-vulkan** | free local upscale | optional |
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

Set it permanently, or put `"ffmpegDir": "…/bin"` in the config. The resolver order is: `FANFILL_FFMPEG_DIR` → `video.ffmpegDir` → a legacy hard path → bare `ffmpeg` on `PATH`, and it prints a one-time notice when it falls back.

Full, step-by-step setup — including the DSH skill/preset/panel wiring and the video driver — is in **[docs/INSTALL.md](docs/INSTALL.md)**.

### Let an agent do the install

This repo is meant to be driven by a coding agent. Paste this into a fresh session **in the cloned directory**:

```
Read docs/BOOTSTRAP.md and install this project for me, following it step by step.
Verify each step with the command it gives, stop and ask me only for things you
cannot do yourself (the API key, and restarting dsh web if needed).
When you finish, run `node tools/smoke-test.mjs` and report the result.
```

`docs/BOOTSTRAP.md` is written for that: every step has an exact command, an expected result, and a fallback. A shorter form that also works:

```
Install fanfill-video-pipeline from the README: check Node and ffmpeg, set
FANFILL_FFMPEG_DIR to a real ffmpeg (not the ImageMagick one), then run
node tools/smoke-test.mjs and tell me what it says.
```

Python is **not** required for anything in this repository.

Environment variables this repo understands:

| Variable | Meaning | Default |
|---|---|---|
| `FANFILL_FFMPEG_DIR` | directory containing `ffmpeg` / `ffprobe` | a legacy hard path, then `PATH` |
| `FANFILL_H3` | absolute path to the video driver `h3.mjs` | `<workspace>/tools/minimax-h3/h3.mjs` |
| `FANFILL_MAGICK` | `magick` binary for cover layouts | a legacy hard path |
| `FANFILL_WORKSPACE` | workspace to inspect, for `tools/*.mjs` | the current directory |

### 1. Make a workspace

One song = one workspace directory. The repository *is* the workspace root:

```bash
git clone https://github.com/gychen-NJU/fanfill-video-pipeline my-song
cd my-song
mkdir -p 01_input 02_stems 03_midi 04_lyrics 05_vocals 06_svc 07_mix 08_release 10_video _进度
```

### 2. Write the project config

`翻填项目.json` is the **single source of parameter truth** — no script hardcodes the song name, total length, segment count or resolution. The filename is fixed (the scripts look for it); the field *values* are yours.

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

Only `video.dir` is required inside `video`; the nine output sub-directories default to `<video.dir>/<name>`. Full field reference: [`docs/08_project-config-spec.md`](docs/08_project-config-spec.md).

### 3. Run the free stages

```bash
node scripts/80_pv_shotlist.mjs --plan    # read-only rehearsal
node scripts/80_pv_shotlist.mjs           # writes the shot list
node scripts/80b_check_prompts.mjs        # prompt lint
node scripts/87_pv_upscale.mjs --plan
```

If you have no cuts yet, `80` can start from a rough boundary list and will snap them into silence valleys itself:

```bash
node scripts/80_pv_shotlist.mjs --boundaries 0,12,24,36
```

### 4. Wire it into DeepSeek Harness (optional)

```bash
mkdir -p .agents/skills
cp -r skills/fanfill-video-pipeline .agents/skills/     # hot-reloaded, no restart
```

The panel and preset are two rows appended to your DSH profile patch — see [`docs/INSTALL.md`](docs/INSTALL.md) §2, which explains why the two absolute paths must be edited. What the panel does, how to customise its stage list, and the trust model it enforces: [`docs/09_workbench.md`](docs/09_workbench.md) (中文).

---

## Hard constraints (learned the hard way)

These are not style preferences — each one cost real time or real money:

| Constraint | Why |
|---|---|
| **A prompt is capped at 7000 characters** | API hard limit. |
| **Reference images and a first-frame image are mutually exclusive** | Want "reference *and* continuity"? Use **Ref2VA for the opening shot, then chain each later shot from the previous clip's last frame.** |
| **Reference-image routing must go through the video model's Ref2VA mode** | The image model's `subject_reference` accepts only publicly reachable URLs; a local file cannot be referenced. |
| **Never extract frames from the finished film** | It already has burned-in subtitles. Extract from the per-shot clips. |
| **Re-burn subtitles at the target resolution** | Scaling a video that already has subtitles baked in scales the text too. |
| **Real upscaling ≠ resampling** | Lanczos / a DAW resample makes a *bigger file*, not a *sharper picture*. Use Real-ESRGAN. |
| **Measure onsets, don't trust the lyric file** | Nominal timestamps drift; a cut on a wrong timestamp slices a word. |
| **Use absolute paths for ffmpeg** | A bundled ImageMagick `ffmpeg` on `PATH` will shadow the real one. |
| **Write `.mjs` files; never `node -e`** | PowerShell 5.1 eats inline scripts. |
| **Read and write files containing non-ASCII with Node** | A PowerShell `Get-Content` → `ConvertFrom-Json` round-trip will silently corrupt UTF-8. |
| **One shot ≤ `segMaxSec` (default 15 s)** | Model limit; longer clips also drift more. |
| **Subtitles hold for a minimum time (default 3 s)** | Below that the line is unreadable. |

## Discipline the pipeline assumes

- **Non-destructive by default.** Inputs are read-only. Replaced outputs move to `history/<timestamp>/` with a README; new outputs get `vN` names. Never overwrite.
- **One authorization, then a ledger.** Ask once for a budget; record every charge; stop only when the estimate would exceed the budget. Do not ask per step.
- **Quality-type acceptance needs a 1:1 comparison.** If the ask is "sharper" / "better", a passing spec sheet is not delivery — produce same-frame / same-passage A/B evidence.
- **Absolute paths, then stop for review.** Hand over what to look at, then wait.
- **Local-first.** Upscaling, separation and mixing run on your own machine for free.
- **Attribution is a blocker, not a nicety.** Finished work carries an AI-generated notice, a non-commercial notice, and full credit to the original work.

---

## Layout

```
fanfill-video-pipeline/
├── skills/fanfill-video-pipeline/   # the SOP: SKILL.md + references/01..08
├── scripts/                          # 80–87 + 80b + lib/fanfill-config.mjs
├── drivers/minimax-h3/               # dependency-free video-gen driver + MCP server
├── ui-workbench/                     # DSH UI plugin (guided pipeline panel)
├── agent-preset/                     # DSH agent preset
├── tools/                            # reuse checks (smoke + cross-song genericity)
├── examples/                         # artefacts from ONE real run, for reference
├── docs/                             # install guide, config spec, deep dives
├── notes/                            # how this pipeline was built (background, not a guide)
└── index.html                        # bilingual docs site (GitHub Pages)
```

## What is and is not verified

Honesty matters more than a green checkmark.

**Verified**
- The full pipeline ran end to end and produced a delivered PV; the verification report was reproduced byte-for-byte after the scripts were parameterised.
- The shot-list script, re-run after refactoring, reproduced the delivered shot list **byte-for-byte** (cut boundaries, generated seconds, cost estimate, lyric timing CSV).
- **Cross-song genericity:** `tools/gensong-test.mjs` builds a throwaway workspace with deliberately different parameters (different name, length, BPM, aspect ratio, output directory, shot cap) and runs the shot-list stage in it with zero errors, honouring every config value.
- Non-destructiveness: the read-only zones' content fingerprints are identical before and after a full run.
- **The workbench panel (v2)** — guided 7-stage pipeline: per-stage material slots you can upload or point at existing files, whitelisted local runs with live logs, one-click hand-off of a stage to the agent in the current chat, plus a chat dock. Verified by two headless suites (`118` host assertions and `30` client-render assertions, both including adversarial regressions), and the v1 snapshot contract is unchanged (the repo's own `tools/smoke-test.mjs` still passes all 13 assertions against v2). A paid action is refused by the host outright, and any command that comes from the per-song override file is marked untrusted and always asks for confirmation.

**Not verified — treat as untested**
- **The v2 workbench in a real browser** (its own click paths, uploads, and light/dark themes): the two suites above drive it headlessly (they do catch render and wiring errors); the browser pass had not been re-run at the time of writing. The v1 panel *was* browser-verified (five tabs, 0 console errors).
- **Light/dark theme rendering** of the panel. Styles use theme tokens exclusively (checked rule by rule), but only the dark theme was actually screenshotted.
- **The 2K paid path**, dissolve transitions, and the `L2VA` / `<Video N>` / `<Audio N>` prompt forms were never used in the reference run.
- **Which upscaling model was actually used** — no argument log survives; the script default is recorded, not measured.
- The audio master in the reference run had true peak above the target; the delivery masters passed. Whether that matters for your material is a judgement call, not a setting.

See [`examples/`](examples/) for the raw evidence behind every claim above.

## License

Pipeline code is [MIT licensed](LICENSE) — use it, fork it, ship it.

**Assets are not included, and the MIT license does not cover them.** Any third-party art, audio or video you feed in or produce is your responsibility. `examples/` contains only text: configuration, metrics and ledger entries, published for documentation value.

If you publish anything built with this pipeline, mark it as AI-generated, non-commercial, and credit the original work. That is not optional in the workflow this repo encodes — the skill treats it as a delivery blocker.
