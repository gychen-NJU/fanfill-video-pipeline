#!/usr/bin/env node
/**
 * 82_pv_clips.mjs —— P3：批量出片（复用 h3.mjs，一次调用跑完全片）
 * ---------------------------------------------------------------------------
 * · 段表、参考图（每段的 `refs`）与链式前置（每段的 `chainFrom`）全部来自 `<planDir>/segments.json`
 *   —— 本脚本对段号、参考图、链式关系**零硬编码**（改分镜 = 改 segments.json）
 * · 非链式段按波次并行提交（H3 允许 30 并发），链式段等前一段下载后取其末帧再提交
 * · 每段下载后立刻 ffprobe 核验（时长/分辨率/帧率），不合规**自动重试 ≤2 次**（每次重试都单独记账）
 * · 逐次尝试（含失败）追加记账到 `<planDir>/cost_log.csv`；成功且有花费的批次另记 `_进度/成本台账.csv`
 *
 * 用法：
 *   node scripts/82_pv_clips.mjs --plan            # 只打印计划、--max-cost 推导与重试口径，不发请求、不写产物
 *   node scripts/82_pv_clips.mjs                   # 实跑（--max-cost 默认 = min(78, 预算余额)）
 *   node scripts/82_pv_clips.mjs --only 09,10      # 只跑指定段
 *   node scripts/82_pv_clips.mjs --skip-done       # 跳过已有成片的段
 *   node scripts/82_pv_clips.mjs --max-cost 30 --wave 4
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  loadConfig, loadSegments, parseArgv, log, run, probeMedia, ensureDirs, finishPlan, nonClobber, pad2,
  FFMPEG,
} from './lib/fanfill-config.mjs'

const { arg, has, plan: PLAN_ONLY } = parseArgv()
const ROOT = process.cwd()
const cfg = loadConfig(ROOT)

// ── 路径与参数：全部来自配置 ────────────────────────────────────────────────
// 出片驱动：优先级 = 环境变量 FANFILL_H3 > 配置 video.h3Driver > 项目内默认路径。
// 换机器时不必改代码，指一下就能跑；找不到时下面的 --plan 会明确告诉你缺什么。
const H3 = process.env.FANFILL_H3
  ? path.resolve(process.env.FANFILL_H3)
  : cfg.abs((cfg.raw.video && cfg.raw.video.h3Driver) || 'tools/minimax-h3/h3.mjs')
const CLIPS = cfg.dirs.clips
const REFS = cfg.dirs.refs
const PROMPTS = cfg.dirs.prompts
const TMP = path.join(path.dirname(cfg.dirs.clips), '.tmp')   // 中间产物：链式末帧 / 下载中转
const LOG = path.join(cfg.dirs.plan, 'cost_log.csv')
const LEDGER = cfg.abs('_进度/成本台账.csv')                    // 规范 §8 固定位置
const PRICE = cfg.delivery.pricePerSecond
const MODEL = cfg.delivery.model
const RES = cfg.delivery.baseRes
const ASPECT = cfg.delivery.aspect
const [BW, BH] = cfg.delivery.baseSize
const FPS = Number(cfg.raw.song.fps)

const only = arg('only', '')
const skipDone = has('skip-done')
const WAVE = Number(arg('wave', 6))
const RETRY_MAX = 2                    // 头注口径：失败自动重试 ≤2 次（重试单独记账、也受 --max-cost 约束）

// --max-cost 默认值：min(单批兜底上限 78 元, 预算余额 = budget.totalCny − budget.spentCny)
const BUDGET = cfg.raw.budget || {}
const CAP = Number(BUDGET.totalCny) || 0
const SPENT = Number(BUDGET.spentCny) || 0
const BALANCE = Math.max(0, CAP - SPENT)
const BATCH_FALLBACK = 78
const MAX_COST_DEFAULT = Math.min(BATCH_FALLBACK, BALANCE)
const MAX_COST = Number(arg('max-cost', MAX_COST_DEFAULT))

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

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

// ── 载入分镜（refs / chainFrom 的**唯一来源**）──────────────────────────────
const { segments: allSegs } = loadSegments(cfg)
const byIdx = new Map(allSegs.map((s) => [s.idx, s]))
let segs = allSegs
if (only) {
  const set = new Set(only.split(',').map((s) => Number(s.trim())))
  segs = segs.filter((s) => set.has(s.idx))
}

function promptPathFor(s) {
  const ref = path.join(PROMPTS, 'ref2va', `${pad2(s.idx)}_${s.slug}.txt`)
  if (fs.existsSync(ref)) return { file: ref, kind: 'ref2va' }
  return { file: path.join(PROMPTS, `${pad2(s.idx)}_${s.slug}.txt`), kind: 'base' }
}
const clipFile = (idx, slug) => path.join(CLIPS, `${pad2(idx)}_${slug}.mp4`)

for (const s of segs) {
  const p = promptPathFor(s)
  s._prompt = p.file
  s._kind = p.kind
  s._out = clipFile(s.idx, s.slug)
  s._refs = (Array.isArray(s.refs) ? s.refs : []).map((f) => path.join(REFS, f))
  s._chain = s.chainFrom ?? null
  s._exists = fs.existsSync(s._out)
}

const todo = segs.filter((s) => !(skipDone && s._exists))
const cost = todo.reduce((a, s) => a + s.genDur * PRICE, 0)

console.log('段  名称            模式     生成  参考图                     提示词            成片')
for (const s of todo) {
  console.log(
    String(s.idx).padStart(2) + '  ' + s.slug.padEnd(16) + s._kind.padEnd(9) + String(s.genDur).padStart(3) + 's  ' +
    (s._chain ? ('链式←段' + s._chain).padEnd(24) : (s._refs.length ? s._refs.map((r) => path.basename(r)).join('+') : '(无)').padEnd(24)) +
    (fs.existsSync(s._prompt) ? '✅' : '❌缺').padEnd(18) + (s._exists ? '已存在' : '待生成')
  )
}
console.log('')
log(`待出片 ${todo.length} 段，合计 ${todo.reduce((a, s) => a + s.genDur, 0)}s，预估 ¥${cost.toFixed(2)}（上限 ¥${MAX_COST}）`)

const missingPrompt = todo.filter((s) => !fs.existsSync(s._prompt))
if (missingPrompt.length) { log(`❌ 缺提示词：${missingPrompt.map((s) => s.idx).join(',')}`); process.exit(1) }
const missingRefs = todo.flatMap((s) => s._refs.filter((r) => !fs.existsSync(r)).map((r) => `段${s.idx} ${path.basename(r)}`))
if (missingRefs.length) { log(`❌ 参考图缺失：${missingRefs.join(' / ')}（先跑 scripts/81_pv_refs.mjs）`); process.exit(1) }
const missingChain = todo.filter((s) => s._chain != null && !byIdx.has(s._chain))
if (missingChain.length) { log(`❌ 链式前置段不存在：${missingChain.map((s) => `段${s.idx}←${s._chain}`).join(',')}（检查 segments.json 的 chainFrom）`); process.exit(1) }

// 出片驱动（H3）必须先存在 —— 换机器时这是最容易漏的一件。
// --plan 下不阻断（只读回放不该因为缺驱动而失败），但会在计划里明确提示缺什么。
const h3Missing = !fs.existsSync(H3)
if (h3Missing && !PLAN_ONLY) {
  log('❌ 找不到出片驱动：' + H3)
  log('   三选一：①放到 <工作区>/tools/minimax-h3/h3.mjs（仓库 drivers/minimax-h3/ 有副本）')
  log('          ②设环境变量 FANFILL_H3=<h3.mjs 绝对路径>')
  log('          ③在 翻填项目.json 里写 video.h3Driver')
  process.exit(1)
}

// ── --plan：只打印（不发请求、不写产物）────────────────────────────────────
if (PLAN_ONLY) {
  console.log('')
  console.log(`配置：${path.relative(ROOT, cfg.configPath)}｜模型 ${MODEL} @${RES}：¥${PRICE}/秒｜成片 ${BW}x${BH} @${FPS}fps`)
  console.log(`--max-cost 推导：min(单批兜底 ¥${BATCH_FALLBACK.toFixed(2)}, 预算余额 ¥${BALANCE.toFixed(2)} = 预算 ¥${CAP.toFixed(2)} − 已花 ¥${SPENT.toFixed(2)}) = ¥${MAX_COST.toFixed(2)}${arg('max-cost', '') ? '（被命令行 --max-cost 覆盖）' : ''}`)
  console.log(`波次：每波 ${WAVE} 段并行提交（链式段单独串行）`)
  console.log(`重试：每段最多 ${RETRY_MAX + 1} 次尝试（1 次 + ≤${RETRY_MAX} 次重试）。`)
  console.log(`      重试会**产生额外费用**（每次重试都是一次新的 H3 生成）；最坏情况 = 本批 ¥${cost.toFixed(2)} × ${RETRY_MAX + 1} = ¥${(cost * (RETRY_MAX + 1)).toFixed(2)}，`)
  console.log(`      但所有已提交尝试的累计费用仍受 --max-cost ¥${MAX_COST.toFixed(2)} 约束：超出即停止重试并报错退出。`)
  console.log(`记账：逐次尝试（含失败，成功=0/费用=0）追加 ${path.relative(ROOT, LOG)}`)
  console.log(`      成功且有花费时追加 ${path.relative(ROOT, LEDGER)}（列：时间,阶段,项目,金额CNY,累计CNY,备注）`)
  console.log(`非破坏性：旧成片不覆盖 —— 新片先下到 .tmp 核验，通过后把旧片归档到 ${path.relative(ROOT, cfg.dirs.history)}/<时间戳>/ 再落正式名。`)
  if (h3Missing) console.log('⚠ 未找到出片驱动 ' + H3 + '：实跑会被拒绝，请先配好 FANFILL_H3 或 video.h3Driver。')
  if (cost > MAX_COST) console.log(`⛔ 本批预估 ¥${cost.toFixed(2)} 已超过 --max-cost ¥${MAX_COST.toFixed(2)}：实跑会被拒绝，请先调 --max-cost 或缩范围（--only）。`)
  if (BALANCE <= 0) console.log(`⛔ 预算余额为 ¥${BALANCE.toFixed(2)}（预算 ¥${CAP.toFixed(2)} − 已花 ¥${SPENT.toFixed(2)}）：需先向用户报备并更新 budget 再实跑。`)
  finishPlan(todo.map((s) => ({
    label: `段 ${s.idx} ${s.slug}`,
    detail: `${s.genDur}s｜${s._kind}${s._chain ? `｜链式←段 ${s._chain} 末帧` : s._refs.length ? `｜参考图 ${s._refs.map((r) => path.basename(r)).join('+')}` : ''}`,
    cny: s.genDur * PRICE,
  })), cfg, { title: `82 批量出片 ${todo.length} 段（不发请求）` })
}

if (cost > MAX_COST) { log(`❌ 预估 ¥${cost.toFixed(2)} 超过 --max-cost ¥${MAX_COST}，拒绝执行`); process.exit(1) }

// ── 实跑 ────────────────────────────────────────────────────────────────────
ensureDirs(CLIPS, TMP, cfg.dirs.history, cfg.dirs.plan)

const attempts = []                    // 每次尝试一条（记账用；含失败）
const lastOk = new Map()               // idx → 本轮成功的尝试（链式取末帧用）
let submittedCost = 0                  // 已提交（=已计费）的累计，用作 --max-cost 的硬闸

async function submit(s, round) {
  const args = ['create', '--prompt-file', s._prompt, '--model', MODEL,
    '--duration', String(s.genDur), '--resolution', RES, '--ratio', ASPECT,
    '--max-cost', String(s.genDur * PRICE + 0.01), '--yes', '--output', 'json']
  for (const r of s._refs) args.push('--ref-image', r)
  if (s._chain) {
    let prevFile = lastOk.get(s._chain)?.saved || null
    let from = `段 ${s._chain}`
    if (!prevFile) {
      // 本轮没跑前一段（--only / --skip-done / 前一段失败）时退回磁盘既有成片，保证链式仍有连续首帧
      const prevSeg = byIdx.get(s._chain)
      const cand = prevSeg ? clipFile(prevSeg.idx, prevSeg.slug) : null
      if (cand && fs.existsSync(cand)) { prevFile = cand; from = `段 ${s._chain}（磁盘既有成片）` }
    }
    if (!prevFile) return { idx: s.idx, ok: false, seg: s, round, note: `链式前置段 ${s._chain} 未成功、磁盘上也没有成片（先单独跑 --only ${s._chain}）` }
    const frame = path.join(TMP, `last_${s._chain}.jpg`)
    const ex = await tryRun(FFMPEG, ['-y', '-v', 'error', '-sseof', '-0.15', '-i', prevFile, '-frames:v', '1', '-q:v', '2', frame], 60000)
    if (ex.code !== 0) return { idx: s.idx, ok: false, seg: s, round, note: `抽取上一段末帧失败：${String(ex.stderr).slice(0, 120)}` }
    args.push('--image', frame)
    log(`段 ${s.idx}：链式首帧 ← ${from} 末帧`)
  }
  const r = await tryRun(process.execPath, [H3, ...args], 300000)
  let tid = null
  try { tid = JSON.parse(r.stdout.trim()).task_id } catch { /* 下面统一报错 */ }
  if (!tid) {
    const note = '提交失败：' + (r.stderr || r.stdout || '(无输出)').slice(0, 240)
    log(`段 ${s.idx} ❌ ${note}`)   // 失败必须打日志（此前静默失败过一次，别再犯）
    return { idx: s.idx, ok: false, seg: s, round, note }
  }
  submittedCost += s.genDur * PRICE
  log(`段 ${s.idx} 已提交 task_id=${tid}（${s.genDur}s，¥${(s.genDur * PRICE).toFixed(2)}${round > 1 ? `，第 ${round} 次尝试` : ''}；已提交累计 ¥${submittedCost.toFixed(2)}）`)
  return { idx: s.idx, ok: true, taskId: tid, seg: s, out: s._out, genDur: s.genDur, round }
}

async function poll(task) {
  const deadline = Date.now() + 20 * 60 * 1000
  for (;;) {
    const r = await tryRun(process.execPath, [H3, 'get', task.taskId, '--output', 'json'], 60000)
    let st = null, url = null
    try { const j = JSON.parse(r.stdout.trim()); st = j.status; url = j.content && j.content.url } catch { /* 还没就绪 */ }
    if (st === 'succeeded') return { url }
    if (st === 'failed' || st === 'cancelled') return { fail: st, note: (r.stdout || '').slice(0, 200) }
    if (Date.now() > deadline) return { fail: 'timeout' }
    await new Promise((res) => setTimeout(res, 12000))
  }
}

async function download(task, url) {
  const tmp = path.join(TMP, `dl_${pad2(task.idx)}_${task.seg.slug}.mp4`)
  fs.rmSync(tmp, { force: true })      // .tmp 是脚本自己的缓存区
  const r = await tryRun(process.execPath, [H3, 'download', url, '--out', tmp], 300000)
  const saved = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop()
  if (!saved || !fs.existsSync(saved)) return { ok: false, note: '下载失败：' + (r.stderr || '').slice(0, 160) }
  let info = null
  try { info = await probeMedia(saved) } catch (e) { return { ok: false, note: '核验失败：' + String(e.message).slice(0, 160) } }
  const okDur = Math.abs(info.duration - task.genDur) <= 1.2
  const okFmt = info.width === BW && info.height === BH && Math.abs((info.fps ?? 0) - FPS) < 0.01
  if (!okDur || !okFmt) {
    return {
      ok: false, saved, info,
      note: `核验不过：时长 ${info.duration.toFixed(2)}s（生成 ${task.genDur}s，允许 ±1.2s）、${info.width}x${info.height}（要求 ${BW}x${BH}）、${info.fps}fps（要求 ${FPS}）；未采用的片子留在 ${cfg.rel(saved)}`,
    }
  }
  archiveOld([task.out], `82 重出成片（段 ${task.idx}）`)
  fs.renameSync(saved, task.out)       // 核验通过才落到正式名（绝不半途覆盖既有成片）
  return { ok: true, saved: task.out, info, okDur, okFmt }
}

/** 一条段的完整尝试：提交 → 轮询 → 下载核验 */
async function attempt(s, round) {
  if (submittedCost + s.genDur * PRICE > MAX_COST + 1e-9) {
    return { idx: s.idx, ok: false, seg: s, round, note: `--max-cost 闸：已提交 ¥${submittedCost.toFixed(2)} + 本段 ¥${(s.genDur * PRICE).toFixed(2)} > ¥${MAX_COST.toFixed(2)}，不再提交` }
  }
  const sub = await submit(s, round)
  if (!sub.ok) return sub
  const p = await poll(sub)
  if (p.fail) { sub.ok = false; sub.note = p.fail + ' ' + (p.note || ''); log(`段 ${s.idx} ❌ ${sub.note}`); return sub }
  const d = await download(sub, p.url)
  sub.ok = d.ok; sub.saved = d.saved; sub.info = d.info; sub.note = d.ok ? '' : d.note
  log(`段 ${s.idx} ${d.ok ? '✅' : '❌'} ${d.info ? `${d.info.duration.toFixed(2)}s ${d.info.width}x${d.info.height} ${d.info.fps}fps` : d.note}`)
  if (d.ok) lastOk.set(s.idx, sub)
  return sub
}

// ── 1) 非链式段：分波并行提交 → 顺序轮询/下载 → 失败者重试 ──────────────────
const chained = todo.filter((s) => s._chain)
const independent = todo.filter((s) => !s._chain)
log(`并行波次：独立段 ${independent.length} 个，链式段 ${chained.length} 个`)

let queue = independent
for (let round = 1; round <= RETRY_MAX + 1 && queue.length; round++) {
  if (round > 1) log(`—— 第 ${round} 次尝试（重试 ${round - 1}/${RETRY_MAX}）：段 ${queue.map((s) => s.idx).join(',')}；重试会产生额外费用 ——`)
  const subs = []
  for (let i = 0; i < queue.length; i += WAVE) {
    const wave = queue.slice(i, i + WAVE)
    const r = await Promise.all(wave.map((s) => attempt(s, round)))
    subs.push(...r)
  }
  attempts.push(...subs)
  const failed = subs.filter((x) => !x.ok)
  queue = failed.map((x) => x.seg)
  if (queue.length && round <= RETRY_MAX) {
    const need = queue.reduce((a, s) => a + s.genDur * PRICE, 0)
    if (submittedCost + need > MAX_COST + 1e-9) {
      log(`⛔ 重试预估 ¥${need.toFixed(2)} 会让本批累计（已提交 ¥${submittedCost.toFixed(2)}）超过 --max-cost ¥${MAX_COST.toFixed(2)}：放弃重试 段 ${queue.map((s) => s.idx).join(',')}`)
      for (const s of queue) attempts.push({ idx: s.idx, ok: false, seg: s, round: round + 1, note: '因 --max-cost 上限放弃重试' })
      queue = []
    }
  }
}

// ── 2) 链式段：串行（必须等前一段的片子在手）────────────────────────────────
for (const s of chained) {
  for (let round = 1; round <= RETRY_MAX + 1; round++) {
    if (round > 1) log(`—— 段 ${s.idx} 第 ${round} 次尝试（重试 ${round - 1}/${RETRY_MAX}）；重试会产生额外费用 ——`)
    const r = await attempt(s, round)
    attempts.push(r)
    if (r.ok) break
    if (round > RETRY_MAX) break
    if (submittedCost + s.genDur * PRICE > MAX_COST + 1e-9) {
      log(`⛔ 段 ${s.idx} 重试会超过 --max-cost ¥${MAX_COST.toFixed(2)}：放弃重试`)
      attempts.push({ idx: s.idx, ok: false, seg: s, round: round + 1, note: '因 --max-cost 上限放弃重试' })
      break
    }
  }
}

// ── 3) 记账 ─────────────────────────────────────────────────────────────────
const okSegs = [...new Set(attempts.filter((r) => r.ok).map((r) => r.idx))]
const spent = attempts.filter((r) => r.ok).reduce((a, r) => a + r.seg.genDur * PRICE, 0)
const retried = attempts.filter((r) => r.round > 1 && r.ok).length

const hdr = '时间,段,模式,生成秒,费用元,任务id,成功,时长,备注'
const lines = attempts.map((r) =>
  [ts(), r.idx, r.seg ? r.seg._kind : '', r.seg ? r.seg.genDur : '', r.ok ? (r.seg.genDur * PRICE).toFixed(2) : '0',
   r.taskId || '', r.ok ? 1 : 0, r.info ? r.info.duration.toFixed(2) : '',
   '"' + String(r.note || '').replace(/\s*[\r\n]+\s*/g, ' ') + '"'].join(','))
if (!fs.existsSync(LOG)) await fsp.writeFile(LOG, '\ufeff' + hdr + '\r\n', 'utf8')
else if (!(await fsp.readFile(LOG, 'utf8')).startsWith('\ufeff' + hdr.split(',')[0])) await fsp.writeFile(LOG, '\ufeff' + hdr + '\r\n', 'utf8')
await fsp.appendFile(LOG, lines.join('\r\n') + '\r\n', 'utf8')

// `_进度/成本台账.csv`：成功且金额 > 0 才写；累计列 = 上一行累计 + 本笔
let ledgerTotal = null
if (spent > 0) {
  const scope = only
    ? `重出 段${segs.map((s) => s.idx).join('/')}`
    : (skipDone ? `补出 段${todo.map((s) => s.idx).join('/')}` : `批量出片 段${segs[0].idx}-${segs[segs.length - 1].idx}`)
  const note = `${MODEL} ${RES}；成功 ${okSegs.length} 段（${retried} 段重试）；已提交尝试 ${attempts.length} 次`.replace(/,/g, '，')
  ensureDirs(path.dirname(LEDGER))
  let text = ''
  let eol = '\r\n'
  if (fs.existsSync(LEDGER)) {
    text = await fsp.readFile(LEDGER, 'utf8')
    eol = text.includes('\r\n') ? '\r\n' : '\n'
  }
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  const prev = rows.length > 1 ? (Number(rows[rows.length - 1].split(',')[4]) || 0) : 0
  ledgerTotal = Math.round((prev + spent) * 100) / 100
  if (!text) await fsp.writeFile(LEDGER, '时间,阶段,项目,金额CNY,累计CNY,备注' + eol, 'utf8')
  else if (!text.endsWith('\n')) await fsp.appendFile(LEDGER, eol, 'utf8')
  await fsp.appendFile(LEDGER, [ts().slice(0, 16), 'PV出片', scope, spent.toFixed(2), ledgerTotal.toFixed(2), note].join(',') + eol, 'utf8')
}

log('')
log(`完成：${okSegs.length}/${todo.length} 段成功｜本轮花费 ¥${spent.toFixed(2)}｜明细 ${path.relative(ROOT, LOG)}`)
log(`      （本批共 ${attempts.length} 次尝试，其中重试成功 ${retried} 次；已提交计费累计 ¥${submittedCost.toFixed(2)}／上限 ¥${MAX_COST.toFixed(2)}）`)
if (ledgerTotal != null) log(`      已计入台账 ${path.relative(ROOT, LEDGER)}：本笔 ¥${spent.toFixed(2)} → 累计 ¥${ledgerTotal.toFixed(2)}（budget.spentCny 按约定仍由人工/工作台同步，脚本只读不写）`)
const bad = attempts.filter((r) => !r.ok && !attempts.some((x) => x.idx === r.idx && x.ok))
if (bad.length) {
  log(`失败段：${[...new Set(bad.map((b) => b.idx))].map((i) => i + '(' + (bad.find((b) => b.idx === i).note || '').slice(0, 60) + ')').join(' , ')}`)
  process.exitCode = 1
}
