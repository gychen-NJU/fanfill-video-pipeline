/**
 * 翻填工作台 · Host 半边（v2：引导式流水线工作台）
 *
 * 一条 prefix 路由分派全部端点（保持单路由，兼容既有的两处自检）：
 *   GET  /ping                       存活与版本
 *   GET  /snapshot?song=             面板全部数据（v1 字段只增不改 + pipeline/songs/env/jobs）
 *   GET  /ls?song=&path=             有界目录列举（选「工作区里已有的文件」用）
 *   POST /upload?song=&slot=&name=&rel=   原始字节流落盘（绝不覆盖）
 *   POST /link                       就地指定已有文件，或复制入库
 *   POST /config                     合并写 翻填项目.json（备份 + sha256/mtime 乐观锁）
 *   POST /state                      人工勾选写 _进度/工作台状态.json
 *   POST /songs                      新建歌骨架 / 登记已有目录 / 从列表移除（都不删文件）
 *   POST /run                        跑白名单动作（argv 来自 spec，不来自请求）
 *   GET  /job?job=&tail=             作业状态 + 日志尾
 *   POST /job/cancel                 树杀取消
 *   POST /reveal                     在资源管理器里定位产物
 *
 * 安全边界（宿主侧的这条路由**没有** DSH 的鉴权/Origin 策略，必须自己扛）：
 *   - 变更类请求必须带 `x-fantian: 1` 头（跨站简单请求/表单设不了自定义头）；
 *   - 响应不带任何 CORS 头，也不实现 OPTIONS（预检必然失败）；
 *   - 一切路径先 resolve 再校验在歌根内；动作 argv 只来自 spec；付费动作宿主侧直接拒跑。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  loadSongState, songSummary, statSafe, readJsonSafe, readTextSafe, scanDir, resolveIn, relOf,
} from './lib/state.mjs'
import { loadSpec, buildPipeline, makeCtx, resolveVars, resolveTargetDir } from './lib/spec.mjs'
import {
  createSongSkeleton, copyInto, ensureDir, forgetRegistrySong, patchConfig, patchTicks,
  sha256File, streamRequestToFile, upsertRegistrySong, DEFAULT_MAX_UPLOAD_BYTES,
} from './lib/writes.mjs'
import { createJobs } from './lib/jobs.mjs'

export const name = 'fantian-workbench'
export const inject = ['webServer']

const PREFIX = '/fantian-workbench/v1'
const VERSION = '2.0.0'
const MAX_JSON_BODY = 1024 * 1024
/** 目录列举要跳过的重目录（否则面板会去数 12 GB 的 cache）。 */
const LS_SKIP = new Set(['.git', 'node_modules', 'cache', 'venvs', 'models', 'History', '.up', '.norm', '.tmp'])

// ── HTTP 小工具 ─────────────────────────────────────────────────────────────

const json = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readJsonBody(req, limit = MAX_JSON_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        const err = new Error(`请求体超过 ${limit} 字节`)
        err.code = 413
        // 独立核验 M3：先让调用方把响应写出去，再断流，否则客户端只看到 ECONNRESET
        req.pause()
        reject(err)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) { resolve({}); return }
      try { resolve(JSON.parse(text)) } catch (e) {
        const err = new Error(`请求体不是合法 JSON：${e.message}`)
        err.code = 400
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/** 变更类请求的守卫：必须带自定义头（无 CORS、无 OPTIONS 配合，构成同源之外的写入屏障）。 */
function guardMutation(req) {
  const method = (req.method || 'GET').toUpperCase()
  if (method === 'OPTIONS') return { ok: false, code: 405, error: '不支持 OPTIONS' }
  if (method !== 'POST') return { ok: false, code: 405, error: `变更类端点只接受 POST（收到 ${method}）` }
  const token = req.headers && req.headers['x-fantian']
  if (token !== '1') return { ok: false, code: 403, error: '缺少 x-fantian 头：拒绝跨站/表单写入' }
  return { ok: true }
}

function sanitizeName(name, fallback = 'file') {
  const base = String(name || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || fallback
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 180)
  // 独立核验 L5：`..` / `.` 这种"名字"会让 path.join 跑到上一级去
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return fallback
  return cleaned
}

function sanitizeRel(rel) {
  if (typeof rel !== 'string' || rel === '') return ''
  const norm = rel.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..')
  return norm.map((p) => sanitizeName(p, 'dir')).join('/')
}

// ── 歌曲列表 ────────────────────────────────────────────────────────────────

function resolveSongs({ workspace, config, pluginDir, registryPath }) {
  const reg = (() => {
    const raw = readJsonSafe(registryPath || path.join(pluginDir, 'songs.json'))
    return (!raw || raw.__missing || raw.__error) ? { songs: [] } : raw
  })()
  const roots = []
  const push = (root, tag) => {
    if (typeof root !== 'string' || root === '') return
    const abs = path.resolve(root)
    if (roots.some((r) => r.root.toLowerCase() === abs.toLowerCase())) return
    roots.push({ root: abs, tag })
  }
  push(workspace, 'default')
  for (const s of (config.songs || [])) push(typeof s === 'string' ? s : (s && s.root), 'configured')
  for (const s of (reg.songs || [])) {
    if (!s || s.hidden || !s.root) continue
    push(s.root, 'registry')
  }
  return roots
}

// ── 环境探活（只查存在性，不启动任何东西）──────────────────────────────────
//
// 机器专属路径**不进代码**（这个包是要开源给别人用的）：一律从「环境变量 → 插件配置 → 歌曲配置 → 工作区内 → PATH」
// 这条链上取。本机的真实路径写在 profile 补丁的 config 里（那是本机配置，本来就该机器专属）。

/** 在 PATH 里找一个可执行文件（不执行它，只看存不存在）。 */
function findOnPath(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const abs = path.join(dir, `${name}${ext}`)
      if (statSafe(abs).exists) return abs
    }
  }
  return null
}

function ffmpegCandidates(songRoot, config, pluginConfig) {
  const list = []
  const push = (dir, source) => { if (typeof dir === 'string' && dir) list.push({ dir, source }) }
  push(process.env.FANFILL_FFMPEG_DIR, 'env FANFILL_FFMPEG_DIR')
  push(pluginConfig && pluginConfig.ffmpegDir, '插件配置 ffmpegDir')
  push(config && config.video && config.video.ffmpegDir, 'config video.ffmpegDir')
  push(path.join(songRoot, 'tools', 'ffmpeg'), '工作区内')
  return list
}

function envProbe({ songRoot, config, pluginConfig = {}, songState }) {
  let ffmpeg = { path: null, ok: false, source: 'not found' }
  for (const cand of ffmpegCandidates(songRoot, config, pluginConfig)) {
    const exe = path.join(cand.dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    if (statSafe(exe).exists) { ffmpeg = { path: exe, ok: true, source: cand.source }; break }
  }
  if (!ffmpeg.ok) {
    const onPath = findOnPath('ffmpeg')
    if (onPath) ffmpeg = { path: onPath, ok: true, source: 'PATH（注意：本机 PATH 上可能是 ImageMagick 的影子版）' }
  }
  const py = (rel) => statSafe(path.join(rel, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'))
  const venvCandidates = []
  if (pluginConfig.venvsRoot) venvCandidates.push(pluginConfig.venvsRoot)
  if (Array.isArray(pluginConfig.venvsRoots)) venvCandidates.push(...pluginConfig.venvsRoots)
  venvCandidates.push(path.join(songRoot, 'venvs'))
  const python = { sep: null, pitch: null, searched: venvCandidates.slice() }
  for (const base of venvCandidates) {
    if (!base) continue
    if (!python.sep && py(path.join(base, 'sep')).exists) python.sep = path.join(base, 'sep')
    if (!python.pitch && py(path.join(base, 'pitch')).exists) python.pitch = path.join(base, 'pitch')
  }
  let aceRunning = null
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq ACE Studio.exe', '/NH'], { encoding: 'utf8', timeout: 5000 })
    aceRunning = /ACE Studio\.exe/i.test(out)
  } catch { aceRunning = null }
  const upscale = (config && config.video && config.video.upscale && config.video.upscale.tool) || 'tools/upscale/realesrgan-ncnn-vulkan.exe'
  const upAbs = resolveIn(songRoot, upscale)
  const scripts = (() => {
    try { return fs.readdirSync(path.join(songRoot, 'scripts')).filter((f) => /^80b?|^8[1-7]/.test(f)).length } catch { return 0 }
  })()
  // 中文/空格路径常用的 ASCII junction：由配置声明（本机那条写在 profile 配置里），不写死在代码里。
  const junctions = (Array.isArray(pluginConfig.junctions) ? pluginConfig.junctions : [])
    .map((j) => (typeof j === 'string' ? { label: j, path: j } : { label: j.label || j.path, path: j.path }))
    .filter((j) => typeof j.path === 'string' && j.path !== '')
    .map((j) => ({ ...j, exists: statSafe(j.path).exists }))
  return {
    node: process.version,
    platform: process.platform,
    ffmpeg,
    python,
    ace: { running: aceRunning },
    upscale: { path: upscale, ok: !!(upAbs && statSafe(upAbs).exists) },
    junctions,
    pvScripts: scripts,
    ledgerSpent: songState ? songState.ledger.total : null,
  }
}

// ── 面板快照（v1 字段原样保留 + v2 增量）────────────────────────────────────

function buildSnapshot({ songRoot, pluginDir, config, jobs, specCache, allowedInterpreters = [] }) {
  const state = loadSongState(songRoot)
  const cfg = state.config
  const dirs = state.dirs
  const warnings = []
  if (cfg.__missing) warnings.push({ level: 'error', text: '缺少 翻填项目.json —— 脚本无法运行，可在面板里点「新建翻填任务」。' })
  if (cfg.__error) warnings.push({ level: 'error', text: `翻填项目.json 解析失败：${cfg.__error}` })
  if (!state.progressMd) warnings.push({ level: 'warn', text: '尚未建立 _进度/进度.md —— 用户检阅入口缺位。' })
  for (const p of state.configProblems) warnings.push({ level: 'error', text: `配置不合规：${p}` })

  const video = (cfg && cfg.video) || {}
  const audio = (cfg && cfg.audio) || {}
  const planDir = dirs.planDir

  const res = (rel) => {
    const abs = resolveIn(songRoot, rel)
    if (!abs) return { path: rel, exists: false }
    return { path: rel, ...statSafe(abs) }
  }

  // ── 分镜 ────────────────────────────────────────────────────────────────
  const segmentsRaw = readJsonSafe(resolveIn(songRoot, `${planDir}/segments.json`) ?? path.join(songRoot, '__none__'))
  const segments = Array.isArray(segmentsRaw.segments) ? segmentsRaw.segments.filter((s) => s && typeof s === 'object') : []
  const totals = segmentsRaw.totals || {}

  // ── 出片进度 ────────────────────────────────────────────────────────────
  const clipDir = dirs.clipDir
  const clipList = []
  {
    const abs = resolveIn(songRoot, clipDir)
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

  // ── 歌词对照 ────────────────────────────────────────────────────────────
  const lyrics = []
  const lrcEntries = (segmentsRaw.lrc && Array.isArray(segmentsRaw.lrc.lyrics)) ? segmentsRaw.lrc.lyrics : []
  for (let i = 0; i < lrcEntries.length; i += 1) {
    const e = lrcEntries[i]
    // 独立核验 M4：歌词数组里混进 null/字符串时不能让整个快照 500
    if (!e || typeof e !== 'object') continue
    const dev = typeof e.dev === 'number' ? e.dev : null
    lyrics.push({
      n: i + 1,
      lrc: e.t,
      onset: typeof e.onset === 'number' ? e.onset : null,
      dev,
      flag: dev !== null && Math.abs(dev) > 0.4 ? 'over' : (dev !== null && Math.abs(dev) > 0.25 ? 'near' : 'ok'),
      text: e.text,
      sungEnd: typeof e.vocalEnd === 'number' ? e.vocalEnd : null,
      displaySec: (typeof e.vocalEnd === 'number' && typeof e.onset === 'number')
        ? Number((e.vocalEnd - e.onset).toFixed(2)) : null,
    })
  }
  const minDisplaySec = (video.subtitle && video.subtitle.minDisplaySec) || 3.0
  for (const l of lyrics) if (l.displaySec !== null && l.displaySec < minDisplaySec) l.shortDisplay = true

  // ── 素材库（按流水线角色分组；保持 v1 的 6 项不变）────────────────────────
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

  // ── 目录规模 ────────────────────────────────────────────────────────────
  const dirStats = {}
  for (const [label, key] of [
    ['prompts', 'promptDir'], ['refs', 'refDir'], ['clips', 'clipDir'], ['subs', 'subDir'],
    ['cover', 'coverDir'], ['verify', 'verifyDir'], ['history', 'historyDir'],
  ]) {
    const rel = dirs[key]
    dirStats[label] = scanDir(resolveIn(songRoot, rel) ?? '', { recursive: label === 'history' || label === 'verify' })
  }

  // ── prompt 字符数自检 ───────────────────────────────────────────────────
  const promptChars = []
  {
    const abs = resolveIn(songRoot, dirs.promptDir)
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

  // ── 异常优先 ────────────────────────────────────────────────────────────
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
  const ledgerTotal = state.ledger.total
  const budgetTotal = (cfg.budget && typeof cfg.budget.totalCny === 'number') ? cfg.budget.totalCny : null
  if (budgetTotal && ledgerTotal > 0) {
    const ratio = ledgerTotal / budgetTotal
    if (ratio >= 0.9) warnings.push({ level: 'error', text: `已花 ¥${ledgerTotal.toFixed(2)} / 预算 ¥${budgetTotal}（${Math.round(ratio * 100)}%）——再花钱前必须问用户。` })
    else if (ratio >= 0.7) warnings.push({ level: 'warn', text: `已花 ¥${ledgerTotal.toFixed(2)} / 预算 ¥${budgetTotal}（${Math.round(ratio * 100)}%）。` })
  }

  const env = envProbe({ songRoot, config: cfg, pluginConfig: config, songState: state })
  if (env.ace.running === false) {
    warnings.push({ level: 'info', text: 'ACE Studio 未运行 —— 音乐线的出人声动作不可用（视频线不受影响）。' })
  }

  // ── v2：流水线 ──────────────────────────────────────────────────────────
  const spec = specCache.get(songRoot)
  state.ticks = state.ticks || {}
  const ctxExtras = {
    spentLabel: budgetTotal ? `¥${ledgerTotal.toFixed(2)}` : `¥${ledgerTotal.toFixed(2)}（未设预算）`,
    budgetLabel: budgetTotal ? `¥${budgetTotal}` : '未设',
    spent: `¥${ledgerTotal.toFixed(2)}`,
    budget: budgetTotal ? `¥${budgetTotal}` : '未设',
  }
  const stateForPipeline = { ...state, ticks: state.ticks }
  // 独立核验 M4：歌根里一行坏数据不该让整个 /snapshot 500 —— 分块容错，坏块降级成 warning
  let pipeline = null
  try {
    pipeline = buildPipeline({ spec, state: stateForPipeline, songRoot, extras: ctxExtras, allowedInterpreters })
  } catch (error) {
    warnings.push({ level: 'error', text: `流水线构建失败（已降级为空）：${String((error && error.message) || error)}` })
    pipeline = { specId: spec.id, version: spec.version, title: spec.title, note: spec.note, hasOverride: spec.hasOverride, overridePath: spec.overridePath, specErrors: [...spec.errors, String((error && error.message) || error)], stages: [], doneStages: 0, stageCount: 0, doneSteps: 0, stepCount: 0 }
  }
  // segments.json 坏了/是空的：明说一句，别静默当成"还没分镜"（独立核验 L3）
  {
    const segAbs = resolveIn(songRoot, `${planDir}/segments.json`)
    if (segAbs && statSafe(segAbs).exists && totalSegments === 0) {
      warnings.push({ level: 'warn', text: `${planDir}/segments.json 存在但读不出分镜（空文件或格式不对）——面板按"还没有分镜"显示，请核对这个文件。` })
    }
  }
  for (const err of spec.errors) warnings.push({ level: 'error', text: `流水线 spec：${err}` })

  const cfgPath = path.join(songRoot, '翻填项目.json')
  const configMeta = statSafe(cfgPath).exists
    ? { path: cfgPath, sha256: sha256File(cfgPath), mtimeMs: statSafe(cfgPath).mtimeMs }
    : { path: cfgPath, sha256: null, mtimeMs: null }

  return {
    ok: true,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    workspace: songRoot,
    song: (cfg && cfg.song) || null,
    config: {
      schema: cfg.schema ?? null,
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
      budget: cfg.budget ?? null,
      cover: cfg.cover ?? null,
      credits: cfg.credits ?? null,
      audio: {
        separation: audio.separation ?? null,
        voice: audio.voice ?? null,
        loudness: audio.loudness ?? null,
      },
    },
    configError: cfg.__error ?? null,
    configMeta,
    /** 原始配置（v2 新增）：阶段 1 的表单要按字段名读写真实值。 */
    configRaw: (cfg && !cfg.__missing && !cfg.__error) ? cfg : null,
    configProblems: state.configProblems,
    configWarnings: state.configWarnings,
    progress: { header: state.progress.header, stages: state.progress.stages, markdown: state.progressMd },
    segments: {
      total: totalSegments,
      done: doneSegments,
      list: segments.map((s) => ({
        idx: s.idx, slug: s.slug, start: s.start, end: s.end, dur: s.dur, genDur: s.genDur,
        mode: s.mode, mat: s.mat, mat2: s.mat2, trans: s.trans, note: s.note,
        lyrics: s.lyrics ?? [], hasClip: doneIdx.has(s.idx),
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
    ledger: { rows: state.ledger.rows, total: ledgerTotal, budget: budgetTotal },
    clips: clipList,
    warnings,
    aceRunning: env.ace.running,
    decisions: state.decisions,
    ticks: state.ticks,
    env,
    pipeline,
    jobs: {
      running: jobs.running(),
      recent: jobs.list(3),
    },
  }
}

// ── 动作执行 ────────────────────────────────────────────────────────────────

function findAllActions(pipeline, songRoot) {
  const out = []
  for (const stage of pipeline.stages) {
    for (const action of stage.actions) out.push({ ...action, stageId: stage.id, stageTitle: stage.title })
  }
  return out
}

function runBuiltin(builtinId, { songRoot, state, env }) {
  if (builtinId === 'config-check') {
    return { ok: state.configProblems.length === 0, builtin: builtinId, problems: state.configProblems, warnings: state.configWarnings }
  }
  if (builtinId === 'env-probe') {
    return { ok: true, builtin: builtinId, env }
  }
  return { ok: false, builtin: builtinId, error: `未知内置动作：${builtinId}` }
}

// ── 插件入口 ────────────────────────────────────────────────────────────────

export function apply(ctx, config = {}) {
  const pluginDir = path.dirname(fileURLToPath(import.meta.url))
  const workspace = path.resolve(config.workspace || process.cwd())
  const templateRoot = config.templateRoot ? path.resolve(config.templateRoot) : workspace
  const backupDir = path.join(pluginDir, '..', '_probe', 'backup', 'config')
  const maxUploadBytes = Number(config.maxUploadMb) > 0 ? Number(config.maxUploadMb) * 1024 * 1024 : DEFAULT_MAX_UPLOAD_BYTES
  /** 歌曲注册表：默认放插件目录（E 盘），可被 config.registryPath 改到别处（自检也用它做隔离）。 */
  const registryPath = config.registryPath ? path.resolve(config.registryPath) : path.join(pluginDir, 'songs.json')
  const jobs = createJobs({})
  /** 允许在歌根外使用的解释器（本机 venv 的 python 之类）——机器事实写在配置里。 */
  const allowedInterpreters = () => [
    ...(Array.isArray(config.allowedInterpreters) ? config.allowedInterpreters : []),
    ...(Array.isArray(config.allowedInterpretersExtra) ? config.allowedInterpretersExtra : []),
  ].filter((x) => typeof x === 'string' && x !== '')
  /** spec 缓存：按歌根缓存，mtime 变化就重读（用户改 工作台流水线.json 后刷新即生效）。 */
  const specCache = {
    map: new Map(),
    get(songRoot) {
      const overridePath = path.join(songRoot, '工作台流水线.json')
      const defPath = path.join(pluginDir, 'pipeline.default.json')
      const stamp = `${statSafe(defPath).mtimeMs ?? 0}|${statSafe(overridePath).mtimeMs ?? 0}`
      const hit = this.map.get(songRoot)
      if (hit && hit.stamp === stamp) return hit.spec
      const spec = loadSpec(pluginDir, songRoot)
      this.map.set(songRoot, { stamp, spec })
      return spec
    },
  }

  const songRoots = () => resolveSongs({ workspace, config, pluginDir, registryPath })
  /** 已登记的歌曲根（小写）。独立核验 M6：只有它们能被当作 song 参数。 */
  const registeredRoots = () => songRoots().map((s) => s.root.toLowerCase())
  /** 允许浏览的父目录（新建歌向导选父目录用）：已登记歌曲的上一级。 */
  const browseRoots = () => {
    const list = songRoots().map((s) => path.dirname(s.root))
    for (const extra of (Array.isArray(config.browseRoots) ? config.browseRoots : [])) list.push(path.resolve(extra))
    return list
  }
  const pickSong = (wanted) => {
    const list = songRoots()
    if (wanted) {
      const target = path.resolve(String(wanted))
      const hit = list.find((s) => s.root.toLowerCase() === target.toLowerCase())
      return hit ? hit.root : null
    }
    return list.length ? list[0].root : workspace
  }
  const insideAny = (roots, abs) => roots.some((r) => {
    const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)
    const a = norm(path.resolve(abs))
    const b = norm(path.resolve(r))
    return a === b || a.startsWith(b + path.sep)
  })

  const handler = async (req, res) => {
    let url
    try { url = new URL(req.url ?? '/', 'http://localhost') } catch { json(res, 400, { ok: false, error: 'bad url' }); return }
    if (!url.pathname.startsWith(PREFIX)) { json(res, 404, { ok: false, error: 'not found' }); return }
    const rest = url.pathname.slice(PREFIX.length) || '/'
    const q = url.searchParams
    const mutating = ['/upload', '/link', '/config', '/state', '/songs', '/run', '/job/cancel', '/reveal'].includes(rest)

    try {
      if (mutating) {
        const guard = guardMutation(req)
        if (!guard.ok) { json(res, guard.code, { ok: false, error: guard.error }); return }
      }
      // 只读端点只认 GET/HEAD（独立核验 L2：之前 `DELETE /snapshot` 也会 200）
      if (['/ping', '/snapshot', '/', '/ls', '/job'].includes(rest)) {
        const method = (req.method || 'GET').toUpperCase()
        if (method !== 'GET' && method !== 'HEAD') { json(res, 405, { ok: false, error: `只读端点不接受 ${method}` }); return }
      }

      // ── 存活 ────────────────────────────────────────────────────────────
      if (rest === '/ping') { json(res, 200, { ok: true, workspace, version: VERSION }); return }

      // ── 快照 ────────────────────────────────────────────────────────────
      if (rest === '/snapshot' || rest === '/') {
        const songRoot = pickSong(q.get('song'))
        if (!songRoot) { json(res, 404, { ok: false, error: `未知歌曲：${q.get('song')}` }); return }
        const snap = buildSnapshot({ songRoot, pluginDir, config, jobs, specCache, allowedInterpreters: allowedInterpreters() })
        snap.songs = songRoots().map((s) => songSummary(s.root, { id: s.root }))
        snap.active = songRoot
        snap.backupDir = backupDir
        json(res, 200, snap)
        return
      }

      // ── 目录列举 ────────────────────────────────────────────────────────
      if (rest === '/ls') {
        // 两种用法：①`song=` 必须是**已登记**的歌（独立核验 M6：不再接受任意现存目录）
        //          ②`dir=` 只允许已登记歌曲的父目录（新建歌向导选父目录用）
        const dirParam = q.get('dir')
        let baseAbs = null
        let songRoot = null
        if (dirParam) {
          const target = path.resolve(String(dirParam))
          if (!insideAny(browseRoots(), target)) {
            json(res, 403, { ok: false, error: '这个目录不在允许浏览的范围内（只允许已登记歌曲的父目录，或配置 browseRoots 里的目录）' })
            return
          }
          baseAbs = target
        } else {
          songRoot = pickSong(q.get('song'))
          if (!songRoot) { json(res, 404, { ok: false, error: '未知歌曲（只接受已登记的歌曲根）' }); return }
          const rel = sanitizeRel(q.get('path') || '')
          baseAbs = rel ? resolveIn(songRoot, rel) : songRoot
          if (!baseAbs) { json(res, 400, { ok: false, error: '路径越界' }); return }
        }
        const st = statSafe(baseAbs)
        if (!st.exists || !st.isDir) { json(res, 404, { ok: false, error: `目录不存在：${baseAbs}` }); return }
        const entries = []
        let truncated = false
        const baseRel = songRoot ? (relOf(songRoot, baseAbs) || '') : ''
        for (const e of fs.readdirSync(baseAbs, { withFileTypes: true })) {
          if (entries.length >= 500) { truncated = true; break }
          if (e.name.startsWith('.')) continue
          const relPath = songRoot ? (baseRel ? `${baseRel}/${e.name}` : e.name) : e.name
          if (e.isDirectory() && LS_SKIP.has(e.name)) { entries.push({ name: e.name, rel: relPath, isDir: true, skipped: true }); continue }
          const s = statSafe(path.join(baseAbs, e.name))
          entries.push({ name: e.name, rel: relPath, isDir: e.isDirectory(), bytes: s.bytes ?? 0, mtimeMs: s.mtimeMs ?? null })
        }
        entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : (a.isDir ? -1 : 1)))
        json(res, 200, { ok: true, song: songRoot, dir: songRoot ? null : baseAbs, path: baseRel, entries, truncated })
        return
      }

      // ── 上传 ────────────────────────────────────────────────────────────
      if (rest === '/upload') {
        const songRoot = pickSong(q.get('song'))
        if (!songRoot) { json(res, 404, { ok: false, error: '未知歌曲' }); return }
        const state = loadSongState(songRoot)
        const spec = specCache.get(songRoot)
        const ctx = makeCtx({ songRoot, state })
        let slot = null
        for (const stage of spec.stages) {
          for (const s of (stage.slots || [])) if (s.id === q.get('slot')) slot = s
        }
        if (!slot) { json(res, 400, { ok: false, error: `spec 里没有这个素材槽：${q.get('slot')}` }); return }
        const expectSha = q.get('expectSha')
        if (expectSha && expectSha !== sha256File(path.join(songRoot, '翻填项目.json'))) {
          json(res, 409, { ok: false, error: '配置在别处被改过，请刷新后重试' })
          return
        }
        const relDir = sanitizeRel(q.get('rel') || '')
        const targetDir = resolveTargetDir(slot, ctx)
        if (!targetDir) { json(res, 400, { ok: false, error: '槽没有声明 targetDir' }); return }
        const dirAbs = resolveIn(songRoot, path.posix.join(targetDir, relDir))
        if (!dirAbs) { json(res, 400, { ok: false, error: '目标目录越界' }); return }
        const name = sanitizeName(q.get('name') || slot.suggestedName || 'file')
        const ext = path.extname(name).toLowerCase()
        if (Array.isArray(slot.accept) && slot.accept.length && !slot.accept.includes(ext)) {
          json(res, 400, { ok: false, error: `这个槽只接受 ${slot.accept.join('/')}（收到 ${ext || '无扩展名'}）` })
          return
        }
        const finalName = slot.suggestedName
          ? `${sanitizeName(slot.suggestedName)}${ext || ''}`
          : name
        const written = await streamRequestToFile(req, path.join(dirAbs, finalName), {
          maxBytes: maxUploadBytes,
          // 独立核验 M3：超限时**先把 413 写出去**，等响应发完再断流；否则浏览器只看到"网络错误"
          onOversize: async ({ bytes, maxBytes }) => {
            json(res, 413, { ok: false, error: `文件超过上限 ${maxBytes} 字节（已收到 ${bytes} 字节）` })
            await new Promise((r) => { res.on('finish', r); res.on('close', r); setTimeout(r, 1500) })
            try { req.destroy() } catch { /* ignore */ }
          },
        })
        if (!written.ok) {
          if (written.responded) return                 // 响应已经写过 413
          json(res, written.oversize ? 413 : 400, written)
          return
        }
        const relPath = relOf(songRoot, written.path)
        let patched = null
        if (slot.configKey) {
          const patch = {}
          const keys = [slot.configKey, ...(slot.alsoKeys || [])]
          for (const k of keys) {
            const parts = k.split('.')
            let node = patch
            for (let i = 0; i < parts.length - 1; i += 1) { node[parts[i]] = node[parts[i]] || {}; node = node[parts[i]] }
            node[parts[parts.length - 1]] = relPath
          }
          patched = patchConfig({ songRoot, patch, expect: expectSha ? { sha256: expectSha } : undefined, backupDir })
          if (!patched.ok) {
            json(res, patched.code || 400, { ok: false, error: patched.error, written: relPath, note: '文件已落盘，配置未改' })
            return
          }
        }
        json(res, 200, { ok: true, slot: slot.id, path: relPath, bytes: written.bytes, configPatched: !!slot.configKey, backup: patched && patched.backup, sha256: patched && patched.sha256 })
        return
      }

      // ── 就地指定 / 复制入库 ─────────────────────────────────────────────
      if (rest === '/link') {
        const body = await readJsonBody(req)
        const songRoot = pickSong(body.song || q.get('song'))
        if (!songRoot) { json(res, 404, { ok: false, error: '未知歌曲' }); return }
        const state = loadSongState(songRoot)
        const spec = specCache.get(songRoot)
        const ctx = makeCtx({ songRoot, state })
        let slot = null
        for (const stage of (spec.stages || [])) for (const s of (stage.slots || [])) if (s.id === body.slot) slot = s
        if (!slot) { json(res, 400, { ok: false, error: `spec 里没有这个素材槽：${body.slot}` }); return }
        const raw = String(body.path || '').trim().replace(/^"|"$/g, '')
        if (!raw) { json(res, 400, { ok: false, error: '缺少 path' }); return }
        const abs = path.isAbsolute(raw) ? path.resolve(raw) : resolveIn(songRoot, raw)
        if (!abs) { json(res, 400, { ok: false, error: '路径越界' }); return }
        const st = statSafe(abs)
        if (!st.exists || st.isDir) { json(res, 404, { ok: false, error: `文件不存在：${raw}` }); return }
        const ext = path.extname(abs).toLowerCase()
        if (Array.isArray(slot.accept) && slot.accept.length && !slot.accept.includes(ext)) {
          json(res, 400, { ok: false, error: `这个槽只接受 ${slot.accept.join('/')}` })
          return
        }
        if (body.expectSha && body.expectSha !== sha256File(path.join(songRoot, '翻填项目.json'))) {
          json(res, 409, { ok: false, error: '配置在别处被改过，请刷新后重试' })
          return
        }
        const inside = !!relOf(songRoot, abs)
        const mode = inside && body.mode !== 'copy' ? 'inplace' : 'copy'
        let relPath = relOf(songRoot, abs)
        if (mode === 'copy') {
          const targetDir = resolveTargetDir(slot, ctx)
          const dirAbs = resolveIn(songRoot, targetDir)
          if (!dirAbs) { json(res, 400, { ok: false, error: '目标目录越界' }); return }
          const copied = copyInto(abs, dirAbs, slot.suggestedName ? `${sanitizeName(slot.suggestedName)}${path.extname(abs)}` : path.basename(abs), { maxBytes: maxUploadBytes })
          if (!copied.ok) { json(res, 400, copied); return }
          relPath = relOf(songRoot, copied.path)
        }
        let patched = null
        if (slot.configKey) {
          const patch = {}
          for (const k of [slot.configKey, ...(slot.alsoKeys || [])]) {
            const parts = k.split('.')
            let node = patch
            for (let i = 0; i < parts.length - 1; i += 1) { node[parts[i]] = node[parts[i]] || {}; node = node[parts[i]] }
            node[parts[parts.length - 1]] = relPath
          }
          patched = patchConfig({ songRoot, patch, expect: body.expectSha ? { sha256: body.expectSha } : undefined, backupDir })
          if (!patched.ok) { json(res, patched.code || 400, patched); return }
        }
        json(res, 200, { ok: true, slot: slot.id, mode, path: relPath, configPatched: !!slot.configKey, backup: patched && patched.backup, sha256: patched && patched.sha256 })
        return
      }

      // ── 写配置 ──────────────────────────────────────────────────────────
      if (rest === '/config') {
        const body = await readJsonBody(req)
        const songRoot = pickSong(body.song || q.get('song'))
        if (!songRoot) { json(res, 404, { ok: false, error: '未知歌曲' }); return }
        const out = patchConfig({ songRoot, patch: body.patch, expect: body.expect, backupDir })
        if (!out.ok) { json(res, out.code || 400, out); return }
        const after = loadSongState(songRoot)
        json(res, 200, { ok: true, backup: out.backup, sha256: out.sha256, mtimeMs: out.mtimeMs, problems: after.configProblems, warnings: after.configWarnings })
        return
      }

      // ── 人工勾选 ────────────────────────────────────────────────────────
      if (rest === '/state') {
        const body = await readJsonBody(req)
        const songRoot = pickSong(body.song || q.get('song'))
        if (!songRoot) { json(res, 404, { ok: false, error: '未知歌曲' }); return }
        const out = patchTicks({ songRoot, ticks: body.ticks })
        json(res, 200, out)
        return
      }

      // ── 歌曲注册表 ──────────────────────────────────────────────────────
      if (rest === '/songs') {
        const body = await readJsonBody(req)
        const regAbs = registryPath
        const reg = (() => { const r = readJsonSafe(regAbs); return (!r || r.__missing || r.__error) ? { songs: [] } : r })()
        const current = Array.isArray(reg.songs) ? reg.songs : []
        if (body.action === 'create') {
          const parent = String(body.parentDir || '').trim()
          const songName = String(body.name || '').trim()
          if (!parent || !songName) { json(res, 400, { ok: false, error: '缺少 parentDir 或 name' }); return }
          const parentAbs = path.resolve(parent)
          if (!statSafe(parentAbs).isDir) { json(res, 400, { ok: false, error: `父目录不存在：${parentAbs}` }); return }
          if (!insideAny(browseRoots(), parentAbs)) {
            json(res, 400, { ok: false, error: '父目录不在允许范围内（只允许已登记歌曲的父目录，或配置 browseRoots 里的目录）' })
            return
          }
          const safeName = sanitizeName(songName, '新歌')
          if (safeName !== songName.replace(/[\\/]/g, '')) {
            json(res, 400, { ok: false, error: `歌名不合法：${songName}` })
            return
          }
          const root = path.join(parentAbs, safeName)
          const made = createSongSkeleton({ root, fields: { ...(body.fields || {}), __parentDir: parentAbs }, templateRoot, pluginDir })
          if (!made.ok) { json(res, made.code || 400, made); return }
          const songs = upsertRegistrySong(current, { id: made.root, root: made.root, name: songName })
          const regPath = writeRegistrySafe(registryPath, songs)
          json(res, 200, { ok: true, ...made, registry: regPath, song: songSummary(made.root, { id: made.root }) })
          return
        }
        if (body.action === 'attach') {
          const root = path.resolve(String(body.root || '').trim())
          if (!root || !statSafe(root).isDir) { json(res, 400, { ok: false, error: '目录不存在' }); return }
          const songs = upsertRegistrySong(current, { id: root, root, name: body.name || path.basename(root) })
          const regPath = writeRegistrySafe(registryPath, songs)
          json(res, 200, { ok: true, registry: regPath, song: songSummary(root, { id: root }) })
          return
        }
        if (body.action === 'forget') {
          const songs = forgetRegistrySong(current, String(body.id || ''))
          const regPath = writeRegistrySafe(registryPath, songs)
          json(res, 200, { ok: true, registry: regPath, note: '只是从列表移除，磁盘上的文件一个都没动' })
          return
        }
        json(res, 400, { ok: false, error: `未知 action：${body.action}` })
        return
      }

      // ── 跑动作 ──────────────────────────────────────────────────────────
      if (rest === '/run') {
        const body = await readJsonBody(req)
        const songRoot = pickSong(body.song || q.get('song'))
        if (!songRoot) { json(res, 404, { ok: false, error: '未知歌曲（只接受已登记的歌曲根）' }); return }
        if (typeof body.actionId !== 'string' || body.actionId.trim() === '') {
          json(res, 400, { ok: false, error: '必须显式给 actionId' })
          return
        }
        const state = loadSongState(songRoot)
        const spec = specCache.get(songRoot)
        const env = envProbe({ songRoot, config: state.config, pluginConfig: config, songState: state })
        const pipeline = buildPipeline({ spec, state, songRoot, allowedInterpreters: allowedInterpreters() })
        const actions = findAllActions(pipeline, songRoot)
        const action = actions.find((a) => a.id === body.actionId)
        if (!action) { json(res, 400, { ok: false, error: `未知动作：${body.actionId}` }); return }
        if (action.kind === 'paid' || action.costCny > 0) {
          json(res, 403, { ok: false, error: '付费动作不允许工作台执行——请用「让 agent 跑」并先确认报价。' })
          return
        }
        if (!action.available) {
          json(res, 409, { ok: false, error: `这个动作的前提还没满足：${action.reason || '未知原因'}` })
          return
        }
        // 需要二次确认的两类：写产物的动作；以及**来自本歌覆盖文件**的动作（未受信，独立核验 H2）
        if (action.requiresConfirm && body.confirm !== true) {
          json(res, 403, { ok: false, error: action.untrusted
            ? '这个动作来自本歌覆盖文件（等于本机命令），必须明确确认（confirm: true）'
            : '这个动作会写产物，需要明确确认（confirm: true）' })
          return
        }
        const rawAction = findRawAction(spec, action.id)
        if (!rawAction) { json(res, 500, { ok: false, error: 'spec 与动作表不一致' }); return }
        const ctxVars = makeCtx({ songRoot, state })
        if (rawAction.exec && rawAction.exec.builtin) {
          const out = runBuiltin(rawAction.exec.builtin, { songRoot, state, env })
          json(res, out.ok ? 200 : 400, { ...out, builtin: true })
          return
        }
        const interpreter = resolveVars(rawAction.interpreter, ctxVars, 'abs')
        const argv = (rawAction.argv || []).map((a) => resolveVars(a, ctxVars, 'abs'))
        let job
        try {
          job = jobs.start({
            songRoot,
            label: `${action.stageTitle} · ${action.label}`,
            interpreter,
            argv,
            timeoutMs: action.timeoutMs,
            actionId: action.id,
            songId: songRoot,
            kind: action.kind,
          })
        } catch (error) {
          json(res, error.code === 429 ? 429 : 500, { ok: false, error: String((error && error.message) || error) })
          return
        }
        json(res, 200, { ok: true, jobId: job.id, command: [interpreter, ...argv].join(' ') })
        return
      }

      // ── 作业 ────────────────────────────────────────────────────────────
      if (rest === '/job') {
        const id = q.get('job')
        const view = jobs.get(id, Number(q.get('tail')) || 200)
        if (!view) { json(res, 404, { ok: false, error: `未知作业：${id}` }); return }
        json(res, 200, { ok: true, job: view })
        return
      }
      if (rest === '/job/cancel') {
        const body = await readJsonBody(req)
        const out = jobs.kill(body.job, body.reason || 'user')
        json(res, out.ok ? 200 : 400, { ok: out.ok, error: out.error, job: jobs.get(body.job, 20) })
        return
      }

      // ── 在资源管理器里定位 ──────────────────────────────────────────────
      if (rest === '/reveal') {
        const body = await readJsonBody(req)
        const songRoot = pickSong(body.song || q.get('song'))
        if (!songRoot) { json(res, 404, { ok: false, error: '未知歌曲' }); return }
        const abs = resolveIn(songRoot, String(body.path || ''))
        if (!abs) { json(res, 400, { ok: false, error: '路径越界' }); return }
        const st = statSafe(abs)
        if (!st.exists) { json(res, 404, { ok: false, error: '产物还不存在' }); return }
        try {
          if (st.isDir) spawn('explorer', [abs], { detached: true, windowsHide: true }).unref()
          else spawn('explorer', ['/select,', abs], { detached: true, windowsHide: true }).unref()
        } catch (error) {
          json(res, 500, { ok: false, error: `打开失败：${String((error && error.message) || error)}` })
          return
        }
        json(res, 200, { ok: true, path: abs })
        return
      }

      json(res, 404, { ok: false, error: `unknown endpoint: ${rest}` })
    } catch (error) {
      json(res, Number(error && error.code) || 500, { ok: false, error: String((error && error.message) || error) })
    }
  }

  const dispose = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler })
  ctx.effect(() => dispose)
  ctx.logger?.info?.(`[翻填工作台] v${VERSION} 路由已挂载：${PREFIX}（workspace=${workspace}，pluginDir=${pluginDir}）`)
}

function writeRegistrySafe(abs, songs) {
  const payload = { schema: 1, updatedAt: new Date().toISOString(), songs }
  ensureDir(path.dirname(abs))
  const tmp = `${abs}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmp, abs)
  return abs
}

function findRawAction(spec, actionId) {
  for (const stage of (spec.stages || [])) {
    for (const action of (stage.actions || [])) if (action.id === actionId) return action
  }
  return null
}
