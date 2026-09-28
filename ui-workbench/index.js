/**
 * 翻填工作台 · Host 半边
 *
 * 职责：把工作区里的「文件即真相源」读成一个只读 JSON 快照，通过同源 HTTP 路由
 * 交给 Client 半边渲染。**只读**——本插件不写任何项目文件（设计原则 4：写回最小）。
 *
 * 为什么自带 HTTP 路由而不是复用宿主 RPC：
 *   本机 profile 的 agent 工具面没有暴露 `cordis_inspect_*`，无法在写码前探明可用的
 *   RPC 面；而 `webServer.register` 是 `dsh-host-webserver` 公开且稳定的服务
 *   （`dsh-remote-ssh-ops` 等已装插件用的就是它），契约清楚、可自证。
 *   同源 fetch 不需要任何跨域或鉴权绕行。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const name = 'fantian-workbench'
export const inject = ['webServer']

const PREFIX = '/fantian-workbench/v1'

/** 读取上限，防止误读大文件把面板卡死。 */
const MAX_TEXT_BYTES = 512 * 1024
/** 一个请求内最多枚举多少个目录。 */
const MAX_DIR_ENTRIES = 4000

const json = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** 读 JSON；失败返回 {__error}，绝不抛出——面板坏一个区块不能整页白屏。 */
function readJsonSafe(abs) {
  try {
    if (!fs.existsSync(abs)) return { __missing: true }
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch (error) {
    return { __error: String(error && error.message ? error.message : error) }
  }
}

function readTextSafe(abs, limit = MAX_TEXT_BYTES) {
  try {
    if (!fs.existsSync(abs)) return null
    const buf = fs.readFileSync(abs)
    if (buf.byteLength <= limit) return buf.toString('utf8')
    return buf.subarray(0, limit).toString('utf8') + '\n\n…（已截断）'
  } catch {
    return null
  }
}

function statSafe(abs) {
  try {
    const s = fs.statSync(abs)
    return { exists: true, bytes: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }
  } catch {
    return { exists: false }
  }
}

/** CSV → 行数组（够用的解析：逗号分隔、支持双引号包裹、不处理内嵌换行）。 */
function parseCsv(text) {
  if (!text) return []
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  return lines.map((line) => {
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

/** 递归数一个目录：文件数、总字节、按扩展名分组。 */
function scanDir(abs, { recursive = false, maxEntries = MAX_DIR_ENTRIES } = {}) {
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

/** 从一个 Markdown 进度文档里抽出「阶段总表」行。 */
function parseStageTable(md) {
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

/** 从 Markdown 里抽「当前阶段」「累计花费」「最后更新」三个头部事实。 */
function parseProgressHeader(md) {
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

/** 配置里的相对路径 → 绝对路径；拒绝越界。 */
function resolveIn(workspace, rel) {
  if (typeof rel !== 'string' || rel === '') return null
  const normalized = rel.replace(/\\/g, '/')
  if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) return null
  return path.join(workspace, normalized)
}

/**
 * 取一个产物目录的配置值，缺省时按规范 §4.1 推导成 `<video.dir>/<子目录>`。
 *
 * 为什么必须有这个兜底：`翻填项目.json` 只要求写 `video.dir`，其余九个 `*Dir`
 * 都是可选的。早期版本对 `promptDir`/`refDir`/… 直接取 `video.<key>`，一旦用户
 * 写的是最小配置，这些目录就会解析成 undefined → 面板上"产物目录规模"与
 * "prompt 字符数自检"静默显示 0（看起来像没产物，其实是有产物没被读到）。
 */
const DIR_DEFAULTS = {
  planDir: 'plan',
  promptDir: 'prompts',
  refDir: 'refs',
  clipDir: 'clips',
  subDir: 'subs',
  coverDir: 'cover',
  verifyDir: 'verify',
  historyDir: 'history',
}
function videoDir(video, key) {
  const explicit = video[key]
  if (typeof explicit === 'string' && explicit !== '') return explicit
  const base = typeof video.dir === 'string' && video.dir !== '' ? video.dir : '10_video'
  return `${base}/${DIR_DEFAULTS[key]}`
}

/** 组装完整快照。每个区块独立 try/catch —— 一个坏掉不影响其它。 */
function buildSnapshot(workspace) {
  const cfgAbs = path.join(workspace, '翻填项目.json')
  const config = readJsonSafe(cfgAbs)
  const progressAbs = path.join(workspace, '_进度', '进度.md')
  const ledgerAbs = path.join(workspace, '_进度', '成本台账.csv')
  const progressMd = readTextSafe(progressAbs)

  const res = (rel) => {
    const abs = resolveIn(workspace, rel)
    if (!abs) return { path: rel, exists: false }
    return { path: rel, ...statSafe(abs) }
  }

  const warnings = []
  if (config.__missing) warnings.push({ level: 'error', text: '缺少 翻填项目.json —— 脚本无法运行，请先按《翻填项目配置规范》建一份。' })
  if (config.__error) warnings.push({ level: 'error', text: `翻填项目.json 解析失败：${config.__error}` })
  if (!progressMd) warnings.push({ level: 'warn', text: '尚未建立 _进度/进度.md —— 用户检阅入口缺位。' })

  const video = (config && config.video) || {}
  const audio = (config && config.audio) || {}
  // 九个产物目录统一走 videoDir()：写了就用，没写就按 <video.dir>/<子目录> 推
  const planDir = videoDir(video, 'planDir')

  // ── 分镜 ────────────────────────────────────────────────────────────────
  const segmentsRaw = planDir ? readJsonSafe(resolveIn(workspace, `${planDir}/segments.json`) ?? '') : { __missing: true }
  const segments = Array.isArray(segmentsRaw.segments) ? segmentsRaw.segments : []
  const totals = segmentsRaw.totals || {}

  // ── 出片进度：clips 目录实际有什么 ────────────────────────────────────────
  const clipDir = videoDir(video, 'clipDir')
  const clipList = []
  if (clipDir) {
    const abs = resolveIn(workspace, clipDir)
    try {
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        if (!e.isFile() || !/\.(mp4|mov|mkv)$/i.test(e.name)) continue
        const st = statSafe(path.join(abs, e.name))
        const idxMatch = e.name.match(/^(\d+)/)
        clipList.push({ file: e.name, idx: idxMatch ? Number(idxMatch[1]) : null, bytes: st.bytes, mtimeMs: st.mtimeMs })
      }
    } catch { /* 目录不存在 = 还没出片 */ }
    clipList.sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
  }
  const doneIdx = new Set(clipList.map((c) => c.idx).filter((n) => n !== null))
  const totalSegments = segments.length
  const doneSegments = segments.filter((s) => doneIdx.has(s.idx)).length

  // ── 成本台账 ─────────────────────────────────────────────────────────────
  const ledgerRows = parseCsv(readTextSafe(ledgerAbs))
  const ledger = []
  if (ledgerRows.length > 1) {
    const header = ledgerRows[0]
    // 定位金额/累计列（容忍列顺序差异）
    const iAmount = header.findIndex((h) => /金额/.test(h))
    const iCum = header.findIndex((h) => /累计/.test(h))
    for (const row of ledgerRows.slice(1)) {
      ledger.push({
        time: row[0] ?? '',
        stage: row[1] ?? '',
        item: row[2] ?? '',
        amount: iAmount >= 0 ? Number(row[iAmount]) || 0 : 0,
        cumulative: iCum >= 0 ? Number(row[iCum]) || 0 : null,
        note: row[iCum + 1] ?? row[row.length - 1] ?? '',
        raw: row,
      })
    }
  }
  const ledgerTotal = ledger.length ? (ledger[ledger.length - 1].cumulative ?? ledger.reduce((a, r) => a + r.amount, 0)) : 0

  // ── 歌词对照 ─────────────────────────────────────────────────────────────
  const lyrics = []
  const lrcEntries = (segmentsRaw.lrc && Array.isArray(segmentsRaw.lrc.lyrics)) ? segmentsRaw.lrc.lyrics : []
  for (let i = 0; i < lrcEntries.length; i += 1) {
    const e = lrcEntries[i]
    const dev = typeof e.dev === 'number' ? e.dev : null
    lyrics.push({
      n: i + 1,
      lrc: e.t,
      onset: typeof e.onset === 'number' ? e.onset : null,
      dev,
      flag: dev !== null && Math.abs(dev) > 0.4 ? 'over' : (dev !== null && Math.abs(dev) > 0.25 ? 'near' : 'ok'),
      text: e.text,
      sungEnd: typeof e.vocalEnd === 'number' ? e.vocalEnd : null,
      // 保底显示时长检查：一句字幕至少 minDisplaySec
      displaySec: (typeof e.vocalEnd === 'number' && typeof e.onset === 'number')
        ? Number((e.vocalEnd - e.onset).toFixed(2)) : null,
    })
  }
  const minDisplaySec = (video.subtitle && video.subtitle.minDisplaySec) || 3.0
  for (const l of lyrics) {
    if (l.displaySec !== null && l.displaySec < minDisplaySec) l.shortDisplay = true
  }

  // ── 素材库（按流水线角色分组）────────────────────────────────────────────
  const materials = [
    { role: '原曲', key: 'reference', hint: '对照用，只读保护区' },
    { role: '原曲本地副本', key: 'referenceLocal', hint: '规避中文/空格路径' },
    { role: '伴奏', key: 'instrumental', hint: '分离产物' },
    { role: '分离人声', key: 'stemsVocals', hint: '对齐与校验用' },
    { role: '人声渲染', key: 'aceVocal', hint: 'ACE 导出的干声' },
    { role: '音乐成品', key: 'master', hint: 'song.totalSec 的事实来源' },
  ].map((m) => {
    const rel = audio[m.key]
    const st = rel ? res(rel) : { exists: false }
    return { ...m, path: rel || null, exists: !!st.exists, bytes: st.bytes ?? 0, mtimeMs: st.mtimeMs ?? null }
  })

  // ── 目录规模（参考图 / 片段 / 字幕 / 封面 / 核验 / 历史）──────────────────
  const dirStats = {}
  for (const [label, key] of [
    ['prompts', 'promptDir'],
    ['refs', 'refDir'],
    ['clips', 'clipDir'],
    ['subs', 'subDir'],
    ['cover', 'coverDir'],
    ['verify', 'verifyDir'],
    ['history', 'historyDir'],
  ]) {
    const rel = videoDir(video, key)
    dirStats[label] = scanDir(resolveIn(workspace, rel) ?? '', { recursive: label === 'history' || label === 'verify' })
  }

  // ── prompt 字符数自检（H3 上限 7000）─────────────────────────────────────
  const promptChars = []
  {
    const abs = resolveIn(workspace, videoDir(video, 'promptDir'))
    try {
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        if (!e.isFile() || !e.name.endsWith('.txt') || e.name.includes('skeleton')) continue
        const text = readTextSafe(path.join(abs, e.name), 200000) ?? ''
        const idxMatch = e.name.match(/^(\d+)/)
        promptChars.push({ file: e.name, idx: idxMatch ? Number(idxMatch[1]) : null, chars: text.length })
      }
    } catch { /* 无 prompt 目录 */ }
    promptChars.sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
  }
  const maxPromptChars = video.maxPromptChars || 7000
  for (const p of promptChars) if (p.chars > maxPromptChars) p.over = true

  // ── 异常优先：所有"需要你注意"的东西 ─────────────────────────────────────
  const overDev = lyrics.filter((l) => l.flag === 'over')
  if (overDev.length) {
    warnings.push({ level: 'warn', text: `${overDev.length} 句 LRC 时间与实测起音偏差 > 0.4s（第 ${overDev.map((l) => l.n).join('、')} 句）——字幕已按实测起音校正，但 LRC 本身建议回头修。` })
  }
  const shortDisplay = lyrics.filter((l) => l.shortDisplay)
  if (shortDisplay.length) {
    warnings.push({ level: 'warn', text: `${shortDisplay.length} 句实测收声短于保底 ${minDisplaySec}s（第 ${shortDisplay.map((l) => l.n).join('、')} 句）——字幕会按保底时长顺延。` })
  }
  const overPrompt = promptChars.filter((p) => p.over)
  if (overPrompt.length) {
    warnings.push({ level: 'error', text: `${overPrompt.length} 条 prompt 超过 ${maxPromptChars} 字符上限：${overPrompt.map((p) => p.file).join('、')}` })
  }
  if (totalSegments > 0 && doneSegments < totalSegments) {
    warnings.push({ level: 'info', text: `出片进行中：${doneSegments}/${totalSegments} 段已有成片。` })
  }
  if (config.budget && typeof config.budget.totalCny === 'number' && ledgerTotal > 0) {
    const ratio = ledgerTotal / config.budget.totalCny
    if (ratio >= 0.9) warnings.push({ level: 'error', text: `已花 ¥${ledgerTotal.toFixed(2)} / 预算 ¥${config.budget.totalCny}（${Math.round(ratio * 100)}%）——再花钱前必须问用户。` })
    else if (ratio >= 0.7) warnings.push({ level: 'warn', text: `已花 ¥${ledgerTotal.toFixed(2)} / 预算 ¥${config.budget.totalCny}（${Math.round(ratio * 100)}%）。` })
  }

  // ── 音乐线外部依赖探活（ACE Studio 是否在跑）─────────────────────────────
  let aceRunning = null
  try {
    // 只看进程名，不启动任何东西。找不到进程 = 音乐线动作不可用。
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq ACE Studio.exe', '/NH'], { encoding: 'utf8', timeout: 5000 })
    aceRunning = /ACE Studio\.exe/i.test(out)
  } catch {
    aceRunning = null // 非 Windows 或 tasklist 不可用 → 不显示这一条，避免误报
  }
  if (aceRunning === false) {
    warnings.push({ level: 'info', text: 'ACE Studio 未运行 —— 音乐线的出人声动作不可用（视频线不受影响）。' })
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    workspace,
    song: (config && config.song) || null,
    config: {
      schema: config.schema ?? null,
      video: {
        dir: video.dir ?? null,
        aspect: video.aspect ?? null,
        baseRes: video.baseRes ?? null,
        baseSize: video.baseSize ?? null,
        model: video.model ?? null,
        pricePerSecond: video.pricePerSecond ?? null,
        maxPromptChars,
        subtitle: video.subtitle ?? null,
        transition: video.transition ?? null,
        segMaxSec: video.segMaxSec ?? null,
        deliverables: video.deliverables ?? null,
      },
      budget: config.budget ?? null,
      cover: config.cover ?? null,
      credits: config.credits ?? null,
      audio: {
        separation: audio.separation ?? null,
        voice: audio.voice ?? null,
        loudness: audio.loudness ?? null,
      },
    },
    configError: config.__error ?? null,
    progress: { header: parseProgressHeader(progressMd), stages: parseStageTable(progressMd), markdown: progressMd },
    segments: {
      total: totalSegments,
      done: doneSegments,
      list: segments.map((s) => ({
        idx: s.idx, slug: s.slug, start: s.start, end: s.end, dur: s.dur, genDur: s.genDur,
        mode: s.mode, mat: s.mat, mat2: s.mat2, trans: s.trans, note: s.note,
        lyrics: s.lyrics ?? [],
        hasClip: doneIdx.has(s.idx),
      })),
      totals,
      generatedSeconds: totals.generatedSeconds ?? null,
      estimatedCny: totals.estimatedCny ?? null,
      problems: segmentsRaw.problems ?? [],
    },
    lyrics,
    materials,
    dirStats,
    promptChars,
    ledger: { rows: ledger, total: ledgerTotal, budget: config.budget ? config.budget.totalCny : null },
    clips: clipList,
    warnings,
    aceRunning,
  }
}

export function apply(ctx, config = {}) {
  const workspace = config.workspace || process.cwd()
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith(PREFIX)) { json(res, 404, { ok: false, error: 'not found' }); return }
        const rest = url.pathname.slice(PREFIX.length) || '/'
        if (rest === '/snapshot' || rest === '/') { json(res, 200, buildSnapshot(workspace)); return }
        if (rest === '/ping') { json(res, 200, { ok: true, workspace }); return }
        json(res, 404, { ok: false, error: `unknown endpoint: ${rest}` })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
      }
    },
  })
  ctx.effect(() => dispose)
  ctx.logger?.info?.(`[翻填工作台] 只读快照路由已挂载：${PREFIX}/snapshot（workspace=${workspace}）`)
}
