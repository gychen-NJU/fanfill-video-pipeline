/**
 * 翻填工作台 · 作业层
 *
 * 自己管作业表（不依赖 agent 归属的 ctx.jobs），因为它要满足三件具体的事：
 *   1. 长任务有**有界**的实时日志（环形缓冲，面板每次只取尾部若干行）；
 *   2. 能**停干净**——Windows 上是树杀（脚本会再拉起 ffmpeg/python 子进程）；
 *   3. **环境清洗**：凭据形状的环境变量不传给子进程（照 DSH 的策略；
 *      工作台本来也不该拿着 API key 去跑东西）。
 *
 * 作业表是进程内状态：dsh web 重启即清空（面板会如实说明）。
 */
import { spawn } from 'node:child_process'

const SENSITIVE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i
/** 少数"看着敏感但不该剔"的变量。 */
const KEEP = new Set(['DSH_HOME', 'DSH_PROFILE', 'DSH_PROFILE_DIR'])

export function scrubbedEnv(extra = {}) {
  const out = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || v === null) continue
    if (SENSITIVE.test(k) && !KEEP.has(k)) continue
    out[k] = v
  }
  // Windows 上 Python 子进程的输出编码必须钉死，否则中文日志会乱码。
  return { ...out, PYTHONIOENCODING: 'utf-8', ...extra }
}

export function createJobs({ maxJobs = 12, maxLines = 400, maxLineBytes = 8192, maxConcurrent = 4 } = {}) {
  const jobs = new Map()
  let seq = 0

  const evict = () => {
    const settled = [...jobs.values()].filter((j) => j.status !== 'running' && j.status !== 'cancelling')
    while (jobs.size > maxJobs && settled.length) {
      const oldest = settled.shift()
      jobs.delete(oldest.id)
    }
  }

  const pushLine = (job, stream, text) => {
    job.lines.push({ stream, text: text.length > maxLineBytes ? `${text.slice(0, maxLineBytes)}…（截断）` : text, at: Date.now() })
    if (job.lines.length > maxLines) { job.lines.shift(); job.truncated = true }
  }

  /** 运行中（含正在取消）的作业。 */
  const runningList = () => [...jobs.values()]
    .filter((j) => j.status === 'running' || j.status === 'cancelling')
    .map((j) => ({ id: j.id, label: j.label, status: j.status, startedAt: j.startedAt, actionId: j.actionId, songId: j.songId }))

  const pipe = (job, readable, stream) => {
    let carry = ''
    readable.on('data', (chunk) => {
      carry += chunk.toString('utf8')
      let idx
      while ((idx = carry.indexOf('\n')) >= 0) {
        pushLine(job, stream, carry.slice(0, idx).replace(/\r$/, ''))
        carry = carry.slice(idx + 1)
      }
      if (carry.length > maxLineBytes) { pushLine(job, stream, carry); carry = '' }
    })
    readable.on('end', () => { if (carry !== '') pushLine(job, stream, carry.replace(/\r$/, '')) })
  }

  const settle = (job, code, note) => {
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return
    job.endedAt = Date.now()
    job.exitCode = typeof code === 'number' ? code : null
    if (job.timedOut) job.status = 'timeout'
    else if (job.cancelReason) job.status = 'cancelled'
    else job.status = code === 0 ? 'done' : 'failed'
    if (note) pushLine(job, 'note', note)
    if (job.killTimer) { clearTimeout(job.killTimer); job.killTimer = null }
    if (job.graceTimer) { clearTimeout(job.graceTimer); job.graceTimer = null }
    // 独立核验 M2：孙进程被 reparent 后会一直占着管道，作业就永远卡在 cancelling。
    // 这里主动断开我们这一侧的管道读取，再去掉 child 引用，让状态机收敛。
    try { job.child?.stdout?.destroy() } catch { /* ignore */ }
    try { job.child?.stderr?.destroy() } catch { /* ignore */ }
    job.child = null
    evict()
  }

  const start = ({ songRoot, label, interpreter, argv, timeoutMs = 600000, actionId, songId, kind }) => {
    // 独立核验 L6：无并发上限时作业表可以被任意撑爆；并且运行中的作业永不被驱逐。
    if (runningList().length >= maxConcurrent) {
      const err = new Error(`同时运行的作业已达上限 ${maxConcurrent} 个，请等一个跑完或先中止它`)
      err.code = 429
      throw err
    }
    const id = `job-${++seq}-${Date.now().toString(36)}`
    const job = {
      id, actionId, songId, label, interpreter, argv, songRoot, kind: kind || 'preview',
      status: 'running', startedAt: Date.now(), endedAt: null, exitCode: null,
      lines: [], truncated: false, child: null, killTimer: null, cancelReason: null, timedOut: false,
    }
    jobs.set(id, job)
    let child
    try {
      child = spawn(interpreter, argv, {
        cwd: songRoot,
        env: scrubbedEnv(),
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      pushLine(job, 'note', `spawn 失败：${String((error && error.message) || error)}`)
      settle(job, -1)
      return job
    }
    job.child = child
    if (child.stdout) pipe(job, child.stdout, 'out')
    if (child.stderr) pipe(job, child.stderr, 'err')
    child.on('error', (error) => settle(job, -1, `spawn 失败：${String((error && error.message) || error)}`))
    child.on('close', (code) => settle(job, code))
    if (timeoutMs > 0) {
      job.killTimer = setTimeout(() => {
        job.timedOut = true
        pushLine(job, 'note', `超过超时 ${Math.round(timeoutMs / 1000)}s，已请求中止`)
        kill(job, 'timeout')
      }, timeoutMs)
    }
    return job
  }

  /** Windows 上必须树杀：被调脚本会再拉起 ffmpeg / python 子进程。接受作业 id 或作业对象。 */
  const kill = (jobOrId, reason) => {
    const job = typeof jobOrId === 'string' ? jobs.get(jobOrId) : jobOrId
    if (!job) return { ok: false, error: `未知作业：${jobOrId}` }
    if (job.status !== 'running' && job.status !== 'cancelling') return { ok: false, error: `作业已结束（${job.status}）` }
    job.cancelReason = reason || 'user'
    job.status = 'cancelling'
    const child = job.child
    // 独立核验 M2：Cancel 之后必须**有兜底结算**。子进程若被 reparent 的孙进程占着管道，
    // 光靠 'close' 事件可能永远不来 —— 5 秒后强制收敛成 cancelled，日志里说明原因。
    if (!job.graceTimer) {
      job.graceTimer = setTimeout(() => {
        if (job.status === 'cancelling') {
          pushLine(job, 'note', '取消后 5 秒仍未退出（可能有被 reparent 的孙进程占着管道）—— 已按已取消结算')
          settle(job, null)
        }
      }, 5000)
    }
    if (!child || !child.pid) { settle(job, null); return { ok: true } }
    if (process.platform === 'win32') {
      try {
        const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        tk.on('error', () => { try { child.kill('SIGKILL') } catch { /* ignore */ } })
      } catch { try { child.kill('SIGKILL') } catch { /* ignore */ } }
    } else {
      try { child.kill('SIGTERM') } catch { /* ignore */ }
    }
    setTimeout(() => { if (job.status === 'cancelling' && job.child) { try { job.child.kill('SIGKILL') } catch { /* ignore */ } } }, 4000)
    return { ok: true }
  }

  const view = (job, tail = 200) => {
    if (!job) return null
    const lines = job.lines.slice(Math.max(0, job.lines.length - tail))
    return {
      id: job.id,
      actionId: job.actionId,
      songId: job.songId,
      label: job.label,
      kind: job.kind,
      status: job.status,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      durationMs: (job.endedAt || Date.now()) - job.startedAt,
      exitCode: job.exitCode,
      timedOut: job.timedOut,
      cancelReason: job.cancelReason,
      truncated: job.truncated,
      lineCount: job.lines.length,
      command: [job.interpreter, ...job.argv].join(' '),
      log: lines.map((l) => `[${l.stream}] ${l.text}`).join('\n'),
    }
  }

  return {
    start,
    kill,
    get: (id, tail) => view(jobs.get(id), tail),
    list: (tail = 5) => [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).map((j) => view(j, tail)),
    running: runningList,
    size: () => jobs.size,
  }
}
