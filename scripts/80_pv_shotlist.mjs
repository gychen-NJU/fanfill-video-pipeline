#!/usr/bin/env node
/**
 * 80_pv_shotlist.mjs —— PV 流水线 P0：对齐预检 + 分镜切分 + 成本估算（零成本，不出片）
 * ---------------------------------------------------------------------------
 * 做四件事：
 *   ① 解析 LRC：区分 [ti:]/[ar:] 元信息、**带时间码的曲目信息行**（正好铺满前奏）、真正的歌词行
 *   ② 从**人声轨**提取 RMS 包络做 VAD，得到每句歌词的真实发声区间
 *   ③ 按分镜边界切分，并**验证**：每段 ≤ segMaxSec、歌词句零切断、边界落在真实停顿里、无缝铺满全曲
 *   ④ 产出 segments.json / shotlist.csv / alignment_report.md / cost_estimate.md / lyrics_timing.* / prompt 骨架
 *
 * **配置化**：一切歌相关参数来自 `翻填项目.json`（见 00_docs/08_翻填项目配置规范.md），
 * 本脚本对歌名/总长/段数/分辨率**零硬编码**。
 *
 * **分镜数据来源（按优先级）**：
 *   1. `--shots <file>` 显式指定
 *   2. `<planDir>/shotlist.draft.json`（上次运行自动落盘的草稿，含边界 + 每段创作设定）
 *   3. `--boundaries 0,10.2,...` + 自动生成的占位 slug（新歌第一次跑用这个）
 *
 * 用法：
 *   node scripts/80_pv_shotlist.mjs --plan            # 只打印将要做的事与预估，不写文件
 *   node scripts/80_pv_shotlist.mjs                   # 生成/刷新分镜与全部计划文件
 *   node scripts/80_pv_shotlist.mjs --boundaries 0,10.2,20.4
 *   node scripts/80_pv_shotlist.mjs --lrc <lrc> --audio <wav> --vocal <wav>
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  loadConfig, parseArgv, log, run, probeDuration, ensureDirs, finishPlan, round3, pad2, FFMPEG,
} from './lib/fanfill-config.mjs'

const { arg, has, plan: PLAN_ONLY } = parseArgv()
const ROOT = process.cwd()
const cfg = loadConfig(ROOT)

// ── 路径：全部来自配置（命令行可覆盖）────────────────────────────────────────
const LRC = path.resolve(ROOT, arg('lrc', cfg.raw.song.lrc))
const AUDIO = path.resolve(ROOT, arg('audio', cfg.raw.audio.master))
const VOCAL = path.resolve(ROOT, arg('vocal', cfg.raw.audio.aceVocal))
const PLAN = path.resolve(ROOT, arg('plan-dir', path.relative(ROOT, cfg.dirs.plan)))
const PROMPTS = cfg.dirs.prompts

const DRAFT = path.join(PLAN, 'shotlist.draft.json')
const SHOTS_FILE = arg('shots', '')
const SEG_MAX = cfg.delivery.segMaxSec
const GEN_MIN = 4
const GEN_MAX = 15
const PRICE = cfg.delivery.pricePerSecond
const RESOLUTION = cfg.delivery.baseRes
const MODEL = cfg.delivery.model

// ── 分镜数据 ────────────────────────────────────────────────────────────────
function loadShotSource() {
  // 1) 显式 --shots
  if (SHOTS_FILE) {
    const p = path.resolve(ROOT, SHOTS_FILE)
    if (!fs.existsSync(p)) { console.error(`--shots 指定的文件不存在：${p}`); process.exit(2) }
    const d = JSON.parse(fs.readFileSync(p, 'utf8'))
    return { source: `--shots ${SHOTS_FILE}`, boundaries: d.boundaries, shots: d.shots }
  }
  // 2) planDir 里的草稿
  if (fs.existsSync(DRAFT)) {
    const d = JSON.parse(fs.readFileSync(DRAFT, 'utf8'))
    return { source: `草稿 ${path.relative(ROOT, DRAFT)}`, boundaries: d.boundaries, shots: d.shots }
  }
  // 3) segments.json 里已有的分镜（保持上一次的分镜设定与已审核边界）
  const segPath = path.join(PLAN, 'segments.json')
  if (fs.existsSync(segPath)) {
    const d = JSON.parse(fs.readFileSync(segPath, 'utf8'))
    if (Array.isArray(d.segments) && d.segments.length) {
      return {
        source: `${path.relative(ROOT, segPath)}（沿用既有分镜）`,
        boundaries: d.segments.map((s) => s.start),
        shots: d.segments.map((s) => ({
          slug: s.slug, mode: s.mode, mat: s.mat, mat2: s.mat2, trans: s.trans, note: s.note,
          refs: s.refs, chainFrom: s.chainFrom,
        })),
      }
    }
  }
  // 4) 命令行给边界 → 占位 slug
  const b = arg('boundaries', '')
  if (b) {
    const boundaries = b.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x))
    return { source: `--boundaries ${b}`, boundaries, shots: null }
  }
  console.error('没有分镜来源。请提供其一：--shots <file> / <planDir>/shotlist.draft.json / --boundaries 0,10.2,...')
  console.error('（新歌第一次跑：先用 --boundaries 给一组粗切点，脚本会吸附到静音谷并落草稿。）')
  process.exit(2)
}

const shotSrc = loadShotSource()
const BOUNDARIES = shotSrc.boundaries

// ── --plan：只打印 ──────────────────────────────────────────────────────────
if (PLAN_ONLY) {
  const total = await probeDuration(AUDIO)
  const est = BOUNDARIES.slice(1).map((end, i) => {
    const start = BOUNDARIES[i]
    const genDur = Math.min(GEN_MAX, Math.max(GEN_MIN, Math.ceil(end - start - 1e-9)))
    return { label: `段 ${i + 1}`, detail: `${start}s–${end}s（生成 ${genDur}s）`, cny: genDur * PRICE }
  })
  const lastGen = Math.min(GEN_MAX, Math.max(GEN_MIN, Math.ceil(total - BOUNDARIES[BOUNDARIES.length - 1] - 1e-9)))
  est.push({ label: `段 ${BOUNDARIES.length}`, detail: `${BOUNDARIES[BOUNDARIES.length - 1]}s–${total}s（生成 ${lastGen}s）`, cny: lastGen * PRICE })
  console.log(`配置：${path.relative(ROOT, cfg.configPath)}`)
  console.log(`歌：${cfg.raw.song.name}（${cfg.raw.song.source}）`)
  console.log(`分镜来源：${shotSrc.source}`)
  console.log(`LRC：${path.relative(ROOT, LRC)}`)
  console.log(`音频：${path.relative(ROOT, AUDIO)} → ${total}s（配置声明 ${cfg.raw.song.totalSec}s）`)
  console.log(`人声轨：${path.relative(ROOT, VOCAL)}`)
  console.log(`模型 ${MODEL} @${RESOLUTION}：¥${PRICE}/秒`)
  console.log('')
  console.log(`将产出到：${path.relative(ROOT, PLAN)}/ 与 ${path.relative(ROOT, PROMPTS)}/`)
  console.log('  · segments.json / shotlist.csv / shotlist.draft.json')
  console.log('  · alignment_report.md / lyrics_timing.csv|json')
  console.log('  · cost_estimate.md / NN_*.skeleton.txt')
  console.log('  本步骤**不花钱、不出片、不改既有产物**（segments.json 会被刷新）。')
  console.log('')
  finishPlan(est, cfg, { title: `分镜切分 ${BOUNDARIES.length} 段（本步花费恒为 ¥0，下面是后续出片的预估）` })
}

// ── 小工具 ──────────────────────────────────────────────────────────────────
const fmt = (t) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
}

// ── ① 解析 LRC ──────────────────────────────────────────────────────────────
function parseLrc(text) {
  const meta = {}
  const timed = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^\[([a-z]+):(.*)\]$/i)
    if (m) { meta[m[1].toLowerCase()] = m[2]; continue }
    const t = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/)
    if (!t) continue
    const sec = Number(t[1]) * 60 + Number(t[2])
    const txt = t[3].trim()
    if (txt) timed.push({ t: round3(sec), text: txt })
  }
  // 前奏里的「曲目信息行」：全角冒号的短前缀，或开头的「歌名 - 演唱者」行
  const isCredit = (x) => /^[^：]{1,6}：/.test(x.text) || /^[^—\-]{1,20}\s*[-–—]\s*\S/.test(x.text)
  const firstLyric = timed.findIndex((x) => !isCredit(x))
  const credits = timed.slice(0, firstLyric < 0 ? 0 : firstLyric)
  const lyrics = firstLyric < 0 ? timed : timed.slice(firstLyric)
  for (let i = 0; i < lyrics.length; i++) {
    lyrics[i].nominalEnd = i + 1 < lyrics.length ? lyrics[i + 1].t : null
  }
  return { meta, credits, lyrics }
}

// ── ② 人声包络 ──────────────────────────────────────────────────────────────
async function vocalEnvelope(wav) {
  const RATE = 8000
  const HOP = 0.02
  const { code, stdout, stderr } = await run(
    FFMPEG,
    ['-v', 'error', '-i', wav, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
    { binary: true },
  )
  if (code !== 0) throw new Error(`ffmpeg 提取人声包络失败：${String(stderr).slice(0, 300)}`)
  const n = Math.floor(stdout.length / 2 / (RATE * HOP))
  const step = RATE * HOP
  const db = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const base = i * step * 2
    for (let j = 0; j < step; j++) {
      const v = stdout.readInt16LE(base + j * 2) / 32768
      sum += v * v
    }
    db[i] = 20 * Math.log10(Math.max(Math.sqrt(sum / step), 1e-8))
  }
  const active = Array.from(db).filter((v) => v > -90).sort((a, b) => a - b)
  const q = (p) => (active.length ? active[Math.min(active.length - 1, Math.floor(active.length * p))] : -90)
  const pct = { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p97: q(0.97) }
  const W = 5
  const sm = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0
    for (let k = Math.max(0, i - W); k <= Math.min(n - 1, i + W); k++) { s += db[k]; c++ }
    sm[i] = s / c
  }
  const frameAt = (t) => Math.max(0, Math.min(n - 1, Math.round(t / HOP)))
  const levelIn = (t0, t1) => {
    let m = -160
    for (let i = frameAt(t0); i <= frameAt(t1); i++) m = Math.max(m, sm[i])
    return m
  }
  const onsetNear = (t) => {
    const lo = frameAt(Math.max(0, t - 0.8)), hi = frameAt(Math.min(n * HOP, t + 0.8))
    let bestI = -1, bestRise = 0
    for (let i = Math.max(4, lo); i <= hi; i++) {
      const rise = sm[i] - sm[i - 4]
      if (rise > bestRise) { bestRise = rise; bestI = i }
    }
    return bestI >= 0 ? { t: round3(bestI * HOP), rise: round3(bestRise), level: round3(sm[bestI]) } : null
  }
  const inQuietGap = (t, dropDb = 8) => {
    const localPeak = levelIn(Math.max(0, t - 2), Math.min(n * HOP, t + 2))
    const atSplit = levelIn(Math.max(0, t - 0.25), Math.min(n * HOP, t + 0.25))
    return { ok: atSplit <= localPeak - dropDb, atSplit: round3(atSplit), localPeak: round3(localPeak) }
  }
  const sungEnd = (t0) => {
    const start = frameAt(t0)
    let peak = -160
    for (let i = start; i < n; i++) {
      const t = i * HOP
      if (t > t0 + 12) break
      peak = Math.max(peak, sm[i])
      if (t > t0 + 0.35) {
        const cur = levelIn(t - 0.15, t + 0.15)
        if (peak > -80 && cur <= peak - 12) return round3(t)
      }
    }
    return null
  }
  return { hop: HOP, n, db, sm, pct, onsetNear, inQuietGap, levelIn, sungEnd, duration: round3(n * HOP) }
}

// ── main ────────────────────────────────────────────────────────────────────
for (const [label, p] of [['LRC', LRC], ['音频', AUDIO], ['人声轨', VOCAL]]) {
  if (!fs.existsSync(p)) { console.error(`❌ ${label}不存在：${p}`); process.exit(2) }
}

const lrc = parseLrc(await fsp.readFile(LRC, 'utf8'))
const total = round3(await probeDuration(AUDIO))
if (!lrc.lyrics.length) throw new Error('LRC 里没有解析到歌词行')

log(`[80] 配置：${path.relative(ROOT, cfg.configPath)}｜歌：${cfg.raw.song.name}`)
log(`[80] LRC：${lrc.credits.length} 行曲目信息 + ${lrc.lyrics.length} 句歌词｜音频 ${total}s`)
log(`[80] 分镜来源：${shotSrc.source}`)
if (Math.abs(total - Number(cfg.raw.song.totalSec)) > 0.05) {
  log(`[80] ⚠ 音频实测 ${total}s 与配置 song.totalSec ${cfg.raw.song.totalSec}s 差 ${(total - cfg.raw.song.totalSec).toFixed(3)}s（>0.05s）`)
}
log('[80] 正在从人声轨提包络…')
const env = await vocalEnvelope(VOCAL)
log(`[80] 人声包络：有效帧 ${env.n} 个（20ms/帧）｜分位 p25=${env.pct.p25.toFixed(1)} p50=${env.pct.p50.toFixed(1)} p90=${env.pct.p90.toFixed(1)} p97=${env.pct.p97.toFixed(1)} dBFS`)

for (const L of lrc.lyrics) {
  const o = env.onsetNear(L.t)
  L.onset = o ? o.t : null
  L.dev = o ? round3(o.t - L.t) : null
  L.onsetLevel = o ? o.level : null
  L.vocalEnd = L.onset != null ? env.sungEnd(L.onset) : null
}

// ── ③ 切分与校验 ────────────────────────────────────────────────────────────
const bounds = [...BOUNDARIES, total]
const lyricStarts = new Set(lrc.lyrics.map((L) => round3(L.t)))
const isSilentRegion = (t) => env.levelIn(Math.max(0, t - 1.5), Math.min(total, t + 1.5)) < -70
const gapScore = (t) => {
  const lp = env.levelIn(Math.max(0, t - 2), Math.min(total, t + 2))
  const at = env.levelIn(Math.max(0, t - 0.25), Math.min(total, t + 0.25))
  return round3(lp - at)
}
const insideAnyLyric = (t) =>
  lrc.lyrics.some((L) => L.vocalEnd != null && t > L.onset + 0.05 && t < L.vocalEnd - 0.05)
const boundaryOk = (t) => isSilentRegion(t) || gapScore(t) >= 8

const adjustments = []
for (let i = 1; i < bounds.length - 1; i++) {
  const b = bounds[i]
  if (lyricStarts.has(round3(b)) || boundaryOk(b)) continue
  let best = null
  for (let d = -2.5; d <= 2.5 + 1e-9; d += 0.02) {
    const t = round3(b + d)
    if (t - bounds[i - 1] < 4 || bounds[i + 1] - t < 4) continue
    if (insideAnyLyric(t)) continue
    const score = isSilentRegion(t) ? 1e6 : gapScore(t)
    if (!best || score > best.score) best = { t, score }
  }
  if (best && (isSilentRegion(best.t) || best.score >= 8)) {
    adjustments.push({ from: b, to: best.t, delta: round3(best.t - b), score: best.score })
    bounds[i] = best.t
  }
}

const segs = []
for (let i = 0; i < bounds.length - 1; i++) {
  const start = bounds[i]
  const end = bounds[i + 1]
  const src = (shotSrc.shots && shotSrc.shots[i]) || {}
  const cfgShot = {
    slug: src.slug || `seg_${pad2(i + 1)}`,
    mode: src.mode || 'I2VA',
    mat: src.mat || '',
    mat2: src.mat2 || '',
    trans: src.trans || cfg.delivery.transition,
    note: src.note || '',
    refs: Array.isArray(src.refs) ? src.refs : [],
    chainFrom: src.chainFrom ?? null,
  }
  const lines = lrc.lyrics.filter((L) => L.t >= start - 1e-6 && L.t < end - 1e-6)
  segs.push({
    idx: i + 1,
    slug: cfgShot.slug,
    start: round3(start),
    end: round3(end),
    dur: round3(end - start),
    genDur: Math.min(GEN_MAX, Math.max(GEN_MIN, Math.ceil(end - start - 1e-9))),
    mode: cfgShot.mode,
    mat: cfgShot.mat,
    mat2: cfgShot.mat2,
    trans: cfgShot.trans,
    note: cfgShot.note,
    refs: cfgShot.refs,
    chainFrom: cfgShot.chainFrom,
    lyrics: lines.map((L) => L.text),
    lyricTimes: lines.map((L) => L.t),
  })
}

const problems = []
for (let i = 1; i < segs.length; i++) {
  if (Math.abs(segs[i].start - segs[i - 1].end) > 1e-6) problems.push(`段 ${i} 与 段 ${i + 1} 之间不连续`)
}
if (Math.abs(segs[segs.length - 1].end - total) > 1e-3) problems.push('末段没有铺到音频结尾')
for (const s of segs) {
  if (s.dur > SEG_MAX + 1e-4) problems.push(`段 ${s.idx}(${s.slug}) 时长 ${s.dur}s > ${SEG_MAX}s`)
  if (s.genDur < GEN_MIN || s.genDur > GEN_MAX) problems.push(`段 ${s.idx}(${s.slug}) 生成时长 ${s.genDur}s 越界`)
}
for (let i = 1; i < segs.length; i++) {
  const b = segs[i].start
  if (lyricStarts.has(round3(b))) continue
  const inside = lrc.lyrics.find((L) => L.vocalEnd != null && b > L.onset + 0.05 && b < L.vocalEnd - 0.05)
  if (inside) {
    problems.push(`段 ${i}/${i + 1} 的边界 ${b}s 落在一句歌词的发声区间内（"${inside.text}" ${inside.onset}–${inside.vocalEnd}s）`)
    continue
  }
  if (!boundaryOk(b)) {
    problems.push(`段 ${i}/${i + 1} 的边界 ${b}s 不是静音谷（切点附近 ${env.levelIn(b - 0.25, b + 0.25).toFixed(1)} dB，±2s 局部峰值 ${env.levelIn(b - 2, b + 2).toFixed(1)} dB，仅低 ${gapScore(b)} dB，要求 ≥8 dB）`)
  }
}

// 参考图与链式前置的可用性自检（换歌时最容易漏的两件事）
for (const s of segs) {
  for (const r of s.refs) {
    if (!fs.existsSync(path.join(cfg.dirs.refs, r))) problems.push(`段 ${s.idx} 的参考图不存在：${path.relative(ROOT, path.join(cfg.dirs.refs, r))}（先跑 81_pv_refs.mjs）`)
  }
  if (s.chainFrom != null && !segs.some((x) => x.idx === s.chainFrom)) {
    problems.push(`段 ${s.idx} 的 chainFrom=${s.chainFrom} 指向不存在的段`)
  }
}

// ── ④ 产出 ──────────────────────────────────────────────────────────────────
ensureDirs(PLAN, PROMPTS)

const totalGen = segs.reduce((a, s) => a + s.genDur, 0)
const cost = totalGen * PRICE

// 草稿：把"边界 + 每段创作设定"落成数据，下次运行直接复用（换歌就换这份数据）
await fsp.writeFile(path.join(PLAN, 'shotlist.draft.json'), JSON.stringify({
  note: '分镜草稿：boundaries 是段起点（末段终点由音频时长补），shots 与边界一一对应。改分镜改这里。',
  boundaries: segs.map((s) => s.start),
  shots: segs.map((s) => ({ slug: s.slug, mode: s.mode, mat: s.mat, mat2: s.mat2, trans: s.trans, note: s.note, refs: s.refs, chainFrom: s.chainFrom })),
}, null, 2), 'utf8')

await fsp.writeFile(path.join(PLAN, 'segments.json'), JSON.stringify({
  model: MODEL, resolution: RESOLUTION, pricePerSecond: PRICE,
  audio: { file: cfg.rel(AUDIO), duration: total },
  vocal: { file: cfg.rel(VOCAL) },
  lrc: { file: cfg.rel(LRC), credits: lrc.credits, lyrics: lrc.lyrics },
  vads: lrc.lyrics.map((L) => ({ text: L.text, lrc: L.t, onset: L.onset, dev: L.dev, sungEnd: L.vocalEnd })),
  envelope: { percentile: env.pct, note: '人声轨 8kHz 单声道 RMS，20ms/帧，±100ms 平滑' },
  segments: segs,
  totals: { generatedSeconds: totalGen, estimatedCny: round3(cost) },
  problems,
}, null, 2), 'utf8')

const csv = ['idx,slug,start,end,dur_s,gen_dur_s,mode,material,material2,transition,lyrics,note']
for (const s of segs) {
  csv.push([
    s.idx, s.slug, s.start, s.end, s.dur, s.genDur, s.mode,
    `"${s.mat}"`, `"${s.mat2}"`, s.trans, `"${s.lyrics.join(' / ')}"`, `"${s.note}"`,
  ].join(','))
}
await fsp.writeFile(path.join(PLAN, 'shotlist.csv'), '\ufeff' + csv.join('\r\n') + '\r\n', 'utf8')

const maxDev = Math.max(...lrc.lyrics.map((L) => (L.dev == null ? 0 : Math.abs(L.dev))))
const report = []
report.push('# PV 对齐预检报告', '')
report.push(`- 生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`)
report.push(`- 歌词：\`${cfg.rel(LRC)}\`（${lrc.credits.length} 行曲目信息 + ${lrc.lyrics.length} 句歌词）`)
report.push(`- 音频：\`${cfg.rel(AUDIO)}\` → **${total}s**`)
report.push(`- 人声轨：\`${cfg.rel(VOCAL)}\`（8kHz 单声道 RMS，20ms/帧；分位 p25=${env.pct.p25.toFixed(1)} / p50=${env.pct.p50.toFixed(1)} / p90=${env.pct.p90.toFixed(1)} dBFS）`)
report.push(`- **LRC 与人声的最大起点偏差：${maxDev.toFixed(3)}s**（阈值 0.4s）${maxDev > 0.4 ? ' ⚠️ 超阈值' : ' ✅'}`, '')
report.push('## 逐句对齐', '', '| # | LRC 时间 | 人声实际起点 | 偏差 | 人声结束 | 歌词 |', '|---|---|---|---|---|---|')
lrc.lyrics.forEach((L, i) => {
  const flag = L.dev != null && Math.abs(L.dev) > 0.4 ? ' ⚠️' : ''
  report.push(`| ${i + 1} | ${fmt(L.t)} | ${L.onset != null ? fmt(L.onset) : '—'} | ${L.dev != null ? (L.dev >= 0 ? '+' : '') + L.dev.toFixed(3) + 's' + flag : '未匹配'} | ${L.vocalEnd != null ? fmt(L.vocalEnd) : '—'} | ${L.text} |`)
})
report.push('', '## 曲目信息行（片头卡时间轴）', '', '| 时间 | 内容 |', '|---|---|')
for (const c of lrc.credits) report.push(`| ${fmt(c.t)} | ${c.text} |`)
report.push('', '## 切分校验', '')
if (adjustments.length) {
  report.push('**边界自动吸附**（原定切点不在静音谷，已就近吸附）：', '')
  for (const a of adjustments) report.push(`- ${a.from}s → **${a.to}s**（移动 ${a.delta >= 0 ? '+' : ''}${a.delta}s，静音余量 ${a.score === 1e6 ? '纯静音区' : a.score + ' dB'}）`)
  report.push('')
}
report.push(problems.length ? problems.map((p) => `- ❌ ${p}`).join('\n') : `- ✅ 全部通过：无缝铺满、每段 ≤${SEG_MAX}s、歌词句零切断、合成边界落在真实停顿里`)
await fsp.writeFile(path.join(PLAN, 'alignment_report.md'), report.join('\n'), 'utf8')

// 歌词时间轴校正表：|偏差| ≤ 0.35s 用 LRC 原值（人工标注更稳），否则用实测起音，单句最多校正 0.6s
const timing = lrc.lyrics.map((L, i) => {
  const dev = L.dev ?? 0
  let use = L.t
  let reason = 'LRC 原值'
  if (L.onset != null && Math.abs(dev) > 0.35) {
    const shift = Math.max(-0.6, Math.min(0.6, dev))
    use = round3(L.t + shift)
    reason = `实测起音校正 ${shift >= 0 ? '+' : ''}${shift.toFixed(2)}s`
  }
  return { idx: i + 1, text: L.text, lrc: L.t, measuredOnset: L.onset, deviation: L.dev, use, reason }
})
await fsp.writeFile(
  path.join(PLAN, 'lyrics_timing.csv'),
  '\ufeff' + ['idx,text,lrc,measured_onset,deviation,use,reason']
    .concat(timing.map((t) => [t.idx, `"${t.text}"`, t.lrc, t.measuredOnset ?? '', t.deviation ?? '', t.use, `"${t.reason}"`].join(',')))
    .join('\r\n') + '\r\n',
  'utf8',
)
await fsp.writeFile(path.join(PLAN, 'lyrics_timing.json'), JSON.stringify(timing, null, 2), 'utf8')

const budget = cfg.raw.budget || {}
const spent = Number(budget.spentCny) || 0
const cap = Number(budget.totalCny) || 0
const costMd = []
costMd.push('# PV 成本估算', '')
costMd.push(`\`${MODEL}\` @${RESOLUTION}：${PRICE} 元/秒`, '')
costMd.push(`- 全片名义时长：${total}s`)
costMd.push(`- 实际生成秒数（逐段向上取整）：**${totalGen}s**`)
costMd.push(`- 全片预估：**¥${cost.toFixed(2)}**`)
costMd.push(`- 加 15% 重试余量：¥${(cost * 1.15).toFixed(2)}`)
costMd.push(`- 预算：¥${cap.toFixed(2)}｜台账已花：¥${spent.toFixed(2)}｜本片若全出，累计 ¥${(spent + cost).toFixed(2)}（${cap ? Math.round(((spent + cost) / cap) * 100) : '?'}%）`)
costMd.push('', '## 分段', '', '| # | 段名 | 时间 | 时长 | 生成 | 模式 | 素材 | 费用 |', '|---|---|---|---|---|---|---|---|')
for (const s of segs) {
  costMd.push(`| ${s.idx} | ${s.slug} | ${fmt(s.start)}–${fmt(s.end)} | ${s.dur}s | ${s.genDur}s | ${s.mode} | ${s.mat}${s.mat2 ? ' + ' + s.mat2 : ''} | ¥${(s.genDur * PRICE).toFixed(2)} |`)
}
costMd.push('')
const trialIdx = [5, 7].filter((i) => segs[i - 1])
if (trialIdx.length === 2) {
  const t = trialIdx.reduce((a, i) => a + segs[i - 1].genDur, 0)
  costMd.push(`**试片（段 ${trialIdx.join(' + 段 ')}）= ${t}s ≈ ¥${(t * PRICE).toFixed(2)}**`)
}
await fsp.writeFile(path.join(PLAN, 'cost_estimate.md'), costMd.join('\n'), 'utf8')

// prompt 骨架
const STYLE = cfg.delivery.styleSuffix || '2D anime animation frame, cel-shaded, clean line art, no on-screen text, no watermark, no logo'
for (const s of segs) {
  const body = [
    `# 段 ${s.idx} · ${s.slug}  （${fmt(s.start)}–${fmt(s.end)}，${s.dur}s → 生成 ${s.genDur}s）`,
    `# 模式：${s.mode}｜素材：${s.mat}${s.mat2 ? ' + ' + s.mat2 : ''}｜接点：${s.trans}`,
    `# 参考图：${s.refs.length ? s.refs.join(' + ') : '（无）'}${s.chainFrom ? `｜链式首帧 ← 段 ${s.chainFrom} 末帧` : ''}`,
    `# 歌词：${s.lyrics.length ? s.lyrics.join(' / ') : '（无歌词：前奏/间奏/尾奏）'}`,
    `# 说明：${s.note}`,
    '#',
    '# 要求：英文书写；三段式；禁止 <d> 对白；禁止画面出现任何文字；',
    `#       时间轴总长必须等于 ${s.genDur} 秒；运镜写全「类型+幅度+速度」；`,
    `#       提示词总长 ≤ ${cfg.delivery.maxPromptChars} 字符（H3 硬顶）。`,
    '',
    `integrated_multimodal_description: [Shot 1] ${STYLE}, <待撰写：构图 → 主体与动作（带时序节拍）→ 运镜>`,
    '',
    'overall_soundscape: <待撰写：1–4 句环境音/动作音>',
    '',
    'non_diegetic_music: N/A',
    '',
  ].join('\n')
  await fsp.writeFile(path.join(PROMPTS, `${pad2(s.idx)}_${s.slug}.skeleton.txt`), body, 'utf8')
}

// ── 控制台小结 ──────────────────────────────────────────────────────────────
console.error('')
console.error(`[80] 分镜 ${segs.length} 段｜生成总秒数 ${totalGen}s｜预估 ¥${cost.toFixed(2)}（含 15% 余量 ¥${(cost * 1.15).toFixed(2)}）`)
console.error(`[80] LRC↔人声最大偏差 ${maxDev.toFixed(3)}s`)
if (problems.length) {
  console.error(`[80] ❌ 校验未通过 ${problems.length} 项：`)
  for (const p of problems) console.error('      - ' + p)
  process.exitCode = 1
} else {
  console.error(`[80] ✅ 切分校验全部通过（无缝铺满 / ≤${SEG_MAX}s / 歌词零切断 / 边界落在真实停顿）`)
}
console.error(`[80] 产出：${cfg.rel(PLAN)}/{segments.json,shotlist.csv,shotlist.draft.json,alignment_report.md,cost_estimate.md,lyrics_timing.csv,lyrics_timing.json}`)
console.error(`[80]      ${cfg.rel(PROMPTS)}/NN_*.skeleton.txt（${segs.length} 个）`)
