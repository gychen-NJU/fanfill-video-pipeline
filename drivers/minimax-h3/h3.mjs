#!/usr/bin/env node
/**
 * MiniMax H3 视频生成驱动（零依赖 Node ≥18）
 * ---------------------------------------------------------------------------
 * 直连官方 Video Generation V2 API，补齐官方 CLI (mmx-cli) 缺失的能力：
 *   · --resolution 768P / 480P / 2K   （mmx-cli 硬编码 2K，无法选档）
 *   · MiniMax-H3-Max 模型              （mmx-cli v1.0.26 会错误落到 V1 端点）
 *   · H3-Context-IR 提示词增强         （CLI 无此子命令）
 *   · 任务列表 / 取消 / 本地素材上传 / 成本预估与上限保护
 *
 * 官方文档：
 *   CN     https://platform.minimax.cn/docs/guides/video-generation
 *   Global https://platform.minimax.io/docs/guides/video-generation
 *
 * 鉴权：Bearer API Key（H3/H3-Max 必须使用**按量付费** Key，Token Plan Key 不可用）
 * 计费：按输出秒数计（CN 站刊例）MiniMax-H3 768P ¥0.50/s、2K ¥0.80/s；
 *       MiniMax-H3-Max 480P ¥0.33/s、768P ¥0.50/s。参考图超 5 张 ¥0.20/张，音频免费。
 * 状态：queued / running / succeeded / failed / cancelled（全小写，与 V1 不同）
 * 成片：成功后 task.content.url 直接给下载地址，**不需要 file_id**
 *
 * 用法：
 *   node h3.mjs <command> [flags]
 *   create | get | list | wait | download | run | context-ir | cancel | upload | estimate
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
const REGION_BASE = {
  cn: 'https://api.minimaxi.com',
  global: 'https://api.minimax.io',
}
// 按输出秒计费的刊例价（2026-09 抓取）
const PRICE_CNY = {
  'MiniMax-H3': { '480P': null, '768P': 0.5, '2K': 0.8 },
  'MiniMax-H3-Max': { '480P': 0.33, '768P': 0.5, '2K': null },
}
const PRICE_USD = {
  'MiniMax-H3': { '768P': 0.08, '2K': 0.13 },
  'MiniMax-H3-Max': { '480P': 0.05, '768P': 0.08 },
}
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
const REPEATABLE = new Set(['ref-image', 'ref-video', 'ref-audio'])
const REGION_FLAGS = ['region', 'base', 'key', 'output', 'quiet', 'verbose', 'yes', 'dry-run']

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
// 日志一律走 stderr：stdout 只留给机器可读输出（--output json / 下载路径 / 上传结果），
// 这样 MCP 服务器等上层封装可以直接 JSON.parse(stdout)。
const log = (...a) => console.error(`[${ts()}]`, ...a)
const warn = (...a) => console.error(`[${ts()}] !`, ...a)
const die = (msg, code = 1) => {
  console.error(`\n✗ ${msg}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { out._.push(...argv.slice(i + 1)); break }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      let k, v
      if (eq > -1) { k = a.slice(2, eq); v = a.slice(eq + 1) }
      else {
        k = a.slice(2)
        const nxt = argv[i + 1]
        if (nxt !== undefined && !nxt.startsWith('--')) { v = nxt; i++ } else v = true
      }
      if (REPEATABLE.has(k)) (out[k] ||= []).push(v)
      else out[k] = v
    } else out._.push(a)
  }
  return out
}

/** 永远不覆盖已有文件：xxx.mp4 → xxx-2.mp4 → xxx-3.mp4 */
function uniquePath(p) {
  if (!fs.existsSync(p)) return p
  const dir = path.dirname(p)
  const ext = path.extname(p)
  const base = path.basename(p, ext)
  for (let i = 2; i < 999; i++) {
    const cand = path.join(dir, `${base}-${i}${ext}`)
    if (!fs.existsSync(cand)) return cand
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`)
}

async function writeJson(p, obj) {
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, JSON.stringify(obj, null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// 凭据解析：--key > env > ~/.mmx/config.json > ~/.dsh/.credentials.yaml
// ---------------------------------------------------------------------------
function findKey(explicit) {
  if (explicit && typeof explicit === 'string') return { key: explicit, from: '--key' }
  if (process.env.MINIMAX_API_KEY) return { key: process.env.MINIMAX_API_KEY, from: 'env MINIMAX_API_KEY' }
  const home = os.homedir()

  const mmx = path.join(home, '.mmx', 'config.json')
  if (fs.existsSync(mmx)) {
    try {
      const j = JSON.parse(fs.readFileSync(mmx, 'utf8'))
      const k = j.api_key || j.apiKey || (j.credentials && j.credentials.api_key)
      if (k) return { key: String(k).trim(), from: mmx }
    } catch { /* ignore */ }
  }
  const cred = path.join(home, '.dsh', '.credentials.yaml')
  if (fs.existsSync(cred)) {
    const raw = fs.readFileSync(cred, 'utf8')
    const m = raw.match(/^\s*MINIMAX_API_KEY\s*:\s*["']?([^"'\r\n]+)/m)
    if (m) return { key: m[1].trim(), from: cred }
  }
  return { key: null, from: null }
}

function resolveCtx(args) {
  const region = (args.region && String(args.region)) || process.env.MINIMAX_REGION || 'cn'
  if (!REGION_BASE[region] && !args.base) die(`未知 region: ${region}（只能是 cn | global）`)
  const base = (args.base && String(args.base)) || process.env.MINIMAX_BASE_URL || REGION_BASE[region]
  const { key, from } = findKey(typeof args.key === 'string' ? args.key : undefined)
  if (!key && !args['dry-run']) {
    die('找不到 API Key。请用 --key，或设置环境变量 MINIMAX_API_KEY，或先跑 mmx auth login。')
  }
  return { region, base, key, keyFrom: from, quiet: !!args.quiet, output: args.output || 'text' }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function api(ctx, method, urlPath, body, { raw = false } = {}) {
  const url = `${ctx.base}${urlPath}`
  if (ctx.verbose) log(`HTTP ${method} ${url}`)
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = (await res.text()).replace(/^\uFEFF/, '') // 服务端偶发带 BOM
  if (raw) return { res, text }
  let json
  try { json = text ? JSON.parse(text) : {} } catch { die(`响应不是 JSON (HTTP ${res.status}): ${text.slice(0, 400)}`) }
  if (json && json.type === 'error') {
    const e = json.error || {}
    die(`API 错误 HTTP ${res.status} ${json.request_id || ''}\n  ${e.type || ''}: ${e.message || text}`)
  }
  if (json && json.base_resp && json.base_resp.status_code) {
    die(`API 错误 status_code=${json.base_resp.status_code}: ${json.base_resp.status_msg}`)
  }
  if (!res.ok) die(`HTTP ${res.status}: ${text.slice(0, 400)}`)
  return json
}

// ---------------------------------------------------------------------------
// 素材：本地文件 → 上传拿 file_id（mm_file://）或内联 data URI
// ---------------------------------------------------------------------------
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
}

async function uploadFile(ctx, filePath) {
  const buf = await fsp.readFile(filePath)
  const name = path.basename(filePath)
  const fd = new FormData()
  fd.append('purpose', 'video_generation_input')
  fd.append('file', new Blob([buf]), name)
  const res = await fetch(`${ctx.base}/v1/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.key}` },
    body: fd,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { die(`上传响应不是 JSON (HTTP ${res.status}): ${text.slice(0, 300)}`) }
  if (json.type === 'error') die(`上传失败: ${json.error?.message || text}`)
  if (json.base_resp && json.base_resp.status_code) die(`上传失败: ${json.base_resp.status_msg}`)
  const fileId = json.file?.file_id ?? json.file_id
  if (fileId === undefined) die(`上传响应里没有 file_id: ${text.slice(0, 300)}`)
  log(`已上传 ${name} → file_id=${fileId}`)
  return String(fileId)
}

/** 把 --image/--ref-image 之类的值统一转成 API 需要的 url 字符串 */
async function toUrl(ctx, v, args) {
  if (typeof v !== 'string') die('素材参数必须是路径或 URL')
  if (/^(https?:|data:|mm_file:)/i.test(v)) return v
  const abs = path.resolve(v)
  if (!fs.existsSync(abs)) die(`素材文件不存在: ${abs}`)
  const stat = await fsp.stat(abs)
  if (stat.size > 30 * 1024 * 1024 && args.inline) die(`文件 ${abs} 超过 30MB，不能内联，请改用上传`)
  if (args.inline) {
    const ext = path.extname(abs).toLowerCase()
    const mime = MIME[ext]
    if (!mime) die(`无法识别扩展名 ${ext}`)
    const b64 = (await fsp.readFile(abs)).toString('base64')
    log(`内联 ${path.basename(abs)}（${(stat.size / 1048576).toFixed(1)}MB）`)
    return `data:${mime};base64,${b64}`
  }
  const fid = await uploadFile(ctx, abs)
  return `mm_file://${fid}`
}

// ---------------------------------------------------------------------------
// 构建请求体
// ---------------------------------------------------------------------------
async function buildPayload(ctx, args) {
  const model = String(args.model || 'MiniMax-H3')
  if (!PRICE_CNY[model]) die(`model 只能是 MiniMax-H3 或 MiniMax-H3-Max（收到 ${model}）`)

  let prompt = args.prompt
  if (!prompt && args['prompt-file']) prompt = await fsp.readFile(path.resolve(String(args['prompt-file'])), 'utf8')
  if (typeof prompt !== 'string' || !prompt.trim()) die('缺少 --prompt 或 --prompt-file')

  const duration = Number(args.duration ?? 5)
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) die('--duration 必须是 4–15 的整数')
  if (model === 'MiniMax-H3-Max' && duration < 5) die('MiniMax-H3-Max 最短 5 秒')

  const resolution = String(args.resolution || '768P')
  if (!PRICE_CNY[model][resolution]) {
    die(`${model} 不支持分辨率 ${resolution}（H3: 768P/2K；H3-Max: 480P/768P）`)
  }

  const content = [{ type: 'text', text: String(prompt).trim() }]
  const first = args['first-frame'] || args.image
  if (first) content.push({ type: 'image_url', image_url: { url: await toUrl(ctx, first, args) }, role: 'first_frame' })
  if (args['last-frame']) content.push({ type: 'image_url', image_url: { url: await toUrl(ctx, args['last-frame'], args) }, role: 'last_frame' })
  for (const v of args['ref-image'] || []) content.push({ type: 'image_url', image_url: { url: await toUrl(ctx, v, args) }, role: 'reference_image' })
  for (const v of args['ref-video'] || []) content.push({ type: 'video_url', video_url: { url: await toUrl(ctx, v, args) }, role: 'reference_video' })
  for (const v of args['ref-audio'] || []) content.push({ type: 'audio_url', audio_url: { url: await toUrl(ctx, v, args) }, role: 'reference_audio' })

  const hasRef = content.some((c) => String(c.role || '').startsWith('reference_'))
  const hasFrame = content.some((c) => c.role === 'first_frame' || c.role === 'last_frame')
  if (hasRef && hasFrame) die('图生视频（首/尾帧）与多模态参考生视频互斥，不能混用 role')

  const body = { model, content, resolution, duration }

  // ratio：t2va 必填且不能 adaptive；i2va 恒 adaptive；r2va 可选
  const isT2va = !hasRef && !hasFrame
  if (args.ratio) body.ratio = String(args.ratio)
  else if (isT2va) body.ratio = '16:9'
  if (body.ratio === 'adaptive' && isT2va) die('文生视频的 ratio 不能是 adaptive')
  if (hasFrame && body.ratio && body.ratio !== 'adaptive') {
    warn('图生视频的宽高比由图片决定，ratio 会被忽略（已按 adaptive 处理）')
    body.ratio = 'adaptive'
  }
  if (args['callback-url']) body.callback_url = String(args['callback-url'])
  if (args['prompt-expansion-mode'] && model === 'MiniMax-H3-Max') {
    body.extra = { prompt_expansion_mode: String(args['prompt-expansion-mode']) }
  }
  if (args['aigc-watermark']) body.aigc_watermark = true
  return body
}

function estimateCNY(model, resolution, duration) {
  const p = PRICE_CNY[model]?.[resolution]
  return p == null ? null : p * duration
}

function printEstimate(model, resolution, duration) {
  const cny = estimateCNY(model, resolution, duration)
  const usd = PRICE_USD[model]?.[resolution]
  log(`预估费用：${model} @${resolution} × ${duration}s = ¥${cny?.toFixed(2)}${usd ? `（国际站 $${(usd * duration).toFixed(2)}）` : ''}`)
  return cny
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------
async function cmdCreate(ctx, args) {
  const body = await buildPayload(ctx, args)
  printEstimate(body.model, body.resolution, body.duration)
  if (ctx.output === 'json') { /* 保持 stdout 干净 */ } else console.log(JSON.stringify(body, null, 2))

  const limit = args['max-cost'] !== undefined ? Number(args['max-cost']) : 5
  const est = estimateCNY(body.model, body.resolution, body.duration)
  if (est != null && est > limit && !args.yes) {
    die(`预估 ¥${est.toFixed(2)} 超过 --max-cost ¥${limit}（加 --yes 或调高 --max-cost 才能提交）`)
  }
  if (args['dry-run']) { log('--dry-run：未提交'); return null }

  const out = await api(ctx, 'POST', '/v2/video_generation', body)
  const taskId = out.task_id ?? out.task?.id
  if (!taskId) die(`创建响应里没有 task_id：${JSON.stringify(out)}`)
  log(`已提交任务 task_id=${taskId}`)
  if (ctx.output === 'json') console.log(JSON.stringify({ task_id: String(taskId) }))
  return String(taskId)
}

async function cmdGet(ctx, args) {
  const id = args._[0] || args['task-id']
  if (!id) die('用法：h3.mjs get <task_id>')
  const out = await api(ctx, 'GET', `/v2/query/video_generation/${encodeURIComponent(String(id))}`)
  const t = out.task || out
  if (ctx.output === 'json') console.log(JSON.stringify(t, null, 2))
  else {
    log(`task ${t.id}: ${t.status}  (${t.model} @${t.resolution} ${t.duration}s)`)
    if (t.error) warn(`error: ${JSON.stringify(t.error)}`)
    if (t.content?.url) log(`url: ${t.content.url}`)
    if (t.content?.prompt) console.log(t.content.prompt)
    if (t.usage) console.log('usage: ' + JSON.stringify(t.usage))
  }
  return t
}

async function cmdList(ctx, args) {
  const q = new URLSearchParams()
  q.set('page_num', String(args.page || 1))
  q.set('page_size', String(args.size || 10))
  const out = await api(ctx, 'GET', `/v2/query/video_generation?${q}`)
  if (ctx.output === 'json') { console.log(JSON.stringify(out, null, 2)); return out }
  const items = out.items || out.tasks || []
  log(`共 ${out.total ?? items.length} 条，返回 ${items.length} 条`)
  for (const t of items) {
    console.log(`  ${t.id}  ${String(t.status).padEnd(9)} ${t.model} @${t.resolution} ${t.duration}s  ${t.content?.url ? '✔url' : ''}`)
  }
  return out
}

async function cmdWait(ctx, args, taskId) {
  const interval = Number(args.poll ?? 10) * 1000
  const timeout = Number(args.timeout ?? 1800) * 1000
  const t0 = Date.now()
  let last = ''
  for (;;) {
    const out = await api(ctx, 'GET', `/v2/query/video_generation/${encodeURIComponent(taskId)}`)
    const t = out.task || out
    if (t.status !== last) log(`状态：${t.status}`)
    last = t.status
    if (TERMINAL.has(t.status)) {
      if (t.status !== 'succeeded') {
        warn(`任务未成功：${t.status} ${t.error ? JSON.stringify(t.error) : ''}`)
        return t
      }
      log(`完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
      return t
    }
    if (Date.now() - t0 > timeout) die(`轮询超时（${timeout / 1000}s），任务仍为 ${t.status}；task_id=${taskId}`)
    await new Promise((r) => setTimeout(r, interval))
  }
}

async function cmdDownload(ctx, args, url, outPath) {
  if (!outPath) die('缺少 --out')
  const target = uniquePath(path.resolve(outPath))
  await fsp.mkdir(path.dirname(target), { recursive: true })
  log(`下载 → ${target}`)
  const res = await fetch(url)
  if (!res.ok) die(`下载失败 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fsp.writeFile(target, buf)
  log(`已保存 ${(buf.length / 1048576).toFixed(2)} MB`)
  console.log(target) // stdout：机器可读的落盘路径
  return target
}

async function cmdRun(ctx, args) {
  const t0 = Date.now()
  const taskId = await cmdCreate(ctx, args)
  if (!taskId) return null
  const task = await cmdWait(ctx, args, taskId)
  if (task.status !== 'succeeded') process.exit(2)
  const url = task.content?.url
  if (!url) die('任务成功但响应里没有 content.url')
  let saved = null
  if (args.out || args['out-dir']) {
    const outPath = args.out
      ? String(args.out)
      : path.join(String(args['out-dir']), `${taskId}_${task.model}_${task.resolution}_${task.duration}s.mp4`)
    saved = await cmdDownload(ctx, args, url, outPath)
  }
  const meta = {
    task_id: taskId,
    model: task.model,
    status: task.status,
    resolution: task.resolution,
    duration: task.duration,
    ratio: task.ratio,
    created_at: task.created_at,
    updated_at: task.updated_at,
    usage: task.usage,
    source_url: url,
    saved_to: saved,
    region: ctx.region,
    base: ctx.base,
    estimated_cny: estimateCNY(task.model, task.resolution, task.duration),
    wall_seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    prompt: args.prompt ? String(args.prompt) : args['prompt-file'] ? `(file) ${args['prompt-file']}` : null,
  }
  const metaPath = saved ? saved.replace(/\.mp4$/i, '.json') : path.resolve(String(args['out-dir'] || '.'), `${taskId}.json`)
  await writeJson(metaPath, meta)
  log(`元数据 → ${metaPath}`)
  if (ctx.output === 'json') console.log(JSON.stringify(meta, null, 2))
  else { console.log(`\n成片: ${saved}\n链接: ${url}`) }
  return meta
}

async function cmdContextIr(ctx, args) {
  let prompt = args.prompt
  if (!prompt && args['prompt-file']) prompt = await fsp.readFile(path.resolve(String(args['prompt-file'])), 'utf8')
  if (!prompt) die('缺少 --prompt 或 --prompt-file')
  const body = {
    model: 'MiniMax-H3',
    content: [{ type: 'text', text: String(prompt).trim() }],
    duration: Number(args.duration ?? 5),
  }
  if (args.ratio) body.ratio = String(args.ratio)
  if (args['first-frame'] || args.image) {
    body.content.push({ type: 'image_url', image_url: { url: await toUrl(ctx, args['first-frame'] || args.image, args) }, role: 'first_frame' })
  } else if (!body.ratio) {
    body.ratio = '16:9' // t2va 场景服务端强制要求显式 ratio，缺省会报 2013
  }
  if (args['dry-run']) { console.log(JSON.stringify(body, null, 2)); return null }
  const out = await api(ctx, 'POST', '/v2/h3_context_ir', body)
  const id = String(out.task_id ?? out.task?.id)
  log(`Context-IR 任务 task_id=${id}（按 token 计费，很便宜）`)
  const t = await cmdWait(ctx, { ...args, poll: args.poll ?? 5, timeout: args.timeout ?? 600 }, id)
  const enhanced = t.content?.prompt || ''
  if (args.out) {
    const p = uniquePath(path.resolve(String(args.out)))
    await fsp.mkdir(path.dirname(p), { recursive: true })
    await fsp.writeFile(p, enhanced, 'utf8')
    log(`增强后的 prompt → ${p}`)
  } else {
    console.log('\n───── 增强后的 H3 prompt ─────\n' + enhanced + '\n─────────────────────────────')
  }
  if (ctx.output === 'json') console.log(JSON.stringify({ task_id: id, prompt: enhanced }))
  return enhanced
}

/** 768P → 2K 再生成。两种入参二选一：source_task_id（需白名单）或 base_video + 原 prompt */
async function cmdRegenerate(ctx, args) {
  const body = { model: String(args.model || 'MiniMax-H3'), resolution: String(args.resolution || '2K') }
  if (args['source-task-id']) {
    body.source_task_id = String(args['source-task-id'])
  } else {
    const v = args._[0] || args.video
    if (!v) die('regenerate 需要 --source-task-id <id>（需白名单）或一个 base_video 视频文件/URL')
    let prompt = args.prompt
    if (!prompt && args['prompt-file']) prompt = await fsp.readFile(path.resolve(String(args['prompt-file'])), 'utf8')
    if (!prompt) die('base_video 方式必须给 --prompt：要传当初实际送模的那条最终 prompt，不是原始想法')
    body.content = [
      { type: 'text', text: String(prompt).trim() },
      { type: 'video_url', video_url: { url: await toUrl(ctx, v, args) }, role: 'base_video' },
    ]
  }
  if (args['dry-run']) { console.log(JSON.stringify(body, null, 2)); return null }
  const out = await api(ctx, 'POST', '/v2/video_regeneration', body)
  const id = String(out.task_id ?? out.task?.id)
  log(`2K 再生成任务 task_id=${id}`)
  const t = await cmdWait(ctx, args, id)
  if (t.status === 'succeeded' && (args.out || args['out-dir'])) {
    const url = t.content?.url
    if (url) await cmdDownload(ctx, args, url, args.out || path.join(String(args['out-dir']), `${id}_2K.mp4`))
  }
  return t
}

async function cmdCancel(ctx, args) {
  const id = args._[0] || args['task-id']
  if (!id) die('用法：h3.mjs cancel <task_id>')
  const out = await api(ctx, 'DELETE', `/v2/video_generation/${encodeURIComponent(String(id))}`)
  log(`已处理：${JSON.stringify(out)}`)
  if (ctx.output === 'json') console.log(JSON.stringify(out))
  return out
}

async function cmdUpload(ctx, args) {
  const f = args._[0] || args.file
  if (!f) die('用法：h3.mjs upload <本地文件>')
  const fid = await uploadFile(ctx, path.resolve(String(f)))
  if (ctx.output === 'json') console.log(JSON.stringify({ file_id: fid, uri: `mm_file://${fid}` }))
  else console.log(`mm_file://${fid}`)
  return fid
}

async function cmdVoices() { /* 占位：非本工具职责 */ }

function usage() {
  console.log(`MiniMax H3 视频生成驱动（零依赖）

用法: node h3.mjs <command> [flags]

命令:
  run         提交 → 轮询 → 下载（一步出片，最常用）
  create      只提交任务，打印 task_id
  get <id>    查询单个任务
  list        列出最近任务
  wait <id>   轮询直到终态
  download <url> --out f.mp4
  context-ir  用 H3-Context-IR 把粗糙想法增强成官方结构 prompt
  regenerate  768P → 2K 再生成（--source-task-id 或 base_video + 原 prompt）
  upload <f>  上传本地素材 → mm_file://file_id
  cancel <id> 取消/删除任务
  estimate    只估算费用，不发请求

关键 flags:
  --model MiniMax-H3|MiniMax-H3-Max   默认 MiniMax-H3
  --prompt <text> | --prompt-file <f>  二者必给其一
  --duration 4..15                     默认 5
  --resolution 768P|2K|480P            默认 768P（H3-Max 支持 480P/768P）
  --ratio 16:9|9:16|1:1|4:3|3:4|21:9|adaptive   文生视频默认 16:9
  --image/--first-frame <路径|URL>     首帧图生视频
  --last-frame <路径|URL>              尾帧（可与首帧组合）
  --ref-image/--ref-video/--ref-audio  多模态参考（可重复；与首尾帧互斥）
  --inline                             本地素材内联 base64 而非上传
  --out <file.mp4> | --out-dir <dir>   产物落盘位置
  --poll 10 --timeout 1800             轮询间隔/总超时（秒）
  --max-cost 5 --yes                   费用上限保护（默认 ¥5）
  --region cn|global --base <url>      区域，默认 cn = api.minimaxi.com
  --key <sk-...>                       默认依次读 env / ~/.mmx/config.json / ~/.dsh/.credentials.yaml
  --output json --verbose --dry-run --quiet

示例:
  node h3.mjs run --prompt-file p.txt --duration 5 --resolution 768P --ratio 16:9 \\
       --out-dir ../../10_h3video --max-cost 5 --yes
`)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'help'
const args = parseArgs(argv)
if (args.help || cmd === 'help' || (!cmd && !argv.length)) { usage(); process.exit(0) }
if (args.version) { console.log('h3.mjs 1.0.0'); process.exit(0) }

const ctx = resolveCtx(args)
if (ctx.keyFrom && !ctx.quiet && cmd !== 'estimate') log(`凭据来源：${ctx.keyFrom}｜区域：${ctx.region} (${ctx.base})`)

try {
  switch (cmd) {
    case 'create': await cmdCreate(ctx, args); break
    case 'get': await cmdGet(ctx, args); break
    case 'list': await cmdList(ctx, args); break
    case 'wait': {
      const id = args._[0] || args['task-id']
      if (!id) die('用法：h3.mjs wait <task_id>')
      await cmdWait(ctx, args, String(id)); break
    }
    case 'download': {
      const url = args._[0] || args.url
      if (!url) die('用法：h3.mjs download <url> --out f.mp4')
      await cmdDownload(ctx, args, String(url), args.out); break
    }
    case 'run': await cmdRun(ctx, args); break
    case 'context-ir': await cmdContextIr(ctx, args); break
    case 'regenerate': await cmdRegenerate(ctx, args); break
    case 'cancel': await cmdCancel(ctx, args); break
    case 'upload': await cmdUpload(ctx, args); break
    case 'estimate': {
      const model = String(args.model || 'MiniMax-H3')
      const resolution = String(args.resolution || '768P')
      const duration = Number(args.duration ?? 5)
      printEstimate(model, resolution, duration)
      if (ctx.output === 'json') {
        console.log(JSON.stringify({
          model,
          resolution,
          duration,
          cny: estimateCNY(model, resolution, duration),
          usd: PRICE_USD[model]?.[resolution] != null ? PRICE_USD[model][resolution] * duration : null,
        }))
      }
      break
    }
    default: usage(); process.exit(1)
  }
} catch (e) {
  die(`${e?.name || 'Error'}: ${e?.message || e}`)
}
