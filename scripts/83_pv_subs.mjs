#!/usr/bin/env node
/**
 * 83_pv_subs.mjs —— 由 LRC 生成 PV 字幕（ASS + SRT）与片头/片尾信息卡
 * ---------------------------------------------------------------------------
 * · 歌词用 `<planDir>/lyrics_timing.csv` 的**校正后**时间轴（偏差 >0.35s 的句子改用实测起音）
 * · 片头三屏：曲名卡 / 原曲信息卡 / 制作工具卡（工具按作用分类）—— 文案全部由配置渲染
 * · 片尾（静音尾段）：署名 + AI 生成声明 + 非商用声明 —— 同样来自 `credits`
 * · 全片统一字体（`video.subtitle.font`，默认微软雅黑），行级淡入淡出
 *
 * **配置化**：歌名 `song.name`、总长 `song.totalSec`、LRC `song.lrc`、署名 `credits`、
 *   字幕 `video.subtitle.*`、画布 `video.baseSize`、输出 `video.subDir`。
 *   本脚本对歌名/总长/文件名/字号**零硬编码**（`--font/--size/--w/--h/--tag` 仍可覆盖）。
 *
 * 用法：
 *   node scripts/83_pv_subs.mjs --plan                              # 只打印将要做的事（不写产物）
 *   node scripts/83_pv_subs.mjs                                     # 默认画布（video.baseSize）
 *   node scripts/83_pv_subs.mjs --w <宽> --h <高> --tag <标签>       # 另出一份画布版本（不覆盖默认版）
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  loadConfig, parseArgv, log, ensureDirs, finishPlan, nonClobber,
} from './lib/fanfill-config.mjs'

const { arg, plan: PLAN_ONLY } = parseArgv()
const ROOT = process.cwd()
const cfg = loadConfig(ROOT)

// ── 路径与参数：全部来自配置（命令行可覆盖）────────────────────────────────
const LRC = cfg.abs(cfg.raw.song.lrc)
const TIMING = path.join(cfg.dirs.plan, 'lyrics_timing.csv')
const SEGFILE = path.join(cfg.dirs.plan, 'segments.json')
const SUBS = cfg.dirs.subs

const SUB = cfg.delivery.subtitle
const FONT = arg('font', SUB.font)
const SIZE = Number(arg('size', SUB.size))
const [BASE_W, BASE_H] = cfg.delivery.baseSize
const RES_X = Number(arg('w', BASE_W))
const RES_Y = Number(arg('h', BASE_H))
const TAG = arg('tag', '')          // 加 --tag <标签> → <歌名>_<标签>.ass（不覆盖默认版）
const SONG = cfg.raw.song.name
const SOURCE = cfg.raw.song.source || ''
const BASE = TAG ? `${SONG}_${TAG}` : SONG
const TOTAL = Number(cfg.raw.song.totalSec)
const MIN_DISP = Number(SUB.minDisplaySec)   // 保底显示时长（video.subtitle.minDisplaySec）

// ── ASS 工具 ────────────────────────────────────────────────────────────────
const assTime = (t) => {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t - h * 3600) / 60)
  const s = t - h * 3600 - m * 60
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}
const srtTime = (t) => {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t - h * 3600) / 60)
  const s = t - h * 3600 - m * 60
  const ms = Math.round((s - Math.floor(s)) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}
const esc = (s) => String(s).replace(/[{}]/g, '').replace(/\r?\n/g, '\\N')

// ── 解析 LRC ────────────────────────────────────────────────────────────────
const lrcText = await fsp.readFile(LRC, 'utf8')
const timed = []
for (const raw of lrcText.split(/\r?\n/)) {
  const m = raw.trim().match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/)
  if (!m) continue
  const t = Number(m[1]) * 60 + Number(m[2])
  const text = m[3].trim()
  if (text) timed.push({ t, text })
}
const isCredit = (x) => /^[^：]{1,6}：/.test(x.text) || /^[^—\-]{1,20}\s*[-–—]\s*\S/.test(x.text)
const firstLyric = timed.findIndex((x) => !isCredit(x))
let lyrics = timed.slice(firstLyric).map((x, i, arr) => ({
  ...x, idx: i + 1, end: i + 1 < arr.length ? arr[i + 1].t : Math.min(TOTAL, x.t + 3.2),
}))

// 套用校正时间轴 + 实测收声时刻（避免间奏段字幕挂 30 秒）
const sungEnd = new Map()
if (fs.existsSync(SEGFILE)) {
  try {
    const j = JSON.parse(await fsp.readFile(SEGFILE, 'utf8'))
    for (const v of j.vads || []) if (v.text && v.sungEnd) sungEnd.set(v.text, Number(v.sungEnd))
  } catch (e) { log(`⚠ 分镜表读取失败（跳过实测收声）：${String(e.message).slice(0, 160)}`) }
} else {
  log(`⚠ 缺分镜表 ${path.relative(ROOT, SEGFILE)}：字幕结束时间退化为「下一句起点」（建议先跑 80_pv_shotlist.mjs）`)
}
if (fs.existsSync(TIMING)) {
  const rows = (await fsp.readFile(TIMING, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean)
  for (const row of rows) {
    const c = row.match(/^(\d+),"(.*)",([\d.]+),([\d.]*),(-?[\d.]*),([\d.]+),/)
    if (!c) continue
    const idx = Number(c[1]), use = Number(c[6])
    if (lyrics[idx - 1]) lyrics[idx - 1].t = use
  }
}
// 每句结束 = min(下一句起点, 实测收声 + 0.45s)，并保证**最短显示**（避免换气被当成收声导致一闪而过）
lyrics = lyrics.map((L, i) => {
  const next = i + 1 < lyrics.length ? lyrics[i + 1].t : TOTAL - MIN_DISP
  const se = sungEnd.get(L.text)
  let end = Math.min(next, se ? Math.max(L.t + 1.2, se + 0.45) : next)
  end = Math.max(end, Math.min(next, L.t + MIN_DISP)) // 下限：最短显示时长（但不超过下一句起点）
  if (!(end > L.t)) end = L.t + 1.5
  return { ...L, end }
})

// ── 卡面文案：全部由 credits 渲染（换歌只改配置）─────────────────────────────
const CR = cfg.raw.credits || {}
const ORIG = CR.original || {}
const THIS = CR.thisVersion || {}
const TOOLS = Array.isArray(THIS.tools) ? THIS.tools : []
const toolName = (role, dflt) => (TOOLS.find((t) => t.role === role)?.name) || dflt
const LABEL = { 词: '作词', 曲: '作曲' }        // 配置键 → 卡面用词（其余键同名直接用）
const label = (k) => LABEL[k] || k
// 曲名卡的出处行：出处里的「第N话」前补「动画」（卡面口径，避免把出处原文写死在脚本里）
const episodeLine = /第[^话]{1,4}话/.test(SOURCE) ? SOURCE.replace(/第([^话]{1,4})话/, '动画第$1话') : SOURCE

// 原曲信息卡：标量每 3 个一行、演唱者数组单独一行
const originalLines = []
{
  const scalars = Object.entries(ORIG).filter(([, v]) => !Array.isArray(v))
  for (let i = 0; i < scalars.length; i += 3) {
    originalLines.push(scalars.slice(i, i + 3).map(([k, v]) => `${label(k)} ${v}`).join('　'))
  }
  const arr = Object.entries(ORIG).find(([, v]) => Array.isArray(v))
  if (arr) originalLines.push(`${label(arr[0])} ${arr[1].join(' / ')}`)
}
// 本版制作卡：角色 + 名称。下面两处是**卡面补充措辞**（说明性文案，非歌相关常量），换歌按需改
const TOOL_SUFFIX = { 歌声合成: '（备选 SXSEditor）', 'Agent 编排': ' + 自建 H3 MCP 服务' }
const EXTRA_TOOL_LINES = ['备选评估　MiniMax-MCP-JS（未用于本片出片）']
const toolLines = TOOLS.map((t) => `${t.role}　${t.name}${TOOL_SUFFIX[t.role] || ''}`)
// 片尾卡：版权句从 disclaimer 里取，避免二次手写
const copyrightClause = String(THIS.disclaimer || '').match(/原曲版权归[^。]*/)?.[0] || '原曲版权归原著作权人所有'

// ── 片头三屏 / 片尾（时间窗与 80 分镜的前奏、尾声段对应；换歌按分镜改这里）────
const SCREENS = [
  {
    start: 0.8, end: 10.0, style: 'Title',
    lines: [SONG, episodeLine, '— 翻 填 版 —'],
  },
  {
    start: 10.8, end: 20.2, style: 'Info',
    lines: ['原曲制作', ...originalLines],
  },
  {
    start: 20.9, end: 30.3, style: 'Info', step: 66,
    lines: ['本版制作', `改词 ${THIS.改词 || ''}`.trim(), ...toolLines, ...EXTRA_TOOL_LINES],
  },
]

const OUTRO = {
  start: 162.3, end: 165.7, style: 'Small',
  lines: [
    `翻填 / 二创：${THIS.改词 || ''}`.trim(),
    `视频由 AI 生成（${toolName('视频生成', 'AI')}），音频由 ${toolName('歌声合成', 'AI')} 合成`,
    `${copyrightClause}，本作为非商业同人作品`,
  ],
}

// ── 组装 ASS ────────────────────────────────────────────────────────────────
const styleLines = [
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  `Style: Lyric,${FONT},${SIZE},&H00FFFFFF,&H00FFFFFF,&H00242020,&H80000000,-1,0,0,0,100,100,1.5,0,1,3,1,2,60,60,96,134`,
  `Style: Title,${FONT},${Math.round(SIZE * 1.45)},&H00FFFFFF,&H00FFFFFF,&H00242020,&H80000000,-1,0,0,0,100,100,2,0,1,3.5,1,2,60,60,0,134`,
  `Style: Info,${FONT},${Math.round(SIZE * 0.72)},&H00FFFFFF,&H00FFFFFF,&H00242020,&H80000000,0,0,0,0,100,100,1,0,1,2.5,1,2,80,80,0,134`,
  `Style: Small,${FONT},${Math.round(SIZE * 0.6)},&H00E8E8E8,&H00E8E8E8,&H00242020,&H80000000,0,0,0,0,100,100,1,0,1,2,1,2,60,60,0,134`,
]

const events = []
for (const sc of SCREENS) {
  const n = sc.lines.length
  const step = sc.step || 74
  sc.lines.forEach((ln, i) => {
    // MarginV 是距底边的距离：第 0 行最靠上，末行最靠下（表头在上面）
    const mv = (n - 1 - i) * step
    events.push(`Dialogue: 0,${assTime(sc.start)},${assTime(sc.end)},${sc.style},,0,0,${mv},,{\\fad(500,500)}${esc(ln)}`)
  })
}
for (const L of lyrics) {
  events.push(`Dialogue: 0,${assTime(L.t)},${assTime(L.end - 0.02)},Lyric,,0,0,0,,{\\fad(180,260)}${esc(L.text)}`)
}
OUTRO.lines.forEach((ln, i) => {
  // 同样：第 0 行最靠上
  const mv = (OUTRO.lines.length - 1 - i) * 62
  events.push(`Dialogue: 0,${assTime(OUTRO.start)},${assTime(OUTRO.end)},${OUTRO.style},,0,0,${mv},,{\\fad(600,600)}${esc(ln)}`)
})

const ass = [
  '[Script Info]',
  `Title: ${SONG} 翻填 PV`,
  'ScriptType: v4.00+',
  `PlayResX: ${RES_X}`,
  `PlayResY: ${RES_Y}`,
  'WrapStyle: 0',
  'ScaledBorderAndShadow: yes',
  'YCbCr Matrix: TV.709',
  '',
  '[V4+ Styles]',
  ...styleLines,
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...events,
  '',
].join('\n')

const srt = [
  ...SCREENS.map((sc) => ({ s: sc.start, e: sc.end, text: sc.lines.join('\n') })),
  ...lyrics.map((L) => ({ s: L.t, e: L.end, text: L.text })),
  { s: OUTRO.start, e: OUTRO.end, text: OUTRO.lines.join('\n') },
].map((c, i) => `${i + 1}\n${srtTime(c.s)} --> ${srtTime(c.e)}\n${c.text}\n`).join('\n')

const ASS_OUT = path.join(SUBS, `${BASE}.ass`)
const SRT_OUT = path.join(SUBS, `${BASE}.srt`)

// ── --plan：只打印 ──────────────────────────────────────────────────────────
if (PLAN_ONLY) {
  console.log(`配置：${path.relative(ROOT, cfg.configPath)}｜歌：${SONG}`)
  console.log(`LRC：${path.relative(ROOT, LRC)}｜校正时间轴：${path.relative(ROOT, TIMING)}${fs.existsSync(TIMING) ? '' : '（缺，用 LRC 原值）'}`)
  console.log(`画布：${RES_X}x${RES_Y}｜字体 ${FONT}｜歌词字号 ${SIZE}｜最短显示 ${MIN_DISP}s｜总长 ${TOTAL}s`)
  console.log('')
  console.log('片头/片尾卡：')
  for (const sc of SCREENS) console.log(`  ${assTime(sc.start)} – ${assTime(sc.end)}  ${sc.lines.length} 行  ${sc.lines[0]}`)
  console.log(`  片尾 ${assTime(OUTRO.start)} – ${assTime(OUTRO.end)}  ${OUTRO.lines.length} 行`)
  console.log(`歌词字幕：${lyrics.length} 句（校正后时间轴）`)
  console.log('')
  console.log(`将写出：${path.relative(ROOT, ASS_OUT)} 与 ${path.relative(ROOT, SRT_OUT)}（共 ${events.length} 条事件）`)
  console.log('  同名旧文件不覆盖：先归档到 history/<时间戳>/ 再写新的。')
  finishPlan([
    { label: `${path.relative(ROOT, ASS_OUT)}`, detail: `${events.length} 条事件（片头 ${SCREENS.reduce((a, s) => a + s.lines.length, 0)} 行 + 歌词 ${lyrics.length} 句 + 片尾 ${OUTRO.lines.length} 行）`, cny: 0 },
    { label: `${path.relative(ROOT, SRT_OUT)}`, detail: 'SRT 版（同样内容）', cny: 0 },
  ], cfg, { title: '83 字幕生成（纯本地，不花钱）' })
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
    fs.writeFileSync(readme, `# 归档 ${stamp}\n\n- 原因：${reason}\n- 说明：这些产物在本次运行中被重新生成，旧版本先移到这里（非破坏性，未删除）。\n\n`
      + moved.map((m) => `- \`${path.basename(m)}\``).join('\n') + '\n', 'utf8')
  }
  log(`归档 ${moved.length} 个旧产物 → ${path.relative(ROOT, dir)}（${reason}）`)
  return moved
}

// ── 写出 ────────────────────────────────────────────────────────────────────
ensureDirs(SUBS, cfg.dirs.history)
archiveOld([ASS_OUT, SRT_OUT], `83 重新生成字幕（${BASE}）`)
await fsp.writeFile(ASS_OUT, ass, 'utf8')
await fsp.writeFile(SRT_OUT, srt, 'utf8')

console.log('片头/片尾卡：')
for (const sc of SCREENS) console.log(`  ${assTime(sc.start)} – ${assTime(sc.end)}  ${sc.lines.length} 行  ${sc.lines[0]}`)
console.log(`  片尾 ${assTime(OUTRO.start)} – ${assTime(OUTRO.end)}  ${OUTRO.lines.length} 行`)
console.log('')
console.log('歌词字幕（校正后时间轴）：')
for (const L of lyrics) console.log(`  ${assTime(L.t)} → ${assTime(L.end)}  ${L.text}`)
console.log('')
console.log(`✅ 已写出 ${path.relative(ROOT, ASS_OUT)}（${events.length} 条事件）`)
console.log(`✅ 已写出 ${path.relative(ROOT, SRT_OUT)}`)
console.log(`   字体 ${FONT}｜画布 ${RES_X}x${RES_Y}｜歌词字号 ${SIZE}`)
