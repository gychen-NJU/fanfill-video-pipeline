#!/usr/bin/env node
/**
 * 84_pv_assemble.mjs —— P4：把全部分镜成片合成为完整 PV
 * ---------------------------------------------------------------------------
 * 步骤：
 *   1. 归一化：每段缩放/补边到 `video.baseSize` @`song.fps`，丢弃 H3 自带音轨，按分镜**精确裁到段长**
 *      （不足则用 tpad 冻最后一帧补足）
 *   2. 拼接：concat 直拼（硬切）→ 时间轴与 LRC 严格对齐
 *   3. 烧字幕：ass 滤镜烧录歌词 + 片头三卡 + 片尾署名
 *   4. 混音：用 `audio.master`，按 `audio.loudness` 做 loudnorm
 *
 * **配置化**：目录 `video.*Dir`、母版 `audio.master`、画幅 `video.baseSize`、帧率 `song.fps`、
 *   响度 `audio.loudness`、字幕文件名 `song.name`。本脚本对歌名/分辨率/帧率**零硬编码**。
 *
 * 用法：
 *   node scripts/84_pv_assemble.mjs --plan                 # 只打印将要做的事（不写产物）
 *   node scripts/84_pv_assemble.mjs                        # 合成默认成片（<歌名>_PV_v1.mp4）
 *   node scripts/84_pv_assemble.mjs --out xx.mp4 --ass <subDir>/<歌名>_<标签>.ass
 *   node scripts/84_pv_assemble.mjs --from-timeline        # 只重做字幕与混音
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  loadConfig, loadSegments, parseArgv, log, run, ensureDirs, finishPlan, nonClobber, pad2,
  FFMPEG,
} from './lib/fanfill-config.mjs'

const { arg, has, plan: PLAN_ONLY } = parseArgv()
const ROOT = process.cwd()
const cfg = loadConfig(ROOT)

// ── 路径与参数：全部来自配置 ────────────────────────────────────────────────
const PV = path.dirname(cfg.dirs.clips)                 // PV 根（.norm 等中间产物落这里）
const NORM = path.join(PV, '.norm')
const AUDIO = cfg.abs(cfg.raw.audio.master)
const ASS = path.join(cfg.dirs.subs, `${cfg.raw.song.name}.ass`)
const [W, H] = cfg.delivery.baseSize
const FPS = Number(cfg.raw.song.fps)
const LOUD = cfg.raw.audio.loudness || {}
const I_LUFS = Number(LOUD.iLufs ?? -14)
const TP_DBTP = Number(LOUD.truePeakDbtp ?? -1)

const OUT = path.resolve(PV, arg('out', `${cfg.raw.song.name}_PV_v1.mp4`))
const ASS_OVERRIDE = arg('ass', '')   // 交付分辨率版用 --ass 指向对应画布的字幕
const TIMELINE_OVERRIDE = arg('timeline', '')
const dryRun = has('dry-run')

/** 子进程：spawn 失败不抛，统一成 code=-1（错误要响，不要静默） */
async function tryRun(cmd, args, timeoutMs) {
  try { return await run(cmd, args, { timeoutMs }) } catch (e) { return { code: -1, stdout: '', stderr: String(e.message) } }
}

// ── 覆盖前归档（非破坏性红线：旧产物 → history/<时间戳>/）────────────────────
function archiveOld(files, reason) {
  const alive = [].concat(files).filter((f) => f && fs.existsSync(f))
  if (!alive.length) return []
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
  const dir = path.join(cfg.dirs.history, stamp)
  ensureDirs(dir)
  const moved = alive.map((f) => {
    const dest = nonClobber(path.join(dir, path.basename(f)))
    fs.renameSync(f, dest)
    return dest
  })
  const readme = path.join(dir, 'README.md')
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, `# 归档 ${stamp}\n\n- 原因：${reason}\n- 说明：这些产物在本次运行中被替换，旧版本先移到这里（非破坏性，未删除）。\n\n`
      + moved.map((m) => `- \`${path.basename(m)}\``).join('\n') + '\n', 'utf8')
  }
  log(`归档 ${moved.length} 个旧产物 → ${path.relative(ROOT, dir)}（${reason}）`)
  return moved
}

// ── 载入 ────────────────────────────────────────────────────────────────────
const { data: segData, segments: segs } = loadSegments(cfg)
const TOTAL = Number(segData.audio?.duration) || Number(cfg.raw.song.totalSec)

const missing = []
for (const s of segs) {
  s.file = path.join(cfg.dirs.clips, `${pad2(s.idx)}_${s.slug}.mp4`)
  if (!fs.existsSync(s.file)) missing.push(s.idx)
}
if (missing.length) { log(`❌ 缺成片：段 ${missing.join(',')}；先跑 scripts/82_pv_clips.mjs`); process.exit(1) }
const ASS_USED = ASS_OVERRIDE ? path.resolve(ROOT, ASS_OVERRIDE) : ASS
if (!fs.existsSync(ASS_USED)) { log(`❌ 缺字幕：${ASS_USED}；先跑 scripts/83_pv_subs.mjs`); process.exit(1) }
if (!AUDIO || !fs.existsSync(AUDIO)) { log(`❌ 缺母版音频：${AUDIO || cfg.raw.audio.master}（配置 audio.master）`); process.exit(1) }

const rough = TIMELINE_OVERRIDE ? path.resolve(ROOT, TIMELINE_OVERRIDE) : path.join(NORM, 'timeline.mp4')

log(`合成 ${segs.length} 段 → 目标时长 ${TOTAL}s（${(TOTAL / 60).toFixed(2)} 分钟）`)

// ── --plan：只打印 ──────────────────────────────────────────────────────────
if (PLAN_ONLY) {
  console.log('')
  console.log(`配置：${path.relative(ROOT, cfg.configPath)}｜歌：${cfg.raw.song.name}`)
  console.log(`输入：${path.relative(ROOT, cfg.dirs.clips)}/（${segs.length} 段成片齐全）`)
  console.log(`字幕：${path.relative(ROOT, ASS_USED)}${ASS_OVERRIDE ? '（--ass 指定）' : ''}`)
  console.log(`母版：${path.relative(ROOT, AUDIO)}｜响度 loudnorm I=${I_LUFS} TP=${TP_DBTP}（audio.loudness）`)
  console.log(`画布：${W}x${H} @${FPS}fps（video.baseSize / song.fps）｜时长 ${TOTAL}s`)
  console.log(`输出：${path.relative(ROOT, OUT)}`)
  console.log(`中间：${path.relative(ROOT, NORM)}/{NN.mp4,concat.txt,timeline.mp4}（脚本缓存区，可重算）`)
  if (has('from-timeline')) console.log(`--from-timeline：跳过归一化与拼接，直接用 ${path.relative(ROOT, rough)}`)
  console.log('  同名旧成片不覆盖：先归档到 history/<时间戳>/ 再写新的。')
  finishPlan([
    { label: `归一化 + 拼接 + 烧字幕 + 混音 → ${path.relative(ROOT, OUT)}`, detail: `${segs.length} 段 × ${W}x${H}@${FPS}fps；libx264 crf17 + aac 320k`, cny: 0 },
  ], cfg, { title: '84 合成（纯本地，不花钱）' })
}

if (dryRun) {
  console.log('段  起-止            段长    成片时长')
  for (const s of segs) console.log(`${String(s.idx).padStart(2)}  ${String(s.start).padStart(7)}-${String(s.end).padStart(7)}  ${String(s.dur).padStart(6)}s  ${s.file.split(path.sep).pop()}`)
  process.exit(0)
}

ensureDirs(NORM, path.dirname(OUT), cfg.dirs.history)

const fromTimeline = has('from-timeline')
if (fromTimeline) {
  if (!fs.existsSync(rough)) { log(`❌ --from-timeline 需要已存在的 ${path.relative(ROOT, rough)}`); process.exit(1) }
  log('跳过归一化与拼接，直接从已拼接时间轴继续（只重做字幕与混音）')
} else {
  // ── 1) 归一化 + 精确裁切 ──────────────────────────────────────────────────
  for (const s of segs) {
    const out = path.join(NORM, `${pad2(s.idx)}.mp4`)
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=${FPS},setsar=1,tpad=stop_mode=clone:stop_duration=3`
    const r = await tryRun(FFMPEG, ['-y', '-v', 'error', '-i', s.file, '-an', '-vf', vf,
      '-t', s.dur.toFixed(3), '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', out], 3600000)
    if (r.code !== 0) { log(`❌ 段 ${s.idx} 归一化失败：${String(r.stderr).slice(0, 200)}`); process.exit(1) }
    log(`段 ${s.idx} 归一化 → ${s.dur}s`)
  }

  // ── 2) 拼接 ───────────────────────────────────────────────────────────────
  const listFile = path.join(NORM, 'concat.txt')
  await fsp.writeFile(listFile, segs.map((s) => `file '${path.join(NORM, `${pad2(s.idx)}.mp4`).replace(/\\/g, '/')}'`).join('\n') + '\n', 'utf8')
  {
    const r = await tryRun(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', rough], 3600000)
    if (r.code !== 0) { log(`❌ 拼接失败：${String(r.stderr).slice(0, 300)}`); process.exit(1) }
  }
  log('拼接完成')
}

// ── 3+4) 烧字幕 + 混音 ──────────────────────────────────────────────────────
const assFilter = `ass='${ASS_USED.replace(/\\/g, '/').replace(/:/g, '\\:')}'`
const filter = `[0:v]${assFilter}[v]`
archiveOld([OUT], `84 重新合成成片 ${path.basename(OUT)}`)
const r = await tryRun(FFMPEG, [
  '-y', '-v', 'error',
  '-i', rough,
  '-i', AUDIO,
  '-filter_complex', `${filter};[1:a]loudnorm=I=${I_LUFS}:TP=${TP_DBTP}:LRA=11[a]`,
  '-map', '[v]', '-map', '[a]',
  '-t', TOTAL.toFixed(3),
  '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '320k',
  '-movflags', '+faststart',
  OUT,
], 3600000)
if (r.code !== 0) { log(`❌ 合成失败：${String(r.stderr).slice(0, 400)}`); process.exit(1) }

const st = fs.statSync(OUT)
log(`✅ 成片：${path.relative(ROOT, OUT)}（${(st.size / 1048576).toFixed(1)} MB）`)
log(`   下一步核验：node scripts/85_pv_verify.mjs`)
