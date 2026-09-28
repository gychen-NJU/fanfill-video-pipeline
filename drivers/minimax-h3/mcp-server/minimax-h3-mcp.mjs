#!/usr/bin/env node
/**
 * MiniMax H3 MCP 服务器 —— 把 H3 视频生成变成 DSH 里的原生工具
 * ---------------------------------------------------------------------------
 * 设计要点：
 *  1. **不在本文件里重写 API 逻辑**：全部复用已实测跑通的 `../h3.mjs`（单一事实源）。
 *     h3.mjs 的日志走 stderr、`--output json` 时 stdout 只出 JSON，故可安全解析。
 *  2. **默认异步提交**：MCP 请求默认超时 60 秒（DEFAULT_REQUEST_TIMEOUT_MSEC=60000），
 *     而一次 5 秒 H3 出片实测要 111 秒 —— 所以 generate 只提交并立刻返回 task_id，
 *     由 h3_fetch_result 分次轮询/下载，绝不阻塞到超时。
 *  3. **花钱必须显式确认**：预估费用超过 maxCostCny 时，除非 confirmSpend=true，否则
 *     直接返回错误并提示先问用户。
 *  4. **stdout 是协议通道**：本进程所有诊断信息一律写 stderr，绝不污染 stdout 上的 JSON-RPC。
 */

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const H3 = path.resolve(HERE, '..', 'h3.mjs')
const TMP = path.resolve(HERE, '..', '.tmp')

const dbg = (...a) => console.error('[minimax-h3-mcp]', ...a)

if (!fs.existsSync(H3)) {
  dbg(`致命：找不到驱动脚本 ${H3}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 调用 h3.mjs（永远带 --output json，从 stdout 解析）
// ---------------------------------------------------------------------------
function callH3(args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [H3, ...args, '--output', 'json', '--quiet'],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const out = (stdout || '').trim()
        let json = null
        if (out) {
          try { json = JSON.parse(out) } catch { /* 非 JSON，保留原文 */ }
        }
        resolve({
          ok: !err,
          code: err?.code ?? 0,
          killed: !!err?.killed,
          signal: err?.signal ?? null,
          json,
          stdout: out,
          stderr: (stderr || '').trim(),
          message: err ? (err.killed ? `h3.mjs 超时（>${timeoutMs / 1000}s）` : String(err.message)) : null,
        })
      },
    )
  })
}

/** 把长 prompt 落到临时文件，避免命令行长度与换行转义问题 */
async function writePromptFile(prompt) {
  await fsp.mkdir(TMP, { recursive: true })
  const f = path.join(TMP, `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
  await fsp.writeFile(f, prompt, 'utf8')
  return f
}

const ok = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] })
const fail = (msg, extra) => ({
  content: [{ type: 'text', text: extra ? `${msg}\n\n${JSON.stringify(extra, null, 2)}` : msg }],
  isError: true,
})

/** 统一把 h3.mjs 的结果转成工具返回 */
function fromH3(r, extraNote) {
  const payload = r.json ?? { stdout: r.stdout || undefined }
  if (!r.ok) {
    return fail(`h3.mjs 失败：${r.message || '未知错误'}${r.stderr ? `\n${r.stderr}` : ''}`, payload)
  }
  if (extraNote) return ok({ note: extraNote, ...(payload || {}) })
  return ok(payload ?? { stdout: r.stdout })
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------
function registerTools(server) {
  // 1) 费用预估（纯本地，不发请求、不花钱）
  server.registerTool(
    'h3_estimate_cost',
    {
      description:
        '估算 MiniMax H3 视频生成费用（人民币，按输出秒数计费），不发任何请求、不产生费用。' +
        '真实出片前应先调用本工具并把结果报给用户。价格（中国站刊例）：MiniMax-H3 768P ¥0.50/秒、2K ¥0.80/秒；MiniMax-H3-Max 480P ¥0.33/秒、768P ¥0.50/秒。',
      inputSchema: z.object({
        model: z.enum(['MiniMax-H3', 'MiniMax-H3-Max']).optional().describe('默认 MiniMax-H3'),
        resolution: z.enum(['768P', '2K', '480P']).optional().describe('H3 支持 768P/2K；H3-Max 支持 480P/768P。默认 768P'),
        duration: z.number().int().min(4).max(15).optional().describe('秒数，H3 为 4-15，H3-Max 为 5-15。默认 5'),
      }),
    },
    async ({ model, resolution, duration }) => {
      const args = ['estimate']
      if (model) args.push('--model', model)
      if (resolution) args.push('--resolution', resolution)
      if (duration) args.push('--duration', String(duration))
      return fromH3(await callH3(args, { timeoutMs: 20000 }))
    },
  )

  // 2) 提交生成任务（默认异步，立刻返回 task_id）
  server.registerTool(
    'h3_generate_video',
    {
      description:
        '【会花钱】提交 MiniMax H3 视频生成任务，**异步**返回 task_id（不等待出片，因为一次生成约 1-3 分钟，会超过 MCP 请求超时）。' +
        '之后用 h3_fetch_result 轮询并在成功后下载。' +
        'prompt 必须是 H3 三段式（integrated_multimodal_description / overall_soundscape / non_diegetic_music，英文书写，台词用 <d>[Chinese] …</d>）；' +
        '粗糙想法先用 h3_enhance_prompt 扩写。' +
        '费用：预估超过 maxCostCny（默认 5 元）时必须显式传 confirmSpend=true，否则本工具直接拒绝——**先调用 h3_estimate_cost 并向用户确认后再提交**。',
      inputSchema: z.object({
        prompt: z.string().min(1).describe('H3 三段式 prompt（可用 h3_enhance_prompt 生成）'),
        duration: z.number().int().min(4).max(15).optional().describe('秒数，默认 5'),
        resolution: z.enum(['768P', '2K', '480P']).optional().describe('默认 768P'),
        ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']).optional().describe('文生视频默认 16:9；给了首帧图则由图片决定'),
        model: z.enum(['MiniMax-H3', 'MiniMax-H3-Max']).optional().describe('默认 MiniMax-H3'),
        firstFrameImage: z.string().optional().describe('首帧图：本地路径或 URL（本地会自动上传）'),
        lastFrameImage: z.string().optional().describe('尾帧图：本地路径或 URL'),
        referenceImages: z.array(z.string()).optional().describe('参考图（≤9 张），与首/尾帧互斥'),
        referenceVideos: z.array(z.string()).optional().describe('参考视频（≤3 个，单段 2-15s）'),
        referenceAudios: z.array(z.string()).optional().describe('参考音频（≤3 个，单段 2-15s）'),
        maxCostCny: z.number().optional().describe('本次可接受的最高费用（元），默认 5'),
        confirmSpend: z.boolean().optional().describe('预估超上限时是否已获得用户同意'),
      }),
    },
    async (a) => {
      const est = await callH3(
        ['estimate',
          '--model', a.model ?? 'MiniMax-H3',
          '--resolution', a.resolution ?? '768P',
          '--duration', String(a.duration ?? 5)],
        { timeoutMs: 20000 },
      )
      const cny = est.json?.cny ?? null
      const cap = a.maxCostCny ?? 5
      if (cny != null && cny > cap && !a.confirmSpend) {
        return fail(
          `已拒绝提交：预估 ¥${cny.toFixed(2)} 超过上限 ¥${cap}（本次未产生任何费用）。` +
          `请先用 h3_estimate_cost 把费用报给用户，得到同意后再传 confirmSpend=true（或调高 maxCostCny）。`,
          { model: a.model ?? 'MiniMax-H3', resolution: a.resolution ?? '768P', duration: a.duration ?? 5, estimatedCny: cny, cap },
        )
      }

      const pf = await writePromptFile(a.prompt)
      const args = ['create', '--prompt-file', pf]
      if (a.model) args.push('--model', a.model)
      if (a.duration) args.push('--duration', String(a.duration))
      if (a.resolution) args.push('--resolution', a.resolution)
      if (a.ratio) args.push('--ratio', a.ratio)
      if (a.firstFrameImage) args.push('--image', a.firstFrameImage)
      if (a.lastFrameImage) args.push('--last-frame', a.lastFrameImage)
      for (const v of a.referenceImages ?? []) args.push('--ref-image', v)
      for (const v of a.referenceVideos ?? []) args.push('--ref-video', v)
      for (const v of a.referenceAudios ?? []) args.push('--ref-audio', v)
      args.push('--max-cost', String(cap), '--yes')

      const r = await callH3(args, { timeoutMs: 180000 })
      if (!r.ok) {
        if (/超过 --max-cost|互斥|不支持/.test(r.stderr || '')) return fail(`提交被拒绝（未产生费用）：${r.stderr}`)
        return fromH3(r)
      }
      return ok({
        task_id: r.json?.task_id,
        estimated_cny: cny,
        next: '用 h3_fetch_result 轮询进度并在成功后下载；典型 5 秒 768P 约需 1-3 分钟。',
      })
    },
  )

  // 3) 轮询 + 下载
  server.registerTool(
    'h3_fetch_result',
    {
      description:
        '查询 H3 任务进度；成功则（可选）把成片下载到本地并返回落盘路径。' +
        '内部轮询上限默认 45 秒（受 MCP 60 秒请求超时约束），若仍在生成中会返回当前状态，稍后再次调用即可。' +
        '也可直接传 url 只做下载。注意成片下载链接有时效，任务查询窗口只有 7 天，成功后尽快下载。',
      inputSchema: z.object({
        taskId: z.string().describe('h3_generate_video 返回的 task_id'),
        outPath: z.string().optional().describe('落盘路径（.mp4）。默认写到 <cwd>/10_h3video/out/<task_id>_<model>_<res>_<dur>s.mp4'),
        download: z.boolean().optional().describe('成功后是否下载，默认 true'),
        maxWaitSeconds: z.number().optional().describe('本次最多等待多少秒，默认 45，硬上限 50'),
      }),
    },
    async ({ taskId, outPath, download, maxWaitSeconds }) => {
      const deadline = Date.now() + Math.min(maxWaitSeconds ?? 45, 50) * 1000
      let task = null
      for (;;) {
        const r = await callH3(['get', taskId], { timeoutMs: 30000 })
        if (!r.ok) return fromH3(r)
        task = r.json
        if (['succeeded', 'failed', 'cancelled'].includes(task?.status)) break
        if (Date.now() >= deadline) {
          return ok({ task_id: taskId, status: task?.status, note: '仍在生成中，请稍后再调用一次 h3_fetch_result。' })
        }
        await new Promise((res) => setTimeout(res, 8000))
      }

      const result = { task_id: taskId, status: task.status, usage: task.usage, ratio: task.ratio, resolution: task.resolution, duration: task.duration }
      if (task.status !== 'succeeded') {
        return fail(`任务未成功：${task.status}`, { ...result, error: task.error })
      }
      result.url = task.content?.url
      if (download === false || !result.url) return ok(result)

      const target = outPath || path.join(process.cwd(), '10_h3video', 'out', `${taskId}_${task.model}_${task.resolution}_${task.duration}s.mp4`)
      const d = await callH3(['download', result.url, '--out', target], { timeoutMs: 300000 })
      if (!d.ok) return fail(`下载失败：${d.message}\n${d.stderr}`, result)
      result.saved_to = d.stdout.split(/\r?\n/).filter(Boolean).pop()
      return ok(result)
    },
  )

  // 4) 任务列表
  server.registerTool(
    'h3_list_tasks',
    {
      description: '列出最近 7 天内的 H3 视频任务（含状态与成片链接）。',
      inputSchema: z.object({ size: z.number().int().min(1).max(50).optional().describe('返回条数，默认 10') }),
    },
    async ({ size }) => fromH3(await callH3(['list', '--size', String(size ?? 10)], { timeoutMs: 30000 })),
  )

  // 5) 取消任务
  server.registerTool(
    'h3_cancel_task',
    {
      description: '取消（queued）或删除（succeeded/failed）一个 H3 任务。running 状态不可取消，会报错。',
      inputSchema: z.object({ taskId: z.string() }),
    },
    async ({ taskId }) => fromH3(await callH3(['cancel', taskId], { timeoutMs: 30000 })),
  )

  // 6) 提示词增强（H3-Context-IR）
  server.registerTool(
    'h3_enhance_prompt',
    {
      description:
        '把一句粗糙的画面想法交给官方 H3-Context-IR，扩写成 H3 要求的三段式 prompt' +
        '（integrated_multimodal_description / overall_soundscape / non_diegetic_music）。' +
        '按 token 计费（一次约几厘钱，远低于出片），官方强烈建议纳入生成流水线。' +
        '耗时通常十几秒；若本次未完成会返回 task_id，用 h3_task_status 再取。',
      inputSchema: z.object({
        prompt: z.string().min(1).describe('粗糙的想法，可中文'),
        duration: z.number().int().min(4).max(15).optional().describe('目标视频秒数，默认 5'),
        ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']).optional().describe('默认 16:9'),
        firstFrameImage: z.string().optional().describe('可选首帧图（本地路径或 URL）'),
      }),
    },
    async ({ prompt, duration, ratio, firstFrameImage }) => {
      const pf = await writePromptFile(prompt)
      const args = ['context-ir', '--prompt-file', pf, '--poll', '5', '--timeout', '45']
      if (duration) args.push('--duration', String(duration))
      if (ratio) args.push('--ratio', ratio)
      if (firstFrameImage) args.push('--image', firstFrameImage)
      const r = await callH3(args, { timeoutMs: 75000 })
      if (r.ok && r.json?.prompt) return ok({ enhanced_prompt: r.json.prompt })
      // 超时/未完成时兜底：把 task_id 交出去
      const tid = (r.stderr || '').match(/task_id=(\d+)/)?.[1]
      if (tid) {
        const s = await callH3(['get', tid], { timeoutMs: 30000 })
        const p = s.json?.content?.prompt
        if (p) return ok({ enhanced_prompt: p })
        return fail('Context-IR 尚未返回结果，请稍后用 h3_task_status 查询该任务', { task_id: tid })
      }
      return fromH3(r)
    },
  )

  // 7) 2K 再生成
  server.registerTool(
    'h3_regenerate_2k',
    {
      description:
        '【会花钱】把 768P 成片再生成到 2K（¥0.30/秒）。二选一：给 sourceTaskId（需白名单权限）' +
        '或给 videoPath/URL + 当初实际送模的最终 prompt。异步返回 task_id。',
      inputSchema: z.object({
        sourceTaskId: z.string().optional(),
        videoPath: z.string().optional().describe('base_video：本地 mp4 或 URL（必须有音轨、24fps、宽高被 32 整除）'),
        prompt: z.string().optional().describe('base_video 方式必填：当初真正送给模型的最终 prompt'),
        maxCostCny: z.number().optional().describe('默认 5'),
        confirmSpend: z.boolean().optional(),
      }),
    },
    async (a) => {
      const args = ['regenerate']
      if (a.sourceTaskId) {
        args.push('--source-task-id', a.sourceTaskId)
      } else {
        if (!a.videoPath || !a.prompt) return fail('需要 sourceTaskId，或同时提供 videoPath 与 prompt')
        const pf = await writePromptFile(a.prompt)
        args.push(a.videoPath, '--prompt-file', pf)
      }
      args.push('--max-cost', String(a.maxCostCny ?? 5))
      if (a.confirmSpend) args.push('--yes')
      args.push('--async') // h3.mjs 的 regenerate 会等待；这里靠 timeout 兜底
      const r = await callH3(args, { timeoutMs: 60000 })
      const tid = r.json?.task_id ?? (r.stderr || '').match(/task_id=(\d+)/)?.[1]
      if (tid) return ok({ task_id: tid, next: '用 h3_fetch_result 轮询并在成功后下载 2K 成片。' })
      return fromH3(r)
    },
  )

  // 8) 上传本地素材
  server.registerTool(
    'h3_upload_asset',
    {
      description: '把本地图片/视频/音频上传为平台素材，返回 mm_file://<file_id>，可在 prompt 里引用（素材 7 天有效）。',
      inputSchema: z.object({ filePath: z.string().describe('本地文件绝对或相对路径') }),
    },
    async ({ filePath }) => fromH3(await callH3(['upload', filePath], { timeoutMs: 300000 })),
  )

  // 9) 只查任务状态（给 Context-IR 与任意任务兜底）
  server.registerTool(
    'h3_task_status',
    {
      description: '查询任意 H3 任务的原始状态 JSON（含 status / content.url / content.prompt / usage / error）。',
      inputSchema: z.object({ taskId: z.string() }),
    },
    async ({ taskId }) => fromH3(await callH3(['get', taskId], { timeoutMs: 30000 })),
  )
}

// ---------------------------------------------------------------------------
serveStdio(() => {
  const server = new McpServer(
    { name: 'minimax-h3', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  registerTools(server)
  dbg(`已就绪：驱动=${H3} cwd=${process.cwd()} node=${process.version}`)
  return server
})
