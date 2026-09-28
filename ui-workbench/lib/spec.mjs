/**
 * 翻填工作台 · 流水线 spec 层
 *
 * 引导内容（每个阶段要什么素材、能跑什么动作、产物与验收怎么算）全部来自数据文件：
 *   - 通用骨架：插件目录里的 pipeline.default.json
 *   - 本歌覆盖：<歌根>/工作台流水线.json（可选，按 stage id 追加/覆盖）
 *
 * 这一层只做纯函数：解析占位符、求值检查器、把 spec + 歌曲状态拼成面板要的 pipeline 结构。
 * 不写任何文件、不启动任何进程。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dirname, join } from 'node:path'
import { resolveIn, statSafe, insideRealPath } from './state.mjs'

export function readSpecFile(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch (error) {
    return { __error: String((error && error.message) || error), __path: abs }
  }
}

/** 通用骨架 + 本歌覆盖（追加/覆盖白名单字段；未知字段报错而不是静默丢弃）。 */
const MERGEABLE_STAGE_FIELDS = ['slots', 'actions', 'form', 'notes', 'steps', 'artifacts']
const MERGEABLE_SCALARS = ['title', 'goal', 'gate', 'runner', 'agentPrompt', 'line']

export function loadSpec(pluginDir, songRoot) {
  const def = readSpecFile(join(pluginDir, 'pipeline.default.json'))
  const overrideAbs = join(songRoot, '工作台流水线.json')
  const override = fs.existsSync(overrideAbs) ? readSpecFile(overrideAbs) : null
  const errors = []
  if (def.__error) errors.push(`pipeline.default.json 解析失败：${def.__error}`)
  if (override && override.__error) errors.push(`工作台流水线.json 解析失败：${override.__error}`)
  const stages = Array.isArray(def.stages) ? def.stages.map((s) => ({ ...s })) : []
  if (override && override.stages && typeof override.stages === 'object') {
    for (const [sid, patch] of Object.entries(override.stages)) {
      const stage = stages.find((s) => s.id === sid)
      if (!stage) { errors.push(`覆盖文件里的阶段 ${sid} 在通用骨架里不存在`); continue }
      if (!patch || typeof patch !== 'object') { errors.push(`覆盖文件里阶段 ${sid} 不是对象`); continue }
      for (const [key, value] of Object.entries(patch)) {
        if (MERGEABLE_STAGE_FIELDS.includes(key)) {
          stage[key] = mergeById(stage[key] || [], value)
          continue
        }
        if (MERGEABLE_SCALARS.includes(key)) { stage[key] = value; continue }
        errors.push(`覆盖文件里阶段 ${sid} 的字段 ${key} 不在可覆盖白名单里（已忽略）`)
      }
    }
  }
  return {
    id: def.id || 'fanfill-pipeline',
    version: def.version || '0',
    title: def.title || '翻填流水线',
    note: def.note || [],
    stages,
    errors,
    hasOverride: !!override,
    overridePath: fs.existsSync(overrideAbs) ? overrideAbs : null,
  }
}

/** 合并时跳过非对象条目，并且给来自覆盖文件的动作打上"未受信"标记。 */
function mergeById(base, extra) {
  const out = (Array.isArray(base) ? base : []).filter((x) => x && typeof x === 'object')
  const list = (Array.isArray(extra) ? extra : []).filter((x) => x && typeof x === 'object')
  for (const item of list) {
    const i = item && item.id ? out.findIndex((x) => x && x.id === item.id) : -1
    if (i >= 0) out[i] = { ...out[i], ...item, __fromOverride: true }
    else out.push({ ...item, __fromOverride: true })
  }
  return out
}

// ── 占位符 ──────────────────────────────────────────────────────────────────

function deepGet(obj, dotted) {
  let cur = obj
  for (const part of String(dotted).split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

/** 构造占位符解析上下文（纯数据，可被 evalCheck / resolveVars 复用）。 */
export function makeCtx({ songRoot, state, extras = {} }) {
  const config = state.config && !state.config.__missing && !state.config.__error ? state.config : {}
  const dirs = state.dirs || {}
  const deliver = Array.isArray(config.video && config.video.deliverRes) ? config.video.deliverRes[0] : null
  return {
    songRoot,
    config,
    dirs,
    ticks: state.ticks || {},
    extras,
    deliverTag: (deliver && deliver.tag) || '1080',
    deliverSize: (deliver && deliver.size) || null,
    resolve: (rel) => resolveIn(songRoot, rel),
    get: (dotted) => deepGet(config, dotted),
  }
}

/**
 * 替换 {{...}}。
 * @param {string} text
 * @param {object} ctx
 * @param {'rel'|'abs'} mode - config/dirs 类占位符解析成相对路径还是绝对路径
 */
export function resolveVars(text, ctx, mode = 'rel') {
  if (typeof text !== 'string') return text
  const asPath = (value, whole) => {
    if (typeof value !== 'string' || value === '') return value
    if (mode === 'abs') {
      const abs = ctx.resolve(value)
      // 越界（含 .. 或绝对路径）时不把原值塞进命令行：保留占位符，让静态校验把它拦下来
      return abs || whole
    }
    return value.replace(/\\/g, '/')
  }
  return text.replace(/\{\{([^}]+)\}\}/g, (whole, expr) => {
    const key = expr.trim()
    if (key.startsWith('config.')) {
      const v = ctx.get(key.slice('config.'.length))
      return v === undefined || v === null ? whole : asPath(String(v), whole)
    }
    if (key.startsWith('dirs.')) {
      const v = ctx.dirs[key.slice('dirs.'.length)]
      return v === undefined || v === null ? whole : asPath(String(v), whole)
    }
    switch (key) {
      case 'root': return ctx.songRoot
      case 'song.name': return (ctx.get('song.name') ?? '') || whole
      case 'deliverTag': return ctx.deliverTag
      case 'deliverWidth': return ctx.deliverSize ? String(ctx.deliverSize[0]) : whole
      case 'deliverHeight': return ctx.deliverSize ? String(ctx.deliverSize[1]) : whole
      default: {
        const v = ctx.extras[key]
        return v === undefined || v === null ? whole : String(v)
      }
    }
  })
}

// ── 检查器 ──────────────────────────────────────────────────────────────────

function globCount(root, pattern) {
  // 独立核验 M5：模式也要过 resolveIn —— 配置里把 promptDir 写成 `..` 时，
  // 之前会把歌根外的文件算成"步骤已完成"。越界模式返回 -1。
  const abs = resolveIn(root, pattern)
  if (!abs) return -1
  const dir = dirname(abs)
  const base = path.basename(abs)
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$', 'i')
  let n = 0
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of entries) {
    if (!e.isFile()) continue
    if (re.test(e.name)) n += 1
  }
  return n
}

/**
 * 求值一个检查器。
 * @returns {{ok: boolean, detail: string}}
 */
export function evalCheck(check, ctx) {
  if (!check || typeof check !== 'object') return { ok: false, detail: '非法检查器' }
  switch (check.kind) {
    case 'configKey': {
      const v = ctx.get(check.key)
      const ok = v !== undefined && v !== null && v !== ''
      return { ok, detail: ok ? `${check.key} = ${v}` : `${check.key} 未填` }
    }
    case 'file': {
      const rel = resolveVars(check.path, ctx, 'rel')
      const abs = ctx.resolve(rel)
      const st = abs ? statSafe(abs) : { exists: false }
      return { ok: !!st.exists, detail: `${rel}${st.exists ? '' : ' 不存在'}` }
    }
    case 'glob': {
      const pattern = resolveVars(check.pattern, ctx, 'rel')
      const n = globCount(ctx.songRoot, pattern)
      const min = typeof check.min === 'number' ? check.min : 1
      if (n < 0) return { ok: false, detail: `${pattern} 越界（含 .. 或绝对路径），拒绝判定` }
      return { ok: n >= min, detail: `${pattern} → ${n} 个（需要 ≥${min}）` }
    }
    case 'manual': {
      const stepId = ctx.currentStepId
      const done = !!(stepId && ctx.ticks[stepId] && ctx.ticks[stepId].done)
      return { ok: done, detail: done ? '已人工勾选' : '待你勾选/确认' }
    }
    case 'allOf':
    case 'anyOf': {
      const list = (Array.isArray(check.of) ? check.of : []).filter((c) => c && typeof c === 'object')
      const results = list.map((c) => evalCheck(c, ctx))
      const ok = check.kind === 'allOf' ? results.every((r) => r.ok) : results.some((r) => r.ok)
      const failed = results.filter((r) => !r.ok).map((r) => r.detail)
      return { ok, detail: ok ? `${results.length} 项满足` : `未满足：${failed.join('；')}` }
    }
    default:
      return { ok: false, detail: `未知检查器 kind=${check.kind}` }
  }
}

/**
 * 求值一组检查器。
 * @param {any[]} checks
 * @param {object} ctx
 * @param {boolean} emptyOk - 空列表算不算满足。步骤的 outputs 用 false（没声明=没完成）；
 *   动作的 requires 用 true（没声明前提=随时可跑）。
 */
export function evalAll(checks, ctx, emptyOk = false) {
  const list = Array.isArray(checks) ? checks : []
  const results = list.map((c) => evalCheck(c, ctx))
  if (results.length === 0) return { ok: !!emptyOk, results }
  return { ok: results.every((r) => r.ok), results }
}

export function interpreterAvailable(interpreter) {
  if (typeof interpreter !== 'string' || interpreter === '') return { ok: false, reason: '未声明解释器' }
  if (!path.isAbsolute(interpreter)) return { ok: true, reason: '' } // node / powershell 等，靠 PATH 解析
  const st = statSafe(interpreter)
  return st.exists ? { ok: true, reason: '' } : { ok: false, reason: `解释器不存在：${interpreter}` }
}

/** 把 {{dirs.x}} 这类目标目录解析成歌根相对路径（可能带子目录）。 */
export function resolveTargetDir(slot, ctx) {
  const raw = (stepSafe(slot.targetDir, ctx, 'rel') || '').replace(/\\/g, '/')
  return raw.replace(/^\.\//, '').replace(/\/+$/, '')
}

function stepSafe(text, ctx, mode) {
  return typeof text === 'string' ? resolveVars(text, ctx, mode) : text
}

/**
 * 动作的静态安全校验（独立核验 H2 / L8）：
 *   ① 解释器要么是不带路径分隔符的命令名（走 PATH），要么其真实路径在歌根内、或写进配置白名单；
 *   ② argv 里不许残留没解析出来的占位符，也不许出现 `..` 段。
 * 来自本歌覆盖文件的动作一律 `untrusted`：无论它自称 writes:false，都必须二次确认。
 */
export function checkActionSafety(action, ctx, allowedInterpreters = []) {
  const reasons = []
  const interp = action.interpreter
  if (action.exec && action.exec.builtin) return { ok: true, reasons, untrusted: !!action.__fromOverride }
  if (typeof interp !== 'string' || interp === '') reasons.push('未声明解释器')
  else if (interp.includes('/') || interp.includes('\\')) {
    const abs = path.isAbsolute(interp) ? interp : ctx.resolve(interp)
    const same = (a) => allowedInterpreters.some((x) => {
      const nx = path.resolve(x)
      return process.platform === 'win32' ? nx.toLowerCase() === path.resolve(a).toLowerCase() : nx === path.resolve(a)
    })
    const inside = abs ? insideRealPath(ctx.songRoot, abs) : false
    if (!abs) reasons.push(`解释器路径不合法：${interp}`)
    else if (!inside && !same(abs)) reasons.push(`解释器在歌根外且未列入白名单：${interp}`)
    else if (!statSafe(abs).exists) reasons.push(`解释器不存在：${abs}`)
  }
  for (const a of (Array.isArray(action.argv) ? action.argv : [])) {
    if (typeof a !== 'string') continue
    if (a.includes('{{')) { reasons.push(`参数里的占位符没解析出来（配置里那个键可能为空或越界）：${a}`); break }
    if (a.replace(/\\/g, '/').split('/').includes('..')) { reasons.push(`参数含 .. 越界：${a}`); break }
  }
  return { ok: reasons.length === 0, reasons, untrusted: !!action.__fromOverride }
}

// ── 组装 pipeline（面板要的结构）─────────────────────────────────────────────

/**
 * @param {object} args
 * @param {object} args.spec  - loadSpec 的结果
 * @param {object} args.state - loadSongState 的结果
 * @param {string} args.songRoot
 * @param {string[]} [args.allowedInterpreters] - 允许在歌根外使用的解释器绝对路径（来自插件配置）
 */
export function buildPipeline({ spec, state, songRoot, extras = {}, allowedInterpreters = [] }) {
  const ctx = makeCtx({ songRoot, state, extras })
  const stages = []

  for (const rawStage of (Array.isArray(spec.stages) ? spec.stages : [])) {
    if (!rawStage || typeof rawStage !== 'object') continue
    const raw = rawStage
    const slots = (Array.isArray(raw.slots) ? raw.slots : []).filter((s) => s && typeof s === 'object').map((slot) => {
      const cfgPath = slot.configKey ? ctx.get(slot.configKey) : null
      const targetDir = resolveTargetDir(slot, ctx)
      const cfgRel = typeof cfgPath === 'string' && cfgPath !== '' ? cfgPath.replace(/\\/g, '/') : null
      const abs = cfgRel ? resolveIn(songRoot, cfgRel) : null
      const st = abs ? statSafe(abs) : { exists: false }
      return {
        id: slot.id,
        label: slot.label,
        hint: slot.hint || '',
        required: !!slot.required,
        accept: slot.accept || [],
        multi: !!slot.multi,
        targetDir,
        suggestedName: slot.suggestedName || null,
        configKey: slot.configKey || null,
        alsoKeys: slot.alsoKeys || [],
        current: cfgRel ? { path: cfgRel, exists: !!st.exists, bytes: st.bytes ?? 0, mtimeMs: st.mtimeMs ?? null } : null,
      }
    })

    const stepCtx = (stepId) => ({ ...ctx, currentStepId: stepId })
    const steps = (Array.isArray(raw.steps) ? raw.steps : []).filter((s) => s && typeof s === 'object').map((step) => {
      const r = evalAll(step.outputs, stepCtx(step.id))
      const manualOnly = (Array.isArray(step.outputs) ? step.outputs : []).some((c) => c && c.kind === 'manual')
      return {
        id: step.id,
        title: step.title,
        state: r.ok ? 'done' : 'todo',
        evidence: r.results.map((x) => x.detail).join(' ｜ '),
        acceptance: step.acceptance || [],
        manual: manualOnly,
      }
    })

    const actions = (Array.isArray(raw.actions) ? raw.actions : []).filter((a) => a && typeof a === 'object').map((action) => {
      const req = evalAll(action.requires, ctx, true)
      // 先解析再校验：占位符本来就该被替换掉，静态检查要看的是**解析后**的命令行。
      //（真实面板上踩过：拿原始 argv 去查 `{{` 会把一条完全正常的动作误判成"占位符没解析出来"。）
      const resolvedInterpreter = resolveVars(action.interpreter, ctx, 'abs')
      const resolvedArgv = (Array.isArray(action.argv) ? action.argv : []).map((a) => resolveVars(a, ctx, 'abs'))
      const interp = action.exec && action.exec.builtin
        ? { ok: true, reason: '' }
        : interpreterAvailable(resolvedInterpreter)
      const safety = checkActionSafety({ ...action, interpreter: resolvedInterpreter, argv: resolvedArgv }, ctx, allowedInterpreters)
      const ok = req.ok && interp.ok && safety.ok
      return {
        id: action.id,
        label: action.label,
        kind: action.kind || 'preview',
        writes: !!action.writes,
        /** 真跑前要不要二次确认：写产物的动作要；**本歌覆盖文件里定义的动作一律要**（未受信）。 */
        requiresConfirm: !!action.writes || safety.untrusted,
        untrusted: safety.untrusted,
        costCny: typeof action.costCny === 'number' ? action.costCny : 0,
        note: action.note || '',
        timeoutMs: action.timeoutMs || 600000,
        available: ok,
        reason: ok ? '' : [interp.reason, ...safety.reasons, ...req.results.filter((x) => !x.ok).map((x) => x.detail)].filter(Boolean).join('；'),
        argvPreview: argvPreview(action, ctx),
      }
    })

    const artifacts = (Array.isArray(raw.artifacts) ? raw.artifacts : []).filter((x) => typeof x === 'string').map((item) => {
      const rel = resolveVars(item, ctx, 'rel')
      const abs = ctx.resolve(rel)
      const st = abs ? statSafe(abs) : { exists: false }
      return { path: rel, exists: !!st.exists, bytes: st.bytes ?? 0, isDir: !!st.isDir }
    })

    const requiredSlots = slots.filter((s) => s.required)
    const missingSlots = requiredSlots.filter((s) => !(s.current && s.current.exists)).map((s) => s.label)
    const todoSteps = steps.filter((s) => s.state !== 'done')

    stages.push({
      id: raw.id,
      n: raw.n,
      line: raw.line || 'both',
      title: raw.title,
      goal: raw.goal,
      gate: raw.gate || '',
      runner: raw.runner || 'agent',
      paid: !!raw.paid,
      notes: raw.notes || [],
      slots,
      steps,
      actions,
      artifacts,
      form: raw.form || [],
      acceptance: (Array.isArray(raw.steps) ? raw.steps : []).flatMap((s) => (s && s.acceptance) || []),
      doneCount: steps.length - todoSteps.length,
      stepCount: steps.length,
      missingSlots,
      todoSteps,
      prompt: buildPrompt(raw.agentPrompt, ctx, { missingSlots, todoSteps, stages: spec.stages }),
    })
  }

  // 状态派生：全 done → done；第一段未完成 → current；其后 → todo；配置有问题 → blocked
  const configBlocked = state.configProblems.length > 0
  let currentSeen = false
  for (const stage of stages) {
    if (stage.stepCount > 0 && stage.doneCount === stage.stepCount) { stage.status = 'done'; continue }
    if (stage.n > 1 && configBlocked) { stage.status = 'blocked'; continue }
    if (!currentSeen) { stage.status = 'current'; currentSeen = true }
    else stage.status = 'todo'
  }

  const doneStages = stages.filter((s) => s.status === 'done').length
  const doneSteps = stages.reduce((a, s) => a + s.doneCount, 0)
  const allSteps = stages.reduce((a, s) => a + s.stepCount, 0)

  return {
    specId: spec.id,
    version: spec.version,
    title: spec.title,
    note: spec.note,
    hasOverride: spec.hasOverride,
    overridePath: spec.overridePath,
    specErrors: spec.errors,
    stages,
    doneStages,
    stageCount: stages.length,
    doneSteps,
    stepCount: allSteps,
  }
}

function argvPreview(action, ctx) {
  if (action.exec && action.exec.builtin) return `[内置] ${action.exec.builtin}`
  const argv = Array.isArray(action.argv) ? action.argv.map((a) => resolveVars(a, ctx, 'abs')) : []
  return [action.interpreter, ...argv].join(' ')
}

function buildPrompt(template, ctx, { missingSlots, todoSteps, stages }) {
  if (!template) return null
  const cfgSummary = [
    `歌名 ${ctx.get('song.name') ?? '—'}`,
    `BPM ${ctx.get('song.bpm') ?? '—'}`,
    `总长 ${ctx.get('song.totalSec') ?? '—'}s`,
    `母版 ${ctx.get('audio.master') || '（缺）'}`,
    `人声 ${ctx.get('audio.aceVocal') || '（缺）'}`,
  ].join('；')
  const extra = {
    missing: missingSlots.length ? missingSlots.join('、') : '（必填素材已齐）',
    materials: `${stages.length} 个阶段中 ${todoSteps.length} 个子步骤未完成`,
    stageStatus: todoSteps.length ? `${todoSteps.length} 个子步骤未完成：${todoSteps.map((s) => s.title).join('、')}` : '本阶段产物已齐',
    configSummary: cfgSummary,
    spent: String(ctx.extras.spentLabel ?? '—'),
    budget: String(ctx.extras.budgetLabel ?? '—'),
  }
  return resolveVars(template, { ...ctx, extras: { ...extra, ...ctx.extras } }, 'rel')
}
