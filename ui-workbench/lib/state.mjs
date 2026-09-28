/**
 * 翻填工作台 · 状态层（只读为主）
 *
 * 职责：把「文件即真相源」读成结构化事实——歌曲注册表、配置、九个产物目录、
 * 进度文档、台账、目录规模、歌词对齐、分镜。
 *
 * 两条硬纪律（都是踩出来的）：
 *   1. **绝不 process.exit**：`scripts/lib/fanfill-config.mjs` 的 loadConfig 校验失败会
 *      exit(2)，插件 import 它等于让 dsh web 进程随时可能被一份坏配置杀掉。这里自带
 *      一套只读、不抛出的解析，问题只进 problems/warnings。
 *   2. **每个区块独立 try/catch**：面板坏一个区块不能整页白屏。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const MAX_TEXT_BYTES = 512 * 1024
export const MAX_DIR_ENTRIES = 4000

/** 九个产物子目录的派生规则（配置里写了就用写的，没写按 <video.dir>/<子目录> 推）。 */
export const DIR_DEFAULTS = {
  planDir: 'plan',
  promptDir: 'prompts',
  refDir: 'refs',
  clipDir: 'clips',
  subDir: 'subs',
  coverDir: 'cover',
  verifyDir: 'verify',
  historyDir: 'history',
}

/** 新建歌时建的目录骨架（与 00_docs/08 的目录约定一致）。 */
export const SONG_SKELETON_DIRS = [
  '01_input/CG', '02_stems', '03_midi', '04_lyrics', '05_vocals', '06_svc',
  '07_mix', '08_release', '09_aceproject', '10_video', 'music', '_进度', 'scripts/lib',
]

// ── 基础读写 ────────────────────────────────────────────────────────────────

export function statSafe(abs) {
  try {
    const s = fs.statSync(abs)
    return { exists: true, bytes: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }
  } catch {
    return { exists: false }
  }
}

export function readJsonSafe(abs) {
  try {
    if (!fs.existsSync(abs)) return { __missing: true }
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch (error) {
    return { __error: String((error && error.message) || error) }
  }
}

export function readTextSafe(abs, limit = MAX_TEXT_BYTES) {
  try {
    if (!fs.existsSync(abs)) return null
    const buf = fs.readFileSync(abs)
    if (buf.byteLength <= limit) return buf.toString('utf8')
    return buf.subarray(0, limit).toString('utf8') + '\n\n…（已截断）'
  } catch {
    return null
  }
}

/**
 * 真实路径（解析 junction / symlink / 8.3 短名）。解析不出来（路径不存在）返回 null。
 * Windows 上必须用 `realpathSync.native`：它才会解重解析点。
 */
export function realPathOf(abs) {
  try { return fs.realpathSync.native(abs) } catch { return null }
}

/**
 * 判断 abs 的真实落点是否仍在 root 的真实落点之内。
 *
 * 为什么需要它：字符串层面的 `path.join` 拦不住 junction/symlink——歌根里放一个指向歌根外的
 * junction，`resolveIn` 会认为路径合法，而文件实际落在外面（独立对抗性核验 H1 实测过）。
 * 做法：找到目标最近的**已存在**祖先，解析它的真实路径，再把还没创建的那几段接回去比较。
 */
export function insideRealPath(root, abs) {
  const realRoot = realPathOf(root) || path.resolve(root)
  let cur = path.resolve(abs)
  const tail = []
  for (let i = 0; i < 64; i += 1) {
    if (fs.existsSync(cur)) break
    const parent = path.dirname(cur)
    if (parent === cur) return false
    tail.unshift(path.basename(cur))
    cur = parent
  }
  const realBase = realPathOf(cur)
  if (!realBase) return false
  const full = tail.length ? path.join(realBase, ...tail) : realBase
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const f = norm(full)
  const r = norm(realRoot)
  return f === r || f.startsWith(r + path.sep)
}

/**
 * 相对路径 → 绝对路径；拒绝绝对路径、盘符、`..`、UNC，**并复核真实落点没被 junction 带出歌根**。
 * 越界返回 null。
 */
export function resolveIn(root, rel) {
  if (typeof rel !== 'string' || rel === '') return null
  const normalized = rel.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(normalized)) return null
  if (normalized.startsWith('//')) return null
  if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) return null
  const abs = path.join(root, normalized)
  if (!insideRealPath(root, abs)) return null
  return abs
}

/** 绝对路径 → 歌根相对路径（posix 分隔符）；不在歌根内（含 junction 绕行）返回 null。 */
export function relOf(root, abs) {
  if (!insideRealPath(root, abs)) return null
  const r = realPathOf(root) || path.resolve(root)
  const a = realPathOf(abs) || path.resolve(abs)
  if (a !== r && !a.startsWith(r + path.sep)) return null
  const rel = path.relative(r, a).split(path.sep).join('/')
  return rel === '' ? '.' : rel
}

/** 递归数一个目录：文件数、总字节、按扩展名分组。 */
export function scanDir(abs, { recursive = false, maxEntries = MAX_DIR_ENTRIES } = {}) {
  const byExt = {}
  let files = 0
  let bytes = 0
  let visited = 0
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (visited >= maxEntries) return
      visited += 1
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (recursive && !e.name.startsWith('.')) walk(p)
        continue
      }
      const ext = (path.extname(e.name) || '(none)').toLowerCase()
      const size = statSafe(p).bytes ?? 0
      files += 1
      bytes += size
      byExt[ext] = byExt[ext] || { count: 0, bytes: 0 }
      byExt[ext].count += 1
      byExt[ext].bytes += size
    }
  }
  walk(abs)
  return { files, bytes, byExt, truncated: visited >= maxEntries }
}

/** CSV → 行数组（够用：逗号分隔、双引号包裹、不处理内嵌换行）。 */
export function parseCsv(text) {
  if (!text) return []
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').map((line) => {
    const cells = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i += 1 } else quoted = false
        } else cur += ch
      } else if (ch === '"') quoted = true
      else if (ch === ',') { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    return cells.map((c) => c.trim())
  })
}

// ── 配置与目录派生 ──────────────────────────────────────────────────────────

/** 取九个产物目录的配置值；缺省按 <video.dir>/<子目录> 派生。返回歌根相对 posix 路径。 */
export function videoDir(video, key) {
  const explicit = video && video[key]
  if (typeof explicit === 'string' && explicit !== '') return explicit.replace(/\\/g, '/')
  const base = video && typeof video.dir === 'string' && video.dir !== '' ? video.dir : '10_video'
  return key === 'dir' ? base : `${base}/${DIR_DEFAULTS[key]}`
}

export function deriveDirs(config) {
  const video = (config && config.video) || {}
  const out = { dir: videoDir(video, 'dir') }
  for (const key of Object.keys(DIR_DEFAULTS)) out[key] = videoDir(video, key)
  out.cgDir = (typeof video.cgDir === 'string' && video.cgDir !== '') ? video.cgDir.replace(/\\/g, '/') : '01_input/CG'
  return out
}

const REQUIRED_SECTIONS = ['song', 'audio', 'video', 'credits', 'budget', 'cover']

/** 收集所有 relpath 字段（用于 §9 校验）。 */
function collectRelPaths(node, trail = '', out = []) {
  if (!node || typeof node !== 'object') return out
  for (const [k, v] of Object.entries(node)) {
    const t = trail ? `${trail}.${k}` : k
    if (typeof v === 'string' && /^(lrc|reference|referenceLocal|instrumental|stemsVocals|aceVocal|master|svcModelDir|dir|planDir|promptDir|refDir|clipDir|subDir|coverDir|verifyDir|historyDir|cgDir|tool)$/.test(k)) {
      out.push({ key: t, value: v })
    } else if (typeof v === 'object') {
      if (Array.isArray(v)) {
        v.forEach((item, i) => { if (typeof item === 'string' && k === 'logos') out.push({ key: `${t}[${i}]`, value: item }) })
      } else collectRelPaths(v, t, out)
    }
  }
  return out
}

/**
 * 按《翻填项目配置规范》§9 做的**只读**校验。
 * @returns {{problems: string[], warnings: string[]}}
 */
export function configProblems(config) {
  const problems = []
  const warnings = []
  if (config.__missing) { problems.push('缺少 翻填项目.json'); return { problems, warnings } }
  if (config.__error) { problems.push(`翻填项目.json 解析失败：${config.__error}`); return { problems, warnings } }
  if (config.schema !== 1) problems.push(`schema 必须为 1（当前 ${JSON.stringify(config.schema)}）`)
  for (const key of REQUIRED_SECTIONS) if (!config[key] || typeof config[key] !== 'object') problems.push(`缺少必填段：${key}`)
  for (const { key, value } of collectRelPaths(config)) {
    if (value === '') continue
    const v = value.replace(/\\/g, '/')
    if (/^[a-zA-Z]:/.test(v) || v.startsWith('//') || path.isAbsolute(v)) problems.push(`${key} 不能是绝对路径：${value}`)
    else if (v.split('/').includes('..')) problems.push(`${key} 不能含 ..：${value}`)
  }
  const maxPrompt = config.video && config.video.maxPromptChars
  if (typeof maxPrompt === 'number' && maxPrompt > 7000) warnings.push(`video.maxPromptChars=${maxPrompt} 超过 H3 的 7000 上限`)
  const pps = config.video && config.video.pricePerSecond
  if (!(typeof pps === 'number' && pps > 0)) warnings.push('video.pricePerSecond 缺失或非正数——成本估算会不准')
  const budget = config.budget && config.budget.totalCny
  if (!(typeof budget === 'number' && budget > 0)) warnings.push('budget.totalCny 缺失或非正数')
  return { problems, warnings }
}

// ── 进度文档 ────────────────────────────────────────────────────────────────

/** 抽「阶段总表」行（`| # | 阶段 | 状态 | 产物 | 验收 |`）。 */
export function parseStageTable(md) {
  if (!md) return []
  const rows = []
  const lines = md.split(/\r?\n/)
  let inTable = false
  for (const line of lines) {
    const t = line.trim()
    if (/^\|\s*#\s*\|/.test(t)) { inTable = true; continue }
    if (inTable) {
      if (!t.startsWith('|')) { inTable = false; continue }
      if (/^\|[\s:|-]+\|$/.test(t)) continue
      const cells = t.split('|').slice(1, -1).map((c) => c.trim())
      if (cells.length >= 5) {
        rows.push({ idx: cells[0], stage: cells[1], status: cells[2], artifact: cells[3], acceptance: cells[4], cost: cells[5] ?? '' })
      }
    }
  }
  return rows
}

/** 抽头部三个事实：最后更新 / 当前阶段 / 累计花费。 */
export function parseProgressHeader(md) {
  const out = { updated: null, stage: null, spent: null }
  if (!md) return out
  const head = md.split(/\r?\n/).slice(0, 40).join('\n')
  const m1 = head.match(/最后更新[：:]\s*([^｜|\n]+)/)
  if (m1) out.updated = m1[1].trim()
  const m2 = head.match(/当前阶段[：:]\s*\*{0,2}([^｜|\n]+)/)
  if (m2) out.stage = m2[1].replace(/\*+/g, '').trim()
  const m3 = head.match(/累计花费[：:]\s*([^｜|\n]+)/)
  if (m3) out.spent = m3[1].trim()
  return out
}

/** 抽「待用户决定」段落里的未决项（`- [ ] …`）。 */
export function parseDecisions(md) {
  if (!md) return []
  const lines = md.split(/\r?\n/)
  const out = []
  let inSection = false
  for (const line of lines) {
    const t = line.trim()
    if (/^#{2,4}\s*/.test(t)) {
      inSection = /待用户决定/.test(t)
      continue
    }
    if (!inSection) continue
    const m = t.match(/^[-*]\s*\[\s*\]\s*(.+)$/)
    if (m) out.push({ text: m[1].replace(/\*\*/g, '').trim() })
  }
  return out
}

// ── 歌曲状态 ────────────────────────────────────────────────────────────────

const TICKS_FILE = '_进度/工作台状态.json'

export function readTicks(songRoot) {
  const raw = readJsonSafe(path.join(songRoot, TICKS_FILE))
  if (!raw || raw.__missing || raw.__error) return {}
  return (raw.ticks && typeof raw.ticks === 'object') ? raw.ticks : {}
}

/** 读一首歌的全部事实（配置 + 进度 + 台账 + 人工勾选）。 */
export function loadSongState(songRoot) {
  const config = readJsonSafe(path.join(songRoot, '翻填项目.json'))
  const progressMd = readTextSafe(path.join(songRoot, '_进度', '进度.md'))
  const ledgerText = readTextSafe(path.join(songRoot, '_进度', '成本台账.csv'))
  const { problems, warnings } = configProblems(config)
  const ledgerRows = parseCsv(ledgerText)
  const ledger = []
  if (ledgerRows.length > 1) {
    const header = ledgerRows[0]
    const iAmount = header.findIndex((hh) => /金额/.test(hh))
    const iCum = header.findIndex((hh) => /累计/.test(hh))
    for (const row of ledgerRows.slice(1)) {
      ledger.push({
        time: row[0] ?? '',
        stage: row[1] ?? '',
        item: row[2] ?? '',
        amount: iAmount >= 0 ? Number(row[iAmount]) || 0 : 0,
        cumulative: iCum >= 0 ? Number(row[iCum]) || null : null,
        note: row[iCum + 1] ?? row[row.length - 1] ?? '',
        raw: row,
      })
    }
  }
  const ledgerTotal = ledger.length ? (ledger[ledger.length - 1].cumulative ?? ledger.reduce((a, r) => a + r.amount, 0)) : 0
  return {
    root: songRoot,
    config,
    configProblems: problems,
    configWarnings: warnings,
    dirs: deriveDirs(config.__missing || config.__error ? {} : config),
    progressMd,
    progress: { header: parseProgressHeader(progressMd), stages: parseStageTable(progressMd) },
    decisions: parseDecisions(progressMd),
    ledger: { rows: ledger, total: ledgerTotal },
    ticks: readTicks(songRoot),
  }
}

// ── 歌曲注册表（多歌） ──────────────────────────────────────────────────────

/**
 * 注册表放插件目录里的 songs.json（在 E: 盘的插件目录，不占 C 盘，也不污染歌目录）。
 * 首次写入时创建；合并语义，不删除任何条目（forget 只是打标记）。
 */
export function readRegistry(pluginDir) {
  const abs = path.join(pluginDir, 'songs.json')
  const raw = readJsonSafe(abs)
  if (!raw || raw.__missing || raw.__error) return { songs: [], path: abs }
  return { songs: Array.isArray(raw.songs) ? raw.songs : [], path: abs, updatedAt: raw.updatedAt }
}

export function writeRegistry(pluginDir, songs) {
  const abs = path.join(pluginDir, 'songs.json')
  const payload = { schema: 1, updatedAt: new Date().toISOString(), songs }
  const tmp = `${abs}.tmp-${process.pid}`
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmp, abs)
  return abs
}

/** 把一个目录整理成一首歌的摘要事实（不读全量产物，只读关键文件）。 */
export function songSummary(root, { id, name } = {}) {
  const cfgStat = statSafe(path.join(root, '翻填项目.json'))
  const config = cfgStat.exists ? readJsonSafe(path.join(root, '翻填项目.json')) : { __missing: true }
  const song = (config && config.song) || {}
  const progressMd = readTextSafe(path.join(root, '_进度', '进度.md'), 20000)
  const { problems } = configProblems(config)
  return {
    id: id || root,
    root,
    name: song.name || name || path.basename(root),
    source: song.source || null,
    hasConfig: cfgStat.exists,
    configOk: problems.length === 0,
    problems,
    hasProgress: !!progressMd,
    stage: parseProgressHeader(progressMd).stage,
  }
}

export function homedir() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}
