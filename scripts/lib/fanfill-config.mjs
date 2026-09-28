/**
 * lib/fanfill-config.mjs —— 翻填项目的配置读取层（所有 80–87 脚本共享）
 * ---------------------------------------------------------------------------
 * 单一职责：把 `翻填项目.json`（schema 1）读成一个**已解析好绝对路径**的配置对象，
 * 并统一提供命令行参数解析、日志、以及 `--plan`（只打印不发请求）的开关。
 *
 * 契约见 `00_docs/08_翻填项目配置规范.md`。三条铁律：
 *   1. 配置里所有路径都是**工作区相对 + POSIX 分隔符**；本模块负责转绝对路径。
 *   2. **绝不硬编码歌名/总长/段数/分辨率**——一律从配置来。
 *   3. 校验失败就报错退出（§9 的六条），不要"猜一个默认值继续跑"。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

// ── 外部工具解析（可移植）────────────────────────────────────────────────────
// 本机 PATH 上的 `ffmpeg` 是 ImageMagick 的影子版（会解析失败），所以默认先试一条
// 显式路径。**换机器时不必改代码**，按下面的优先级覆盖即可：
//   1. 环境变量 `FANFILL_FFMPEG_DIR`（最高优先级，指向含 ffmpeg/ffprobe 的目录）
//   2. 项目配置 `video.ffmpegDir`
//   3. 下面这条历史默认路径（本机 E 盘）
//   4. 都没有就退回 PATH 上的裸名 `ffmpeg` / `ffprobe`（并打印一次提示）
const EXE = process.platform === 'win32' ? '.exe' : ''
const LEGACY_FFMPEG_DIR = 'E:\\software\\FFmpeg\\ffmpeg-8.1.1-essentials_build\\bin'

/** 运行期探到的 ffmpeg 目录（loadConfig 会用配置再覆盖一次）。 */
let resolvedFfmpegDir = process.env.FANFILL_FFMPEG_DIR || LEGACY_FFMPEG_DIR

/** 该目录里真的有可执行文件吗。 */
function hasFfmpeg(dir) {
  const p = path.join(dir, `ffmpeg${EXE}`)
  return fs.existsSync(p)
}

/**
 * 解析 ffmpeg/ffprobe 的可执行路径。
 * @returns {{ffmpeg:string, ffprobe:string, source:string, ok:boolean}}
 */
export function resolveFfmpeg() {
  const dir = resolvedFfmpegDir
  if (dir && hasFfmpeg(dir)) {
    return { ffmpeg: path.join(dir, `ffmpeg${EXE}`), ffprobe: path.join(dir, `ffprobe${EXE}`), source: dir, ok: true }
  }
  const source = dir
    ? `PATH 兜底（配置里的 ${dir} 下没有 ffmpeg${EXE}）`
    : 'PATH'
  return { ffmpeg: `ffmpeg${EXE}`, ffprobe: `ffprobe${EXE}`, source, ok: false }
}

/**
 * 用配置里的 `video.ffmpegDir` 覆盖解析结果（loadConfig 内部调用）。
 * 环境变量优先级更高，所以设了就不再被配置覆盖。
 */
function applyFfmpegDirFromConfig(cfg) {
  if (process.env.FANFILL_FFMPEG_DIR) return
  const d = cfg?.video?.ffmpegDir
  if (typeof d === 'string' && d) resolvedFfmpegDir = path.resolve(d)
}

// 保持旧的常量导出可用（值在 applyFfmpegDirFromConfig 之后才最终确定）
export const FFMPEG_DIR = LEGACY_FFMPEG_DIR
export const FFMPEG = path.join(LEGACY_FFMPEG_DIR, `ffmpeg${EXE}`)
export const FFPROBE = path.join(LEGACY_FFMPEG_DIR, `ffprobe${EXE}`)

/** 供脚本在需要时换成解析后的真实路径（不使用常量导出的脚本调它）。 */
export function ffmpegBin() { return resolveFfmpeg().ffmpeg }
export function ffprobeBin() { return resolveFfmpeg().ffprobe }

let warnedAboutFfmpeg = false
function ffmpegOrWarn(which) {
  const r = resolveFfmpeg()
  const bin = which === 'ffprobe' ? r.ffprobe : r.ffmpeg
  if (!r.ok && !warnedAboutFfmpeg) {
    warnedAboutFfmpeg = true
    console.error(
      `⚠ 没找到显式路径下的 ffmpeg，退回 ${r.source}。\n` +
      `  换机器请设环境变量 FANFILL_FFMPEG_DIR=<含 ffmpeg/ffprobe 的目录>，\n` +
      `  或在 翻填项目.json 里写 video.ffmpegDir。\n` +
      `  （Windows 上若 PATH 里的 ffmpeg 是 ImageMagick 自带的，会解析失败——务必显式指定。）`,
    )
  }
  return bin
}

const REQUIRED_KEYS = ['song', 'audio', 'video', 'credits', 'budget', 'cover']

// ── 命令行 ──────────────────────────────────────────────────────────────────
export function parseArgv(argv = process.argv.slice(2)) {
  const arg = (name, dflt) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('--')
      ? argv[i + 1]
      : dflt
  }
  const has = (name) => argv.includes(`--${name}`)
  return { argv, arg, has, plan: has('plan') }
}

// ── 日志 ────────────────────────────────────────────────────────────────────
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
export const log = (...a) => console.error(`[${ts()}]`, ...a)

// ── 子进程 ──────────────────────────────────────────────────────────────────
export function run(cmd, args, { binary = false, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    const out = []
    const err = []
    let timer = null
    if (timeoutMs > 0) timer = setTimeout(() => { try { p.kill() } catch { /* already gone */ } }, timeoutMs)
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => err.push(d))
    p.on('error', (e) => { if (timer) clearTimeout(timer); reject(e) })
    p.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const so = Buffer.concat(out)
      resolve({ code, stdout: binary ? so : so.toString('utf8'), stderr: Buffer.concat(err).toString('utf8') })
    })
  })
}

/** 用 ffprobe 读媒体参数（一律 JSON，不解析人读文本）。 */
export async function probeMedia(file) {
  const { code, stdout, stderr } = await run(ffmpegOrWarn('ffprobe'), [
    '-v', 'error',
    '-show_entries', 'format=duration,size,bit_rate',
    '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate',
    '-of', 'json', file,
  ], { timeoutMs: 60000 })
  if (code !== 0) throw new Error(`ffprobe 失败：${file}\n${String(stderr).slice(0, 400)}`)
  const j = JSON.parse(stdout)
  const v = (j.streams || []).find((s) => s.codec_type === 'video')
  const a = (j.streams || []).find((s) => s.codec_type === 'audio')
  const fps = v ? (v.r_frame_rate || v.avg_frame_rate || '') : ''
  const [fn, fd] = String(fps).split('/').map(Number)
  return {
    duration: Number(j.format?.duration),
    bytes: Number(j.format?.size),
    bitRate: Number(j.format?.bit_rate),
    width: v?.width ?? null,
    height: v?.height ?? null,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    fps: fd ? fn / fd : null,
  }
}

/** 只读时长（很多地方只需要这一个数）。 */
export async function probeDuration(file) {
  const { stdout } = await run(ffmpegOrWarn('ffprobe'), [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ], { timeoutMs: 60000 })
  return Number(String(stdout).trim())
}

// ── 校验 ────────────────────────────────────────────────────────────────────
const isRelPosix = (p) => typeof p === 'string'
  && p !== ''
  && !path.isAbsolute(p)
  && !/^[a-zA-Z]:/.test(p)
  && !p.replace(/\\/g, '/').split('/').includes('..')

function assertRel(field, value, problems) {
  if (value === undefined || value === null || value === '') return
  if (!isRelPosix(value)) problems.push(`${field} 必须是工作区相对路径（POSIX 分隔符、不含 ..），实际是 "${value}"`)
}

/**
 * 载入并校验配置。
 * @param {string} root 工作区根（通常是 process.cwd()）
 * @param {object} [opts]
 * @param {string} [opts.configPath] 显式指定配置文件（默认 <root>/翻填项目.json）
 * @param {boolean} [opts.strict=true] 校验失败是否抛错
 * @returns {{raw:object, root:string, configPath:string, abs:Function, rel:Function, problems:string[], warnings:string[]}}
 */
export function loadConfig(root = process.cwd(), opts = {}) {
  const { strict = true } = opts
  const configPath = opts.configPath
    ? path.resolve(root, opts.configPath)
    : path.join(root, '翻填项目.json')

  const problems = []
  const warnings = []

  if (!fs.existsSync(configPath)) {
    const msg = `找不到配置文件：${configPath}\n  新歌先按《00_docs/08_翻填项目配置规范.md》建一份 翻填项目.json。`
    if (strict) { console.error(msg); process.exit(2) }
    throw new Error(msg)
  }

  let raw
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (e) {
    const msg = `配置解析失败：${configPath}\n  ${e.message}`
    if (strict) { console.error(msg); process.exit(2) }
    throw new Error(msg)
  }

  // §9.1 版本
  if (raw.schema !== 1) problems.push(`配置 schema 版本不匹配：期望 1，实际 ${JSON.stringify(raw.schema)}`)
  // 允许用 `video.ffmpegDir` 指定 ffmpeg 目录（环境变量 FANFILL_FFMPEG_DIR 优先级更高）
  applyFfmpegDirFromConfig(raw)
  // §9.2 六大块
  for (const k of REQUIRED_KEYS) if (raw[k] === undefined || raw[k] === null) problems.push(`缺少必填段："${k}"`)

  const song = raw.song || {}
  const audio = raw.audio || {}
  const video = raw.video || {}

  // §9.3 相对路径
  assertRel('song.lrc', song.lrc, problems)
  assertRel('audio.reference', audio.reference, problems)
  assertRel('audio.referenceLocal', audio.referenceLocal, problems)
  assertRel('audio.instrumental', audio.instrumental, problems)
  assertRel('audio.stemsVocals', audio.stemsVocals, problems)
  assertRel('audio.aceVocal', audio.aceVocal, problems)
  assertRel('audio.master', audio.master, problems)
  for (const k of ['dir', 'planDir', 'promptDir', 'refDir', 'clipDir', 'subDir', 'coverDir', 'verifyDir', 'historyDir']) {
    if (video[k] !== undefined) assertRel(`video.${k}`, video[k], problems)
  }
  if (video.upscale && video.upscale.tool) assertRel('video.upscale.tool', video.upscale.tool, problems)

  // §9.4 master 存在性 + 总长一致性
  const absMaster = audio.master ? path.resolve(root, audio.master) : null
  if (absMaster && !fs.existsSync(absMaster)) {
    warnings.push(`audio.master 不存在：${audio.master}（音乐线还没产出？）`)
  }
  if (typeof song.totalSec !== 'number' || !(song.totalSec > 0)) {
    problems.push(`song.totalSec 必须是正数，实际 ${JSON.stringify(song.totalSec)}`)
  }

  // §9.5 prompt 上限
  if (typeof video.maxPromptChars !== 'number' || video.maxPromptChars > 7000) {
    if (typeof video.maxPromptChars === 'number' && video.maxPromptChars > 7000) {
      warnings.push(`video.maxPromptChars=${video.maxPromptChars} 超过 H3 的 7000 字符硬顶，已按 7000 生效`)
    } else {
      warnings.push('video.maxPromptChars 未设置，按 H3 硬顶 7000 生效')
    }
  }

  // §9.6 单价与预算
  if (!(video.pricePerSecond > 0)) problems.push(`video.pricePerSecond 必须 > 0，实际 ${JSON.stringify(video.pricePerSecond)}`)
  if (!((raw.budget || {}).totalCny > 0)) problems.push(`budget.totalCny 必须 > 0，实际 ${JSON.stringify((raw.budget || {}).totalCny)}`)

  if (problems.length && strict) {
    console.error(`❌ 配置校验未通过（${problems.length} 项）：${configPath}`)
    for (const p of problems) console.error('   - ' + p)
    process.exit(2)
  }
  for (const w of warnings) console.error('⚠ ' + w)

  /** 配置里的相对路径 → 绝对路径。 */
  const abs = (rel) => (rel ? path.resolve(root, String(rel).replace(/\\/g, '/')) : null)
  /** 绝对路径 → 配置口径的相对路径（统一 POSIX 分隔符）。 */
  const rel = (p) => (p ? path.relative(root, p).replace(/\\/g, '/') : null)

  // 派生的目录（配置可显式覆盖，否则按 <dir> 推）
  const dir = video.dir || '10_video'
  const dirs = {
    dir: abs(dir),
    plan: abs(video.planDir || `${dir}/plan`),
    prompts: abs(video.promptDir || `${dir}/prompts`),
    refs: abs(video.refDir || `${dir}/refs`),
    clips: abs(video.clipDir || `${dir}/clips`),
    subs: abs(video.subDir || `${dir}/subs`),
    cover: abs(video.coverDir || `${dir}/cover`),
    verify: abs(video.verifyDir || `${dir}/verify`),
    history: abs(video.historyDir || `${dir}/history`),
  }

  const segMaxSec = video.segMaxSec ?? 15
  const delivery = {
    aspect: video.aspect || '16:9',
    baseRes: video.baseRes || '768P',
    baseSize: video.baseSize || [1344, 768],
    model: video.model || 'MiniMax-H3',
    pricePerSecond: video.pricePerSecond,
    maxPromptChars: Math.min(video.maxPromptChars ?? 7000, 7000),
    segMaxSec,
    transition: video.transition || 'cut',
    subtitle: {
      font: (video.subtitle || {}).font || 'Microsoft YaHei',
      size: (video.subtitle || {}).size ?? 54,
      minDisplaySec: (video.subtitle || {}).minDisplaySec ?? 3.0,
      lineLevel: (video.subtitle || {}).lineLevel !== false,
      followMeasuredOnset: (video.subtitle || {}).followMeasuredOnset !== false,
    },
    deliverRes: video.deliverRes || [],
    styleSuffix: video.promptStyleSuffix || '',
  }

  return { raw, root, configPath, abs, rel, dirs, delivery, problems, warnings }
}

/**
 * 分镜表加载。分镜落在 `<planDir>/segments.json`（80 的产物，脚本与工作台共享）。
 * @returns {{data:object, segments:Array, path:string}}
 */
export function loadSegments(cfg, { strict = true } = {}) {
  const p = path.join(cfg.dirs.plan, 'segments.json')
  if (!fs.existsSync(p)) {
    const msg = `找不到分镜表：${p}\n  先跑：node scripts/80_pv_shotlist.mjs`
    if (strict) { console.error(msg); process.exit(2) }
    throw new Error(msg)
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf8'))
  const segments = Array.isArray(data.segments) ? data.segments : []
  return { data, segments, path: p }
}

/**
 * `--plan` 收尾：打印"将要做什么 + 预估花费"然后退出，**绝不发请求**。
 * @param {object[]} items 每项 {label, detail, cny}
 * @param {object} cfg
 */
export function finishPlan(items, cfg, { title = '将要做的事' } = {}) {
  const total = items.reduce((a, x) => a + (Number(x.cny) || 0), 0)
  const budget = cfg.raw.budget || {}
  const spent = Number(budget.spentCny) || 0
  const cap = Number(budget.totalCny) || 0
  console.log('')
  console.log(`══ --plan：${title}（不发任何请求）══`)
  for (const x of items) {
    const money = Number(x.cny) ? `  ¥${Number(x.cny).toFixed(2)}` : ''
    console.log(`  · ${x.label}${x.detail ? `  ${x.detail}` : ''}${money}`)
  }
  console.log('')
  console.log(`  本批预估：¥${total.toFixed(2)}`)
  console.log(`  已花（台账）：¥${spent.toFixed(2)} ／ 预算：¥${cap.toFixed(2)}`)
  const after = spent + total
  console.log(`  本批之后：¥${after.toFixed(2)}（${cap ? Math.round((after / cap) * 100) : '?'}% 预算）`)
  if (cap && after > cap) {
    console.log('')
    console.log(`  ⛔ 本批会让累计花费超过预算 ¥${cap.toFixed(2)} —— 先向用户报预估并拿授权，再实跑。`)
  } else if (total > 0) {
    console.log('  提示：用户已给一次总授权（见 budget.authorizationNote），预算内可直接实跑并逐笔记台账。')
  }
  process.exit(0)
}

/** 目录不存在就建（幂等）。 */
export function ensureDirs(...dirs) {
  for (const d of dirs) if (d) fs.mkdirSync(d, { recursive: true })
}

/** 命名冲突自动加 -2 / -3 后缀（非破坏性：绝不覆盖既有产物）。 */
export function nonClobber(p) {
  if (!fs.existsSync(p)) return p
  const ext = path.extname(p)
  const base = p.slice(0, -ext.length)
  for (let i = 2; i < 1000; i++) {
    const cand = `${base}-${i}${ext}`
    if (!fs.existsSync(cand)) return cand
  }
  throw new Error(`无法为非覆盖命名找到空位：${p}`)
}

export const pad2 = (n) => String(n).padStart(2, '0')

/** 保留 3 位小数（秒级时间戳的统一口径）。 */
export const round3 = (x) => Math.round(x * 1000) / 1000
