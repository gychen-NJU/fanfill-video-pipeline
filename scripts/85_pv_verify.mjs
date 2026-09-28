#!/usr/bin/env node
/**
 * 85_pv_verify.mjs —— P5：成片核验报告（对照计划 §11 的 7 条验收标准）
 * ---------------------------------------------------------------------------
 * 1. 时长/帧率/分辨率/编码      —— 期望值来自 `song.totalSec` / `video.baseSize` / `song.fps`
 * 2. 音轨：响度与真峰值          —— 阈值来自 `audio.loudness`（iLufs / toleranceLufs / truePeakDbtp）
 * 3. 指定画面抽帧（人眼复核）    —— 时间点与理由来自 `video.mandated`
 * 4. 字幕：歌词是否齐全、字体是否单一 —— 读 `song.name` 对应的 .ass
 * 5. 原创性：每 4s 抽帧 vs 该段参考图，最大 SSIM < 0.90 —— 参考图取 segments.json 每段的 `refs`
 * 6. 接缝：相邻段末帧/首帧 SSIM —— **链式接点** = segments.json 里 `chainFrom != null` 的段，
 *    门槛来自 `video.chainedThreshold`（默认 0.60）
 * 7. 输出 `verifyDir/report.md` + 抽帧图（同名旧报告先归档到 history/）
 *
 * **配置化**：核验对象默认取 `video.deliverables.pv1080p` → `pv` 中首个存在的文件（也可 --video 指定）。
 *
 * 用法：
 *   node scripts/85_pv_verify.mjs --plan                       # 只打印将要做的事（不写产物）
 *   node scripts/85_pv_verify.mjs --w <宽> --h <高>            # 核验指定分辨率的成片
 *   node scripts/85_pv_verify.mjs --video <成片路径>            # 显式指定要核验的文件
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  loadConfig, loadSegments, parseArgv, log, run, ensureDirs, finishPlan, nonClobber, pad2, FFMPEG, FFPROBE,
} from './lib/fanfill-config.mjs'

const { arg, plan: PLAN_ONLY } = parseArgv()
const ROOT = process.cwd()
const cfg = loadConfig(ROOT)

// ── 核验对象与期望值：全部来自配置 ──────────────────────────────────────────
const DELIV = cfg.raw.video.deliverables || {}
const delivered = [DELIV.pv1080p, DELIV.pv].filter((p) => typeof p === 'string' && p)
const auto = delivered.map((p) => cfg.abs(p)).find((p) => fs.existsSync(p)) || (delivered[0] ? cfg.abs(delivered[0]) : null)
const VIDEO = arg('video', '') ? path.resolve(ROOT, arg('video', '')) : auto
const [BASE_W, BASE_H] = cfg.delivery.baseSize
const EXP_W = Number(arg('w', BASE_W))
const EXP_H = Number(arg('h', BASE_H))
const TOTAL = Number(cfg.raw.song.totalSec)
const TOL_SEC = 0.05
const FPS = Number(cfg.raw.song.fps)
const LOUD = cfg.raw.audio.loudness || {}
const I_LUFS = Number(LOUD.iLufs ?? -14)
const TOL_LUFS = Number(LOUD.toleranceLufs ?? 1)
const TP_DBTP = Number(LOUD.truePeakDbtp ?? -1)
const CHAIN_TH = Number(cfg.raw.video.chainedThreshold ?? 0.60)
const ASS = path.join(cfg.dirs.subs, `${cfg.raw.song.name}.ass`)
const VERIFY = cfg.dirs.verify
const SSIM_W = Math.round(BASE_W / 2)   // 统一降采样后比 SSIM（减少编码噪声干扰）
const SSIM_H = Math.round(BASE_H / 2)
const SAMPLE_EVERY = 4                  // 每 4 秒抽 1 帧做原创性抽样

/** 子进程：spawn 失败不抛，统一成 code=-1（错误要响，不要静默） */
async function tryRun(cmd, args, timeoutMs) {
  try { return await run(cmd, args, { timeoutMs }) } catch (e) { return { code: -1, stdout: '', stderr: String(e.message) } }
}

// ── 覆盖前归档（非破坏性红线：旧报告/旧抽帧 → history/<时间戳>/）────────────
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
    fs.writeFileSync(readme, `# 归档 ${stamp}\n\n- 原因：${reason}\n- 说明：这些产物在本次运行中被重新生成，旧版本先移到这里（非破坏性，未删除）。\n\n`
      + moved.map((m) => `- \`${path.basename(m)}\``).join('\n') + '\n', 'utf8')
  }
  log(`归档 ${moved.length} 个旧产物 → ${path.relative(ROOT, dir)}（${reason}）`)
  return moved
}

if (!VIDEO) { log(`❌ 配置里没有可核验的成片：请设置 video.deliverables.pv / pv1080p，或用 --video 指定`); process.exit(2) }
if (!fs.existsSync(VIDEO)) { log(`❌ 成片不存在：${VIDEO}（先跑 scripts/84_pv_assemble.mjs，或用 --video 指定）`); process.exit(2) }
if (!fs.existsSync(ASS)) { log(`❌ 字幕不存在：${ASS}（先跑 scripts/83_pv_subs.mjs）`); process.exit(2) }

// ── 分镜：链式接点与参考图都从这里推导 ──────────────────────────────────────
const { data: segData, segments: segs } = loadSegments(cfg)
const CHAINED = new Set(segs.filter((s) => s.chainFrom != null).map((s) => s.idx))
const refsOf = new Map(segs.map((s) => [s.idx, Array.isArray(s.refs) ? s.refs : []]))
const MANDATED = Array.isArray(cfg.raw.video.mandated) ? cfg.raw.video.mandated : []

// ── --plan：只打印 ──────────────────────────────────────────────────────────
if (PLAN_ONLY) {
  console.log(`核验对象：${path.relative(ROOT, VIDEO)}${arg('video', '') ? '（--video 指定）' : '（deliverables.pv1080p → pv 中首个存在者）'}`)
  console.log(`期望规格：${EXP_W}x${EXP_H} @${FPS}fps，时长 ${TOTAL} ±${TOL_SEC}s，h264 + aac`)
  console.log(`响度阈值：I = ${I_LUFS} ±${TOL_LUFS} LUFS，TP ≤ ${TP_DBTP} dBTP（audio.loudness）`)
  console.log(`字幕：${path.relative(ROOT, ASS)}（歌词齐全性 + 字体单一）`)
  console.log(`原创性：每 ${SAMPLE_EVERY}s 抽 1 帧 vs 该段 refs 里的参考图，最大 SSIM < 0.90（降采样 ${SSIM_W}x${SSIM_H}）`)
  console.log(`接缝：${segs.length - 1} 个接点，其中**链式接点** ${[...CHAINED].sort((a, b) => a - b).join('、') || '（无）'}（由 segments.json 的 chainFrom 推导）要求 SSIM ≥ ${CHAIN_TH}`)
  console.log(`指定画面抽帧：${MANDATED.length} 处`)
  for (const m of MANDATED) {
    const s = segs.find((x) => x.idx === m.segIdx)
    console.log(`  · ${m.sec}s（段 ${m.segIdx} ${s ? s.slug : '?'}）：${m.note}`)
  }
  console.log(`将写出：${path.relative(ROOT, VERIFY)}/report.md + mandated_*.jpg + samples/*.jpg + _j*_{last,first}.jpg`)
  console.log('  同名旧报告与旧抽帧不覆盖：先归档到 history/<时间戳>/ 再写新的。')
  finishPlan([
    { label: `${path.relative(ROOT, VERIFY)}/report.md`, detail: `7 项验收（规格 / 响度 / 抽帧 / 字幕 / 原创性 / 接缝 / 结论）`, cny: 0 },
    { label: `抽帧图：mandated ${MANDATED.length} 张 + 抽样 ~${Math.round(TOTAL / SAMPLE_EVERY)} 张 + 接缝 ${(segs.length - 1) * 2} 张`, detail: '本地 ffmpeg，纯读取', cny: 0 },
  ], cfg, { title: '85 核验（纯本地，不花钱）' })
}

const ssim = async (a, b, w = SSIM_W, h = SSIM_H) => {
  const r = await tryRun(FFMPEG, ['-hide_banner', '-i', a, '-i', b,
    '-lavfi', `[0:v]scale=${w}:${h}[x];[1:v]scale=${w}:${h}[y];[x][y]ssim`, '-f', 'null', 'NUL'], 120000)
  const m = (r.stderr || '').match(/All:([0-9.]+)/)
  return m ? Number(m[1]) : null
}
const extract = async (args, out) => {
  const r = await tryRun(FFMPEG, ['-y', '-v', 'error', ...args, '-frames:v', '1', '-q:v', '2', out], 120000)
  if (r.code !== 0) log(`⚠ 抽帧失败 ${out}：${String(r.stderr).slice(0, 160)}`)
  return r.code === 0 && fs.existsSync(out)
}

const report = []
const problems = []
ensureDirs(VERIFY, cfg.dirs.history)
// 清掉本次会重写的旧文件（含旧的 samples 目录，避免旧帧混进抽样）
const stale = fs.readdirSync(VERIFY).filter((f) =>
  f === 'report.md' || f === 'samples' || /^mandated_.*\.jpg$/.test(f) || /^_j\d+_(last|first)\.jpg$/.test(f))
archiveOld(stale.map((f) => path.join(VERIFY, f)), '85 重新核验（报告与抽帧）')

// ── 1. 基本规格 ─────────────────────────────────────────────────────────────
const pr = await tryRun(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate',
  '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels',
  '-of', 'json', VIDEO], 120000)
if (pr.code !== 0) { log(`❌ ffprobe 读取失败：${path.relative(ROOT, VIDEO)}\n${String(pr.stderr).slice(0, 300)}`); process.exit(2) }
const info = JSON.parse(pr.stdout)
const v = (info.streams || []).find((s) => s.codec_type === 'video')
const a = (info.streams || []).find((s) => s.codec_type === 'audio')
const dur = Number(info.format.duration)
report.push('# PV 成片核验报告', '')
report.push(`- 文件：\`${path.relative(ROOT, VIDEO)}\``)
report.push(`- 生成：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`)
report.push(`- 大小：${(info.format.size / 1048576).toFixed(1)} MB｜码率 ${(info.format.bit_rate / 1000).toFixed(0)} kbps`, '')
report.push('## 1. 基本规格', '', '| 项 | 实测 | 要求 | 结论 |', '|---|---|---|---|')
const chk = (name, got, want, ok) => { report.push(`| ${name} | ${got} | ${want} | ${ok ? '✅' : '❌'} |`); if (!ok) problems.push(`${name}: ${got}（要求 ${want}）`) }
chk('时长', dur.toFixed(3) + 's', `${TOTAL} ±${TOL_SEC}s`, Math.abs(dur - TOTAL) <= TOL_SEC)
chk('分辨率', `${v.width}x${v.height}`, `${EXP_W}x${EXP_H}`, v.width === EXP_W && v.height === EXP_H)
chk('帧率', v.r_frame_rate, `${FPS}/1`, v.r_frame_rate === `${FPS}/1`)
chk('视频编码', v.codec_name, 'h264', v.codec_name === 'h264')
chk('音频编码', a ? a.codec_name : '(无)', 'aac', !!a && a.codec_name === 'aac')

// ── 2. 响度 ─────────────────────────────────────────────────────────────────
const lr = await tryRun(FFMPEG, ['-hide_banner', '-i', VIDEO, '-af', 'ebur128=peak=true', '-f', 'null', 'NUL'], 600000)
const ltxt = lr.stderr || ''
// 注意：逐帧日志里也有 "I: ..."（起始静音时是 -70），必须只取最后的**汇总块**
const iM = ltxt.match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+)\s*LUFS/)
const tpM = ltxt.match(/True peak:\s*\n\s*Peak:\s*(-?[\d.]+)\s*dBFS/)
const I = iM ? Number(iM[1]) : null
const TP = tpM ? Number(tpM[1]) : null
report.push('', '## 2. 响度', '', '| 项 | 实测 | 要求 | 结论 |', '|---|---|---|---|')
chk('整体响度 I', I != null ? I + ' LUFS' : '未取到', `${I_LUFS} ±${TOL_LUFS} LUFS`, I != null && Math.abs(I - I_LUFS) <= TOL_LUFS)
chk('真峰值 TP', TP != null ? TP + ' dBFS' : '未取到', `≤ ${TP_DBTP} dBTP`, TP != null && TP <= TP_DBTP)

// ── 3. 指定画面抽帧 ─────────────────────────────────────────────────────────
report.push('', '## 3. 指定画面抽帧（人眼复核用）', '')
if (!MANDATED.length) report.push('- （`video.mandated` 未配置，跳过）')
for (const m of MANDATED) {
  const out = path.join(VERIFY, `mandated_${m.sec}s.jpg`)
  await extract(['-ss', String(m.sec), '-i', VIDEO], out)
  const byTime = segs.find((s) => m.sec >= s.start && m.sec < s.end)
  const seg = segs.find((s) => s.idx === m.segIdx) || byTime
  report.push(`- ${m.sec}s（段${seg ? seg.idx : '?'} ${seg ? seg.slug : ''}）：${m.note} → \`verify/${path.basename(out)}\``)
  if (m.segIdx != null && byTime && byTime.idx !== m.segIdx) {
    const msg = `video.mandated 的 ${m.sec}s 声明段 ${m.segIdx}，但按 segments.json 的时间轴它落在段 ${byTime.idx}（配置与分镜已不同步）`
    problems.push(msg)
    report.push(`  - ❌ ${msg}`)
  }
}

// ── 4. 字幕 ─────────────────────────────────────────────────────────────────
report.push('', '## 4. 字幕', '')
const assText = fs.readFileSync(ASS, 'utf8')
const lyrics = (segData.lrc && segData.lrc.lyrics) || []
const styles = [...assText.matchAll(/^Style:\s*([^,]+),([^,]+)/gm)].map((m) => `${m[1]}/${m[2]}`)
const missingLines = lyrics.filter((L) => !assText.includes(L.text))
chk('歌词行数', `${lyrics.length - missingLines.length}/${lyrics.length}`, '全部出现', missingLines.length === 0)
chk('字体一致性', [...new Set(styles.map((s) => s.split('/')[1]))].join(','), '单一字体', new Set(styles.map((s) => s.split('/')[1])).size === 1)
report.push(`- 样式：${styles.join('、')}`)
if (missingLines.length) report.push(`- ❌ 缺失：${missingLines.map((m) => m.text).join(' / ')}`)

// ── 5. 原创性（抽帧 vs 参考图）──────────────────────────────────────────────
report.push('', '## 5. 原创性（成片帧 vs 参考原图，SSIM 越低越"二创"）', '')
const sampleDir = path.join(VERIFY, 'samples')
await fsp.mkdir(sampleDir, { recursive: true })
const sr = await tryRun(FFMPEG, ['-y', '-v', 'error', '-i', VIDEO, '-vf', `fps=1/${SAMPLE_EVERY}`, '-q:v', '3', path.join(sampleDir, 'f_%03d.jpg')], 600000)
if (sr.code !== 0) log(`⚠ 抽样抽帧失败：${String(sr.stderr).slice(0, 200)}`)
const frames = fs.readdirSync(sampleDir).filter((f) => f.endsWith('.jpg')).sort()
let worst = { ssim: 0, frame: '', ref: '', at: 0 }
let compared = 0
for (const f of frames) {
  const idxNum = Number(f.match(/_(\d+)\./)[1])
  const at = (idxNum - 1) * SAMPLE_EVERY + SAMPLE_EVERY / 2
  const seg = segs.find((s) => at >= s.start && at < s.end)
  if (!seg) continue
  for (const rf of (refsOf.get(seg.idx) || [])) {
    const s = await ssim(path.join(sampleDir, f), path.join(cfg.dirs.refs, rf))
    compared++
    if (s != null && s > worst.ssim) worst = { ssim: s, frame: f, ref: rf, at }
  }
}
chk('抽样最大 SSIM', worst.ssim ? worst.ssim.toFixed(3) + `（${worst.at}s vs ${worst.ref}）` : '未取到', '< 0.90', worst.ssim > 0 && worst.ssim < 0.90)
report.push(`- 抽样 ${frames.length} 帧（每 ${SAMPLE_EVERY} 秒 1 帧），逐帧与其所属段的参考图比较`)
log(`原创性比对：${frames.length} 帧 × 各自段参考图，共 ${compared} 次 SSIM`)

// ── 6. 接缝连续性 ───────────────────────────────────────────────────────────
report.push('', '## 6. 段间接缝（相邻段末帧 / 首帧 SSIM）', '', '| 接点 | 类型 | 末帧 | 首帧 | SSIM | 结论 |', '|---|---|---|---|---|---|')
for (let i = 1; i < segs.length; i++) {
  const A = segs[i - 1], B = segs[i]
  const aF = path.join(VERIFY, `_j${A.idx}_last.jpg`), bF = path.join(VERIFY, `_j${B.idx}_first.jpg`)
  await extract(['-sseof', '-0.2', '-i', path.join(cfg.dirs.clips, `${pad2(A.idx)}_${A.slug}.mp4`)], aF)
  await extract(['-ss', '0.05', '-i', path.join(cfg.dirs.clips, `${pad2(B.idx)}_${B.slug}.mp4`)], bF)
  const s = fs.existsSync(aF) && fs.existsSync(bF) ? await ssim(aF, bF) : null
  const isChain = CHAINED.has(B.idx)
  const ok = s == null ? false : (isChain ? s >= CHAIN_TH : true)
  report.push(`| ${A.idx}→${B.idx} | ${isChain ? '链式衔接' : B.trans === 'xfade' ? '转场' : '硬切'} | ${A.slug} | ${B.slug} | ${s != null ? s.toFixed(3) : '—'} | ${ok ? '✅' : '❌'} |`)
  if (isChain && !ok) problems.push(`链式接点 ${A.idx}→${B.idx} SSIM ${s != null ? s.toFixed(3) : '—'} < ${CHAIN_TH}`)
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
report.push('', '## 7. 结论', '')
report.push(problems.length ? problems.map((p) => `- ❌ ${p}`).join('\n') : '- ✅ 全部通过')
const REPORT = path.join(VERIFY, 'report.md')
archiveOld([REPORT], '85 重新生成核验报告')
await fsp.writeFile(REPORT, report.join('\n'), 'utf8')

console.log(report.join('\n'))
console.log('')
console.log(problems.length ? `❌ ${problems.length} 项未达标` : '✅ 全部验收项通过')
console.log(`报告：${path.relative(ROOT, REPORT)}`)
if (problems.length) process.exitCode = 1
