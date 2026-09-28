/**
 * 翻填工作台 · Client 半边（v2：引导式流水线工作台）
 *
 * 一个右侧栏面板（可全屏），把「从原曲到投稿」的七个阶段摆成可点、可交、可派单的流水线：
 *   ① 引导：每个阶段告诉你 目标 / 需要你提供什么 / 怎么做 / 谁做 / 产物 / 验收
 *   ② 交素材：上传文件、或指定工作区里已有的文件（落盘 + 回写 翻填项目.json，绝不覆盖）
 *   ③ 干跑：--plan 之类的只读动作，工作台直接跑，实时看日志
 *   ④ 派单：一条自包含消息注入**当前会话**，让智能体去做（花钱的东西只走这条路）
 *   ⑤ 对话：底部 dock 随时和当前会话的智能体说话，或把提示词填进输入框自己改
 *
 * 硬约束（踩过坑的）：
 *   - 模块注册 id 必须**逐字等于** package.json 的 name（否则整页白屏）；
 *   - 样式只用 `--dsw-*` 主题 token，不 import 任何 Harness Client 包；
 *   - 每个区块独立容错：任何一处异常都不能让面板白屏。
 */
window.__ModuleLoader__.load({
  id: 'dsh-fantian-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    const TAB_ID = 'fantian-workbench'
    const TAB_KIND = 'fantian-workbench'
    const TITLE = '翻填工作台'
    const API = '/fantian-workbench/v1'
    const POLL_IDLE_MS = 10000
    const POLL_BUSY_MS = 1500

    // ── 样式：只用主题 token，亮/暗自动跟随 ────────────────────────────────
    const CSS = `
.fw-root{display:flex;flex-direction:column;height:100%;min-height:0;
  font-family:var(--dsw-font-family);font-size:var(--dsw-font-s-14-font-size,13px);
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);}
.fw-head{display:flex;align-items:center;gap:8px;padding:8px 12px;
  border-bottom:1px solid var(--dsw-alias-separator-primary);flex:none;flex-wrap:wrap;}
.fw-title{font-weight:600;font-size:var(--dsw-font-base-strong-16-font-size,14px);}
.fw-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:var(--dsw-radius-sm,6px);
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);
  font-size:var(--dsw-font-xxs-12-font-size,12px);white-space:nowrap;}
.fw-chip-ok{color:var(--dsw-alias-state-success-primary);}
.fw-chip-warn{color:var(--dsw-alias-state-warn-primary);}
.fw-chip-err{color:var(--dsw-alias-state-error-primary);}
.fw-chip-info{color:var(--dsw-alias-state-business-primary);}
.fw-spacer{flex:1 1 auto;}
.fw-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-tool-bar-fill);
  color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm,6px);
  padding:2px 9px;cursor:pointer;font:inherit;line-height:1.6;white-space:nowrap;}
.fw-btn:hover{background:var(--dsw-alias-button-tool-bar-hover);}
.fw-btn:disabled{opacity:.5;cursor:not-allowed;}
.fw-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600;}
.fw-btn-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-link);padding:2px 5px;}
.fw-btn-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);}
.fw-btn-sm{padding:0 6px;font-size:var(--dsw-font-xxs-12-font-size,12px);}
.fw-scroll{overflow:auto;min-height:0;flex:1 1 auto;padding:8px 12px 16px;}
.fw-sec{margin-bottom:12px;}
.fw-sec-head{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;
  padding:3px 0;color:var(--dsw-alias-label-primary);font-weight:600;}
.fw-alert{display:flex;gap:7px;align-items:flex-start;padding:6px 9px;margin-bottom:6px;
  border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);
  border-left:3px solid var(--dsw-alias-border-l2);line-height:1.55;}
.fw-alert-warn{border-left-color:var(--dsw-alias-state-warn-primary);}
.fw-alert-error{border-left-color:var(--dsw-alias-state-error-primary);}
.fw-alert-info{border-left-color:var(--dsw-alias-state-business-primary);}
.fw-alert-ok{border-left-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-secondary);}
.fw-tabs{display:flex;gap:2px;padding:0 8px;border-bottom:1px solid var(--dsw-alias-separator-primary);flex:none;overflow-x:auto;}
.fw-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;
  padding:6px 9px;font:inherit;border-bottom:2px solid transparent;white-space:nowrap;}
.fw-tab:hover{color:var(--dsw-alias-label-primary);}
.fw-tab-on{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600;}
.fw-dim{color:var(--dsw-alias-label-tertiary);}
.fw-2{color:var(--dsw-alias-label-secondary);}
.fw-mono{font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);
  font-size:var(--dsw-font-xxs-12-font-size,12px);}
.fw-stage{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);
  margin-bottom:6px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);}
.fw-stage-current{border-color:var(--dsw-alias-brand-primary);}
.fw-stage-head{display:flex;align-items:center;gap:8px;padding:7px 9px;cursor:pointer;user-select:none;}
.fw-stage-head:hover{background:var(--dsw-alias-interactive-bg-hover);}
.fw-stage-t{font-weight:600;min-width:0;}
.fw-stage-body{padding:2px 10px 10px;border-top:1px solid var(--dsw-alias-separator-primary);}
.fw-kv{display:flex;gap:8px;padding:3px 0;align-items:baseline;}
.fw-kv-k{min-width:82px;color:var(--dsw-alias-label-tertiary);flex:none;}
.fw-kv-v{min-width:0;word-break:break-word;}
.fw-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);
  border-radius:var(--dsw-radius-md,8px);padding:7px 9px;line-height:1.5;min-width:0;}
.fw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;}
.fw-card-t{display:flex;align-items:center;gap:6px;font-weight:600;}
.fw-card-p{color:var(--dsw-alias-label-tertiary);word-break:break-all;
  font-size:var(--dsw-font-xxxs-11-font-size,11px);margin-top:2px;}
.fw-slot{display:flex;gap:8px;align-items:center;padding:4px 0;flex-wrap:wrap;
  border-bottom:1px solid var(--dsw-alias-separator-primary);}
.fw-slot:last-child{border-bottom:none;}
.fw-slot-label{min-width:104px;flex:none;}
.fw-slot-path{min-width:0;flex:1 1 180px;word-break:break-all;color:var(--dsw-alias-label-secondary);}
.fw-step{display:flex;gap:6px;align-items:baseline;padding:2px 0;}
.fw-step-ok{color:var(--dsw-alias-label-secondary);}
.fw-pre{margin:0;padding:8px;background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-sm,6px);
  font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);
  font-size:var(--dsw-font-xxxs-11-font-size,11px);white-space:pre-wrap;word-break:break-word;
  max-height:320px;overflow:auto;color:var(--dsw-alias-label-primary);}
.fw-row{display:flex;gap:8px;align-items:baseline;padding:4px 0;
  border-bottom:1px solid var(--dsw-alias-separator-primary);}
.fw-row:last-child{border-bottom:none;}
.fw-num{color:var(--dsw-alias-label-tertiary);min-width:26px;text-align:right;
  font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);
  font-size:var(--dsw-font-xxs-12-font-size,12px);}
.fw-ly{display:grid;grid-template-columns:34px 58px 1fr;gap:6px;align-items:baseline;
  padding:3px 2px;border-bottom:1px solid var(--dsw-alias-separator-primary);}
.fw-ly-over{background:var(--dsw-alias-bg-mask-1);}
.fw-ly-text{min-width:0;word-break:break-word;}
.fw-tbl{width:100%;border-collapse:collapse;font-size:var(--dsw-font-xxs-12-font-size,12px);}
.fw-tbl th{text-align:left;color:var(--dsw-alias-label-tertiary);font-weight:500;
  padding:3px 5px;border-bottom:1px solid var(--dsw-alias-separator-primary);white-space:nowrap;}
.fw-tbl td{padding:3px 5px;border-bottom:1px solid var(--dsw-alias-separator-primary);vertical-align:top;}
.fw-dock{flex:none;border-top:1px solid var(--dsw-alias-separator-primary);background:var(--dsw-alias-bg-layer-1);padding:6px 10px;}
.fw-dock-row{display:flex;gap:6px;align-items:center;}
.fw-input{flex:1 1 auto;min-width:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);padding:3px 7px;font:inherit;}
.fw-input-sm{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);padding:2px 6px;
  font:inherit;font-size:var(--dsw-font-xxs-12-font-size,12px);max-width:100%;}
.fw-modal{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);display:flex;align-items:center;
  justify-content:center;z-index:20;padding:12px;}
.fw-modal-box{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);
  padding:12px;max-width:100%;max-height:90%;overflow:auto;min-width:280px;
  box-shadow:var(--dsw-elevation-md,0 6px 24px rgba(0,0,0,.28));}
.fw-rel{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;}
.fw-bar{height:5px;border-radius:3px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;margin-top:5px;}
.fw-bar>i{display:block;height:100%;background:var(--dsw-alias-state-success-primary);}
.fw-bar.warn>i{background:var(--dsw-alias-state-warn-primary);}
.fw-ls{max-height:240px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);}
.fw-ls-row{display:flex;gap:6px;align-items:center;padding:3px 7px;cursor:pointer;}
.fw-ls-row:hover{background:var(--dsw-alias-interactive-bg-hover);}
`
    function applyStyles() {
      const el = document.createElement('style')
      el.id = 'fantian-workbench-styles-v2'
      el.textContent = CSS
      document.head.appendChild(el)
      return () => { el.remove() }
    }

    // ── 与 Host 半边说话 ─────────────────────────────────────────────────
    const getJson = async (pathname) => {
      const r = await fetch(`${API}${pathname}`, { headers: { accept: 'application/json' } })
      const text = await r.text()
      let data = {}
      try { data = JSON.parse(text) } catch { data = { ok: false, error: `响应不是 JSON（HTTP ${r.status}）` } }
      return { status: r.status, ...data }
    }
    const postJson = async (pathname, body) => {
      const r = await fetch(`${API}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fantian': '1' },
        body: JSON.stringify(body || {}),
      })
      const text = await r.text()
      let data = {}
      try { data = JSON.parse(text) } catch { data = { ok: false, error: `响应不是 JSON（HTTP ${r.status}）` } }
      return { status: r.status, ...data }
    }
    /** 上传走 XHR：要进度条（大音频/视频文件会传几十秒）。 */
    const uploadFile = ({ song, slot, file, rel, expectSha, onProgress }) => new Promise((resolve) => {
      const qs = new URLSearchParams({ song, slot, name: file.name || 'file' })
      if (rel) qs.set('rel', rel)
      if (expectSha) qs.set('expectSha', expectSha)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API}/upload?${qs.toString()}`)
      xhr.setRequestHeader('x-fantian', '1')
      xhr.setRequestHeader('content-type', 'application/octet-stream')
      if (xhr.upload && onProgress) xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total || file.size)
      xhr.onload = () => {
        let data = {}
        try { data = JSON.parse(xhr.responseText) } catch { data = { ok: false, error: `HTTP ${xhr.status}` } }
        resolve({ status: xhr.status, ...data })
      }
      xhr.onerror = () => resolve({ ok: false, error: '上传失败（网络错误）' })
      xhr.onabort = () => resolve({ ok: false, error: '上传被取消' })
      xhr.send(file)
    })

    const fmtBytes = (n) => {
      if (!n && n !== 0) return '—'
      if (n < 1024) return `${n} B`
      if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
      if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
      return `${(n / 1073741824).toFixed(2)} GB`
    }
    const fmtTc = (s) => {
      if (typeof s !== 'number' || !isFinite(s)) return '—'
      const m = Math.floor(s / 60)
      return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`
    }
    const fmtCny = (n) => (typeof n === 'number' && isFinite(n) ? `¥${n.toFixed(2)}` : '—')
    const fmtDelta = (n) => (typeof n !== 'number' ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}s`)
    const statusIcon = { done: '✅', current: '▶', todo: '⏸', blocked: '⛔' }

    function Alert({ level, text, children }) {
      const icon = level === 'error' ? '⛔' : level === 'warn' ? '⚠' : level === 'ok' ? '✅' : 'ℹ'
      return h('div', { className: `fw-alert fw-alert-${level}` },
        h('span', null, icon),
        h('span', { style: { minWidth: 0 } }, text, children))
    }

    function Section({ title, count, defaultOpen = true, children }) {
      const [open, setOpen] = useState(defaultOpen)
      return h('div', { className: 'fw-sec' },
        h('div', { className: 'fw-sec-head', onClick: () => setOpen(!open), role: 'button', tabIndex: 0,
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } } },
          h('span', { className: 'fw-caret fw-dim' }, open ? '▾' : '▸'),
          h('span', null, title),
          typeof count === 'number' ? h('span', { className: 'fw-dim' }, `（${count}）`) : null),
        open ? h('div', null, children) : null)
    }

    // ── 快照轮询 ─────────────────────────────────────────────────────────
    function useSnapshot(song) {
      const [state, setState] = useState({ status: 'loading', data: null, error: null })
      const alive = useRef(true)
      const busy = !!(state.data && state.data.jobs && state.data.jobs.running && state.data.jobs.running.length)
      const load = useCallback(async () => {
        const res = await getJson(`/snapshot${song ? `?song=${encodeURIComponent(song)}` : ''}`)
        if (!alive.current) return
        if (res.ok === false) setState((s) => ({ status: s.data ? 'ready' : 'error', data: s.data, error: res.error || '读取失败' }))
        else setState({ status: 'ready', data: res, error: null })
      }, [song])
      useEffect(() => {
        alive.current = true
        void load()
        const t = setInterval(() => { void load() }, busy ? POLL_BUSY_MS : POLL_IDLE_MS)
        return () => { alive.current = false; clearInterval(t) }
      }, [load, busy])
      return [state, load, busy]
    }

    // ── 派单：把消息送进当前会话（官方 Client 会话接口）──────────────────
    function makeAgent(ctx) {
      return (props, text, mode = 'queue') => {
        const sessionId = props && props.sessionId
        const inputActions = props && props.inputActions
        const degrade = (reason) => {
          if (inputActions && typeof inputActions.setDraft === 'function') {
            try {
              inputActions.setDraft(text)
              if (typeof inputActions.notify === 'function') inputActions.notify('info', '已填入输入框（工作台拿不到会话接口），请手动发送')
              return { ok: false, degraded: true, error: reason }
            } catch { /* 继续往下报错 */ }
          }
          return { ok: false, error: reason }
        }
        if (!sessionId) return degrade('拿不到当前会话 id：请在本会话里打开工作台面板')
        let session = null
        try {
          const sessions = ctx.get('sessions')
          const binding = sessions && typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null
          session = binding && binding.session
        } catch { session = null }
        if (!session || typeof session.prompt !== 'function') return degrade('当前会话还没被持有（换个会话或刷新页面再试）')
        return Promise.resolve(session.prompt([{ type: 'text', text }], mode))
          .then((r) => {
            if (r && r.ok === false) return degrade((r.error && (r.error.message || r.error.code)) || '派单被拒')
            return { ok: true }
          })
          .catch((e) => degrade(String((e && e.message) || e)))
      }
    }

    /** 「只填进输入框」：直接写 draft，不碰会话（让用户自己改完再发）。 */
    function fillDraft(props, text) {
      const ia = props && props.inputActions
      if (ia && typeof ia.setDraft === 'function') {
        try {
          ia.setDraft(text)
          if (typeof ia.notify === 'function') ia.notify('info', '已填入输入框，改完按回车发送')
          return { ok: true, drafted: true }
        } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
      }
      return { ok: false, error: '这个环境拿不到输入框接口（可改用「让 agent 跑」）' }
    }

    // ── 作业：启动后自己轮询日志（面板要"看得见在跑"）────────────────────
    function useJobRunner(ctx) {
      const [job, setJob] = useState(null)
      const [error, setError] = useState(null)
      const timer = useRef(null)
      const stop = useCallback(() => { if (timer.current) { clearInterval(timer.current); timer.current = null } }, [])
      const watch = useCallback((jobId) => {
        stop()
        const tick = async () => {
          const res = await getJson(`/job?job=${encodeURIComponent(jobId)}&tail=300`)
          if (res.ok === false) { setError(res.error || '读不到作业'); stop(); return }
          setJob(res.job)
          if (res.job && res.job.status !== 'running' && res.job.status !== 'cancelling') { stop(); return }
        }
        void tick()
        timer.current = setInterval(() => { void tick() }, 1200)
      }, [stop])
      useEffect(() => () => stop(), [stop])
      const run = useCallback(async (song, action) => {
        setError(null)
        // 需要二次确认的动作（写产物 / 来自本歌覆盖文件）带上 confirm
        const res = await postJson('/run', { song, actionId: action.id, confirm: action.requiresConfirm === true })
        if (res.ok === false) {
          setError(res.error || '动作没能启动')
          if (res.builtin) setJob({ id: 'builtin', label: action.label, status: res.ok ? 'done' : 'failed', log: JSON.stringify(res, null, 2), builtin: true })
          else setJob({ id: 'builtin-error', label: action.label, status: 'failed', log: res.error || '', builtin: true })
          return res
        }
        if (res.builtin) { setJob({ id: 'builtin', label: action.label, status: 'done', log: JSON.stringify(res, null, 2), builtin: true }); return res }
        watch(res.jobId)
        return res
      }, [watch])
      const cancel = useCallback(async () => {
        if (!job || job.builtin) return
        await postJson('/job/cancel', { job: job.id })
      }, [job])
      return { job, error, run, cancel }
    }

    // ── 上传 / 就地指定 的小组件 ─────────────────────────────────────────
    function UploadButton({ label, accept, multiple, directory, onFiles, disabled }) {
      const ref = useRef(null)
      return h('span', null,
        h('button', { className: 'fw-btn fw-btn-sm', disabled, onClick: () => ref.current && ref.current.click() }, label),
        h('input', {
          ref, type: 'file', style: { display: 'none' },
          accept: accept && accept.length ? accept.join(',') : undefined,
          multiple: !!multiple,
          webkitdirectory: directory ? 'true' : undefined,
          directory: directory ? 'true' : undefined,
          onChange: (e) => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) onFiles(files) },
        }))
    }

    /** 从工作区里挑一个已有文件（就地指定，不复制）。 */
    function InPlacePicker({ song, slot, onClose, onPicked }) {
      const [cur, setCur] = useState('')
      const [list, setList] = useState({ entries: [], error: null, loading: true })
      useEffect(() => {
        let alive = true
        setList((s) => ({ ...s, loading: true }))
        getJson(`/ls?song=${encodeURIComponent(song)}&path=${encodeURIComponent(cur)}`).then((res) => {
          if (!alive) return
          setList({ entries: res.entries || [], error: res.ok === false ? res.error : null, loading: false })
        })
        return () => { alive = false }
      }, [song, cur])
      const accept = slot.accept || []
      return h('div', { className: 'fw-modal', onClick: onClose },
        h('div', { className: 'fw-modal-box', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'fw-sec-head' }, h('span', null, `选「${slot.label}」用的已有文件`)),
          h('div', { className: 'fw-dock-row', style: { marginBottom: 6 } },
            h('button', { className: 'fw-btn fw-btn-sm', onClick: () => setCur(cur.split('/').slice(0, -1).join('/')) }, '↑ 上一级'),
            h('span', { className: 'fw-mono fw-dim' }, `/${cur}`)),
          h('div', { className: 'fw-ls' },
            list.loading ? h('div', { className: 'fw-dim', style: { padding: 6 } }, '读取中…') : null,
            list.error ? h('div', { className: 'fw-alert fw-alert-error' }, list.error) : null,
            (list.entries || []).map((e) => h('div', {
              key: e.rel, className: 'fw-ls-row',
              onClick: () => {
                if (e.isDir) { if (!e.skipped) setCur(e.rel) ; return }
                const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase()
                if (accept.length && !accept.includes(ext)) return
                onPicked(e.rel)
              },
            },
              h('span', null, e.isDir ? '📁' : '📄'),
              h('span', { className: e.skipped ? 'fw-dim' : '', style: { minWidth: 0, wordBreak: 'break-all' } }, e.name),
              e.skipped ? h('span', { className: 'fw-dim fw-mono' }, '（大目录，跳过）') : null)),
            !list.loading && !(list.entries || []).length ? h('div', { className: 'fw-dim', style: { padding: 6 } }, '这个目录是空的') : null),
          h('div', { className: 'fw-dock-row', style: { marginTop: 8, justifyContent: 'flex-end' } },
            h('button', { className: 'fw-btn', onClick: onClose }, '取消'))))
    }

    // ── 阶段卡 ───────────────────────────────────────────────────────────
    function SlotRow({ slot, song, expectSha, snapshot, onDone, onError }) {
      const [busy, setBusy] = useState(null) // {i,n,name}
      const [pick, setPick] = useState(false)
      const [sha, setSha] = useState(expectSha)
      useEffect(() => { setSha(expectSha) }, [expectSha])
      const cur = slot.current
      const ready = !!(cur && cur.exists)
      const doUpload = async (files) => {
        setBusy({ i: 1, n: files.length, name: files[0].name })
        const multi = files.length > 1
        let failed = 0
        let last = null
        for (let i = 0; i < files.length; i += 1) {
          const f = files[i]
          // 目录上传：剥掉用户选的那层文件夹名，保留里面的结构
          const rel = f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1, -1).join('/') : ''
          setBusy({ i: i + 1, n: files.length, name: f.name })
          const res = await uploadFile({
            song, slot: slot.id, file: f, rel: multi || rel ? rel : '', expectSha: sha,
          })
          if (res.ok === false) { failed += 1; onError(`${f.name}：${res.error}`) }
          else { last = res; if (res.sha256) setSha(res.sha256) }
        }
        setBusy(null)
        if (!failed) {
          // 用宿主回传的新哈希续命：多槽连续上传不会因为乐观锁而过期
          if (last && last.sha256) setSha(last.sha256)
          onDone(multi ? `已提交 ${files.length} 个文件` : '已提交')
        }
      }
      return h('div', { className: 'fw-slot' },
        h('span', { className: 'fw-slot-label' },
          h('span', null, ready ? '✅ ' : (slot.required ? '⛔ ' : '○ ')),
          h('span', null, slot.label)),
        h('span', { className: 'fw-slot-path fw-mono' },
          ready ? `${cur.path}　${fmtBytes(cur.bytes)}` : h('span', { className: 'fw-dim' }, slot.required ? '必填，还没交' : '可选，还没交')),
        h('span', { className: 'fw-spacer' }),
        busy ? h('span', { className: 'fw-chip fw-chip-info' }, `上传中 ${busy.i}/${busy.n} ${busy.name.slice(0, 18)}`) : null,
        h(UploadButton, {
          label: ready ? '换一份' : '上传', accept: slot.accept, multiple: slot.multi, directory: false,
          onFiles: (files) => void doUpload(files), disabled: !!busy,
        }),
        slot.multi ? h(UploadButton, {
          label: '传文件夹', accept: slot.accept, multiple: true, directory: true,
          onFiles: (files) => void doUpload(files), disabled: !!busy,
        }) : null,
        h('button', { className: 'fw-btn fw-btn-sm', onClick: () => setPick(true), disabled: !!busy }, '选已有'),
        ready && cur.path ? h('button', {
          className: 'fw-btn fw-btn-ghost fw-btn-sm',
          onClick: () => void postJson('/reveal', { song, path: cur.path }),
        }, '定位') : null,
        pick ? h(InPlacePicker, {
          song, slot,
          onClose: () => setPick(false),
          onPicked: async (relPath) => {
            setPick(false)
            const res = await postJson('/link', { song, slot: slot.id, path: relPath, mode: 'inplace', expectSha: sha })
            if (res.ok === false) onError(res.error || '指定失败')
            else { if (res.sha256) setSha(res.sha256); onDone(res.mode === 'copy' ? `已复制入库：${res.path}` : `已指定：${res.path}`) }
          },
        }) : null,
        slot.hint ? h('div', { className: 'fw-card-p' }, slot.hint) : null)
    }

    function StageCard({ stage, song, snap, expectSha, agent, onDraft, jobRunner, onChanged, onError, onToast, open, onToggle }) {
      const [showLog, setShowLog] = useState(false)
      const [confirmAction, setConfirmAction] = useState(null)
      const statusText = { done: '已完成', current: '进行中', todo: '未开始', blocked: '被配置卡住' }[stage.status] || stage.status

      const dispatch = async (text, mode) => {
        const res = await agent(text, mode)
        if (res.ok) onToast('已派单：消息已进入当前会话')
        else onError(res.error || '派单失败')
      }
      const runAction = async (action) => {
        if (action.kind !== 'preview') {
          const res = await jobRunner.run(song, action)
          if (res && res.ok !== false) onToast(`已启动：${action.label}`)
          return
        }
        await jobRunner.run(song, action)
      }

      return h('div', { className: `fw-stage ${stage.status === 'current' ? 'fw-stage-current' : ''}` },
        h('div', { className: 'fw-stage-head', onClick: onToggle, role: 'button', tabIndex: 0,
          onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onToggle() } } },
          h('span', { className: 'fw-dim' }, open ? '▾' : '▸'),
          h('span', null, statusIcon[stage.status] || '⏸'),
          h('span', { className: 'fw-stage-t' }, `阶段 ${stage.n} · ${stage.title}`),
          h('span', { className: 'fw-spacer' }),
          stage.paid ? h('span', { className: 'fw-chip fw-chip-warn' }, '花钱') : null,
          h('span', { className: `fw-chip ${stage.status === 'done' ? 'fw-chip-ok' : stage.status === 'blocked' ? 'fw-chip-err' : ''}` },
            `${statusText} ${stage.doneCount}/${stage.stepCount}`)),

        open ? h('div', { className: 'fw-stage-body' },
          h('div', { className: 'fw-kv' }, h('span', { className: 'fw-kv-k' }, '目标'), h('span', { className: 'fw-kv-v' }, stage.goal)),
          stage.gate ? h('div', { className: 'fw-kv' }, h('span', { className: 'fw-kv-k' }, '验收门槛'), h('span', { className: 'fw-kv-v fw-2' }, stage.gate)) : null,
          (stage.notes || []).map((n, i) => h('div', { key: `n${i}`, className: 'fw-kv' },
            h('span', { className: 'fw-kv-k' }, i === 0 ? '本歌说明' : ''),
            h('span', { className: 'fw-kv-v fw-dim' }, n))),

          // 需要你提供
          stage.slots.length ? h('div', { style: { marginTop: 6 } },
            h('div', { className: 'fw-sec-head' }, h('span', null, `需要你提供（${stage.slots.filter((s) => s.current && s.current.exists).length}/${stage.slots.length}）`)),
            stage.slots.map((slot) => h(SlotRow, {
              key: slot.id, slot, song, expectSha, snapshot: snap,
              onDone: (msg) => { onToast(msg); onChanged() }, onError,
            }))) : null,

          // 怎么做
          (stage.actions.length || stage.prompt) ? h('div', { style: { marginTop: 6 } },
            h('div', { className: 'fw-sec-head' }, h('span', null, `怎么做（主执行者：${stage.runner === 'workbench' ? '工作台' : stage.runner === 'manual' ? '你手动' : '智能体'}）`)),
            stage.actions.map((action) => h('div', { key: action.id, className: 'fw-slot' },
              h('span', { className: 'fw-slot-label' }, action.kind === 'paid' ? '💰 ' : action.kind === 'preview' ? '👁 ' : '▶ '),
              h('span', { className: 'fw-slot-path fw-mono' }, action.argvPreview || action.label),
              action.untrusted ? h('span', { className: 'fw-chip fw-chip-warn', title: '这条命令定义在 <歌根>/工作台流水线.json 里 —— 等于本机可执行内容，跑之前请自己看一眼' }, '本歌覆盖') : null,
              h('span', { className: 'fw-spacer' }),
              action.available ? null : h('span', { className: 'fw-chip fw-chip-err' }, action.reason || '前提未满足'),
              action.kind === 'paid'
                ? h('button', { className: 'fw-btn fw-btn-sm', onClick: () => dispatch(`${stage.prompt || ''}\n\n（这是花钱动作：请先给出逐段预估金额，等我确认再执行。）`) }, '让 agent 跑（先报价）')
                : action.kind === 'agent'
                  ? h('button', { className: 'fw-btn fw-btn-sm', onClick: () => dispatch(stage.prompt || action.label) }, '让 agent 跑')
                  : h('button', {
                    className: 'fw-btn fw-btn-sm',
                    disabled: !action.available,
                    onClick: () => (action.requiresConfirm ? setConfirmAction(action) : void runAction(action)),
                  }, action.requiresConfirm ? (action.writes ? '本机执行（写产物）' : '本机执行（本歌覆盖）') : '本机预览'),
              h('button', {
                className: 'fw-btn fw-btn-ghost fw-btn-sm',
                onClick: () => { try { navigator.clipboard.writeText(action.argvPreview || ''); onToast('命令已复制') } catch { /* ignore */ } },
              }, '复制'),
              action.note ? h('div', { className: 'fw-card-p' }, action.note) : null)),
            stage.prompt ? h('div', { className: 'fw-dock-row', style: { marginTop: 6, flexWrap: 'wrap' } },
              h('button', { className: 'fw-btn fw-btn-primary fw-btn-sm', onClick: () => dispatch(stage.prompt) }, '▶ 让 agent 跑这一步'),
              h('button', {
                className: 'fw-btn fw-btn-sm',
                onClick: () => { const r = onDraft(stage.prompt); onToast(r.ok ? '已填入输入框，自己改完再发' : (r.error || '填不进去')) },
              }, '填进输入框'),
              snap.jobs && snap.jobs.running && snap.jobs.running.length
                ? h('button', { className: 'fw-btn fw-btn-sm', onClick: () => dispatch(stage.prompt, 'steer') }, '打断并插入')
                : null) : null) : null,

          // 产物
          stage.artifacts.length ? h('div', { style: { marginTop: 6 } },
            h('div', { className: 'fw-sec-head' }, h('span', null, '产物')),
            h('div', { className: 'fw-grid' }, stage.artifacts.map((a) => h('div', { className: 'fw-card', key: a.path },
              h('div', { className: 'fw-card-t' },
                h('span', null, a.exists ? '✅' : '⛔'),
                h('span', { style: { minWidth: 0, wordBreak: 'break-all' } }, a.path),
                h('span', { className: 'fw-dim', style: { marginLeft: 'auto', fontWeight: 400 } }, a.exists ? fmtBytes(a.bytes) : '缺')),
              a.exists ? h('button', {
                className: 'fw-btn fw-btn-ghost fw-btn-sm',
                onClick: () => void postJson('/reveal', { song, path: a.path }),
              }, '在资源管理器打开') : null)))) : null,

          // 子步骤与验收
          h('div', { style: { marginTop: 6 } },
            h('div', { className: 'fw-sec-head' }, h('span', null, `子步骤（${stage.doneCount}/${stage.stepCount}）`)),
            stage.steps.map((s) => h('div', { key: s.id, className: 'fw-step' },
              // 需要人工确认的子步骤：给一个真的能勾的勾选框（独立核验 L10：之前 /state 没有任何入口）
              s.manual
                ? h('input', {
                  type: 'checkbox', checked: s.state === 'done', disabled: s.state === 'done',
                  title: s.state === 'done' ? '已确认' : '点一下确认这一步（写入 _进度/工作台状态.json）',
                  onChange: async () => {
                    const res = await postJson('/state', { song, ticks: { [s.id]: { done: true, note: '面板勾选', at: new Date().toISOString() } } })
                    if (res.ok === false) onError(res.error || '勾选失败')
                    else { onToast('已确认（可再点一次取消不了——要改请直接编辑 _进度/工作台状态.json）'); onChanged() }
                  },
                })
                : h('span', null, s.state === 'done' ? '✅' : '⏸'),
              h('span', { className: s.state === 'done' ? 'fw-step-ok' : '' }, s.title),
              h('span', { className: 'fw-dim fw-mono', style: { marginLeft: 'auto' } }, s.evidence ? s.evidence.slice(0, 80) : ''))),
            stage.acceptance.length ? h('div', { style: { marginTop: 4 } },
              stage.acceptance.map((a, i) => h('div', { key: i, className: 'fw-dim' }, `· ${a}`))) : null)) : null,

        confirmAction ? h('div', { className: 'fw-modal', onClick: () => setConfirmAction(null) },
          h('div', { className: 'fw-modal-box', onClick: (e) => e.stopPropagation() },
            h('div', { className: 'fw-sec-head' }, h('span', null, '确认在本机执行？')),
            h('div', { className: 'fw-alert fw-alert-warn' }, '这个动作会写产物（绝不覆盖同名文件，冲突会自动加 -2）。'),
            h('pre', { className: 'fw-pre' }, confirmAction.argvPreview),
            h('div', { className: 'fw-dock-row', style: { justifyContent: 'flex-end', marginTop: 8 } },
              h('button', { className: 'fw-btn', onClick: () => setConfirmAction(null) }, '取消'),
              h('button', { className: 'fw-btn fw-btn-primary', onClick: () => { const a = confirmAction; setConfirmAction(null); void runAction(a) } }, '执行')))) : null)
    }

    // ── 素材表单（阶段 1 的配置字段）─────────────────────────────────────
    function ConfigForm({ stage, snap, song, expectSha, onChanged, onError, onToast }) {
      const get = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), snap.configRaw || {})
      const values = useMemo(() => {
        const out = {}
        for (const f of stage.form) {
          const v = get(f.key)
          out[f.key] = v === undefined || v === null ? '' : String(v)
        }
        return out
      }, [stage.form, snap.configRaw])
      const [draft, setDraft] = useState(values)
      useEffect(() => { setDraft(values) }, [JSON.stringify(values)])
      const save = async () => {
        const patch = {}
        for (const f of stage.form) {
          const raw = draft[f.key]
          if (raw === '' || raw === undefined) continue
          const val = f.type === 'number' ? Number(raw) : raw
          if (f.type === 'number' && !isFinite(val)) { onError(`${f.label} 不是数字`); return }
          const parts = f.key.split('.')
          let node = patch
          for (let i = 0; i < parts.length - 1; i += 1) { node[parts[i]] = node[parts[i]] || {}; node = node[parts[i]] }
          node[parts[parts.length - 1]] = val
        }
        const res = await postJson('/config', { song, expect: { sha256: expectSha }, patch })
        if (res.ok === false) { onError(res.error || '保存失败'); return }
        onToast('配置已保存（旧版本已备份）')
        onChanged()
      }
      if (!stage.form.length) return null
      return h(Section, { title: '这首歌的基本信息（写进 翻填项目.json）', defaultOpen: stage.status !== 'done' },
        h('div', { className: 'fw-grid' }, stage.form.map((f) => h('label', { key: f.key, className: 'fw-card' },
          h('div', { className: 'fw-card-t' }, f.label, f.required ? h('span', { className: 'fw-chip fw-chip-err' }, '必填') : null),
          h('input', {
            className: 'fw-input-sm', type: f.type === 'number' ? 'number' : 'text',
            value: draft[f.key] ?? '', style: { width: '100%', marginTop: 4 },
            onChange: (e) => setDraft((d) => ({ ...d, [f.key]: e.target.value })),
          }),
          f.key ? h('div', { className: 'fw-card-p' }, f.key) : null,
          f.hint ? h('div', { className: 'fw-card-p' }, f.hint) : null))),
        h('div', { className: 'fw-dock-row', style: { marginTop: 8 } },
          h('button', { className: 'fw-btn fw-btn-primary', onClick: () => void save() }, '保存配置'),
          h('span', { className: 'fw-dim fw-mono' }, expectSha ? `乐观锁 ${String(expectSha).slice(0, 12)}…` : '（读不到配置哈希）')))
    }

    // ── 新建歌向导 ───────────────────────────────────────────────────────
    function NewSongWizard({ ctx, onClose, onCreated, onError }) {
      const [draft, setDraft] = useState({ parentDir: '', name: '', source: '', bpm: '', totalSec: '', voiceTarget: '', budgetCny: '' })
      const [busy, setBusy] = useState(false)
      const [list, setList] = useState(null)
      const pick = async () => {
        try {
          const ws = ctx.get('uiWorkspace')
          if (ws && typeof ws.pickDirectory === 'function') {
            const dir = await ws.pickDirectory()
            if (dir) setDraft((d) => ({ ...d, parentDir: dir }))
            return
          }
        } catch { /* 落到手填 */ }
        onError('这个环境拿不到系统目录选择器，请直接把父目录路径粘进来')
      }
      const browse = async () => {
        const res = await getJson(`/ls?dir=${encodeURIComponent(draft.parentDir)}`)
        setList(res.ok === false ? { error: res.error } : { entries: res.entries || [] })
      }
      const create = async () => {
        if (!draft.parentDir || !draft.name) { onError('父目录和歌名都得填'); return }
        setBusy(true)
        const res = await postJson('/songs', { action: 'create', parentDir: draft.parentDir, name: draft.name, fields: {
          source: draft.source, bpm: draft.bpm, totalSec: draft.totalSec, voiceTarget: draft.voiceTarget, budgetCny: draft.budgetCny,
        } })
        setBusy(false)
        if (res.ok === false) { onError(`${res.error || '新建失败'}${res.suggestion ? `　候选名：${res.suggestion}` : ''}`); return }
        onCreated(res.song || { root: res.root, name: draft.name })
        onClose()
      }
      const field = (key, label, hint) => h('label', { className: 'fw-card' },
        h('div', { className: 'fw-card-t' }, label),
        h('input', {
          className: 'fw-input-sm', value: draft[key], style: { width: '100%', marginTop: 4 },
          onChange: (e) => setDraft((d) => ({ ...d, [key]: e.target.value })),
        }),
        hint ? h('div', { className: 'fw-card-p' }, hint) : null)
      return h('div', { className: 'fw-modal', onClick: onClose },
        h('div', { className: 'fw-modal-box', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'fw-sec-head' }, h('span', null, '新建一个翻填任务')),
          h('div', { className: 'fw-dim', style: { marginBottom: 6 } },
            '会在你选的父目录下建 <歌名>/，里面有目录骨架、通用 PV 脚本、技能、翻填项目.json 与进度文档。已存在且非空的目录会被拒绝（不删任何东西）。'),
          h('div', { className: 'fw-grid' },
            field('name', '歌名 *', '同时作为目录名与产物命名'),
            h('label', { className: 'fw-card' },
              h('div', { className: 'fw-card-t' }, '父目录 *', h('button', { className: 'fw-btn fw-btn-sm', onClick: () => void pick() }, '选目录')),
              h('input', { className: 'fw-input-sm', value: draft.parentDir, style: { width: '100%', marginTop: 4 },
                onChange: (e) => setDraft((d) => ({ ...d, parentDir: e.target.value })) }),
              h('div', { className: 'fw-card-p' }, '父目录要填本机磁盘上的完整路径（绝对路径）')),
            field('source', '原曲来源', '例：某作品 第N话 插曲'),
            field('bpm', 'BPM', '不确定就先留空，后面用工具测'),
            field('totalSec', '总长（秒）', ''),
            field('voiceTarget', '目标音色', ''),
            field('budgetCny', '总预算（元）', '0 表示先不设预算')),
          h('div', { className: 'fw-dock-row', style: { justifyContent: 'flex-end', marginTop: 10 } },
            list ? h('span', { className: 'fw-dim fw-mono' }, `父目录里已有 ${(list.entries || []).length} 项`) : null,
            h('button', { className: 'fw-btn', onClick: () => void browse(), disabled: !draft.parentDir }, '看看父目录'),
            h('button', { className: 'fw-btn', onClick: onClose }, '取消'),
            h('button', { className: 'fw-btn fw-btn-primary', onClick: () => void create(), disabled: busy }, busy ? '建中…' : '建立'))))
    }

    // ── 只读视图（v1 移植：素材 / 歌词 / 出片 / 账本）────────────────────
    function MaterialsView({ snap }) {
      const mats = snap.materials || []
      const ds = snap.dirStats || {}
      const chips = (s) => Object.entries(s.byExt || {}).filter(([k]) => k !== '(none)')
        .map(([k, v]) => `${k}×${v.count}`).join(' · ')
      const dirCards = [
        ['参考图 refs', ds.refs], ['每段 prompt', ds.prompts], ['成片 clips', ds.clips],
        ['字幕 subs', ds.subs], ['封面 cover', ds.cover], ['核验 verify', ds.verify], ['归档 history', ds.history],
      ].filter(([, v]) => v)
      return h('div', null,
        h(Section, { title: '按流水线角色', count: mats.length },
          h('div', { className: 'fw-grid' }, mats.map((m) => h('div', { className: 'fw-card', key: m.key },
            h('div', { className: 'fw-card-t' },
              h('span', null, m.exists ? '✅' : '⛔'),
              h('span', null, m.role),
              h('span', { className: 'fw-dim', style: { marginLeft: 'auto', fontWeight: 400 } }, m.exists ? fmtBytes(m.bytes) : '缺')),
            h('div', { className: 'fw-card-p' }, m.path || '—'),
            h('div', { className: 'fw-dim', style: { fontSize: 11, marginTop: 2 } }, m.hint))))),
        h(Section, { title: '产物目录规模', count: dirCards.length },
          h('div', { className: 'fw-grid' }, dirCards.map(([label, s]) => h('div', { className: 'fw-card', key: label },
            h('div', { className: 'fw-card-t' }, h('span', null, label),
              h('span', { className: 'fw-dim', style: { marginLeft: 'auto', fontWeight: 400 } }, `${s.files} 个 · ${fmtBytes(s.bytes)}`)),
            h('div', { className: 'fw-card-p' }, chips(s) || '—'))))),
        h(Section, { title: '环境探活', defaultOpen: true },
          h('div', { className: 'fw-grid' },
            h('div', { className: 'fw-card' }, h('div', { className: 'fw-card-t' }, 'node'), h('div', { className: 'fw-card-p' }, snap.env?.node || '—')),
            h('div', { className: 'fw-card' }, h('div', { className: 'fw-card-t' }, snap.env?.ffmpeg?.ok ? '✅ ffmpeg' : '⛔ ffmpeg'),
              h('div', { className: 'fw-card-p' }, snap.env?.ffmpeg?.path ? `${snap.env.ffmpeg.path}（${snap.env.ffmpeg.source}）` : '没找到：可在插件配置里给 ffmpegDir，或用 video.ffmpegDir')),
            h('div', { className: 'fw-card' }, h('div', { className: 'fw-card-t' }, snap.env?.ace?.running ? '✅ ACE Studio' : '⛔ ACE Studio'),
              h('div', { className: 'fw-card-p' }, snap.env?.ace?.running ? '进程在跑，音乐线动作可用' : '没在跑 —— 出人声动作不可用')),
            h('div', { className: 'fw-card' }, h('div', { className: 'fw-card-t' }, '分离/扒谱 venv'),
              h('div', { className: 'fw-card-p' }, `sep=${snap.env?.python?.sep || '缺'}｜pitch=${snap.env?.python?.pitch || '缺'}`),
              h('div', { className: 'fw-card-p' }, `找过：${(snap.env?.python?.searched || []).join('、') || '（没有候选目录）'}`)),
            (snap.env?.junctions || []).map((j) => h('div', { className: 'fw-card', key: j.path },
              h('div', { className: 'fw-card-t' }, j.exists ? `✅ ${j.label}` : `⛔ ${j.label}`),
              h('div', { className: 'fw-card-p' }, j.exists ? '在（音乐链脚本依赖它）' : '缺 —— 音乐链脚本会直接报错'))),
            h('div', { className: 'fw-card' }, h('div', { className: 'fw-card-t' }, '超分工具'),
              h('div', { className: 'fw-card-p' }, snap.env?.upscale?.ok ? snap.env.upscale.path : `缺：${snap.env?.upscale?.path || '—'}`)))))
    }

    function LyricsView({ snap }) {
      const lyrics = snap.lyrics || []
      const min = (snap.config.video.subtitle && snap.config.video.subtitle.minDisplaySec) || 3
      if (!lyrics.length) return h(Alert, { level: 'info', text: '还没有歌词对齐数据——先跑 scripts/80_pv_shotlist.mjs 生成 plan/segments.json。' })
      const over = lyrics.filter((l) => l.flag === 'over')
      const near = lyrics.filter((l) => l.flag === 'near')
      const short = lyrics.filter((l) => l.shortDisplay)
      return h('div', null,
        h('div', { className: 'fw-row', style: { gap: 10, flexWrap: 'wrap' } },
          h('span', { className: 'fw-chip fw-chip-ok' }, `≤0.25s：${lyrics.length - over.length - near.length}`),
          h('span', { className: 'fw-chip fw-chip-warn' }, `0.25–0.40s：${near.length}`),
          h('span', { className: 'fw-chip fw-chip-err' }, `>0.40s：${over.length}`),
          h('span', { className: 'fw-chip' }, `共 ${lyrics.length} 句`)),
        h(Section, { title: '歌词对照：LRC 名义时间 / 实测起音 / 偏差', count: lyrics.length },
          lyrics.map((l) => h('div', { className: `fw-ly ${l.flag === 'over' ? 'fw-ly-over' : ''}`, key: l.n },
            h('span', { className: 'fw-num' }, l.n),
            h('span', { className: 'fw-mono fw-2' }, fmtTc(l.lrc)),
            h('span', { className: `fw-mono fw-chip ${l.flag === 'over' ? 'fw-chip-err' : l.flag === 'near' ? 'fw-chip-warn' : 'fw-chip-ok'}` }, fmtDelta(l.dev)),
            h('span', { className: 'fw-ly-text' }, l.text)))),
        short.length ? h(Section, { title: `保底时长不足 ${min}s 的句（字幕会顺延）`, count: short.length },
          short.map((l) => h('div', { className: 'fw-ly', key: l.n },
            h('span', { className: 'fw-num' }, l.n),
            h('span', { className: 'fw-mono' }, `${l.displaySec}s`),
            h('span', { className: 'fw-ly-text' }, l.text)))) : null)
    }

    function ShotsView({ snap, song, onError, onToast }) {
      const seg = snap.segments || {}
      const list = seg.list || []
      const pps = snap.config.video.pricePerSecond
      const total = list.reduce((a, s) => a + (s.genDur || 0), 0)
      if (!list.length) return h(Alert, { level: 'info', text: '还没有分镜：先跑阶段 3（scripts/80_pv_shotlist.mjs）。' })
      return h('div', null,
        h('div', { className: 'fw-row', style: { gap: 10, flexWrap: 'wrap' } },
          h('span', { className: 'fw-chip' }, `成片 ${seg.done}/${seg.total}`),
          h('span', { className: 'fw-chip' }, `生成总秒 ${seg.generatedSeconds ?? total}`),
          typeof pps === 'number' ? h('span', { className: 'fw-chip fw-chip-info' }, `按 ¥${pps}/s 估算 ${fmtCny((seg.generatedSeconds ?? total) * pps)}`) : null),
        h('table', { className: 'fw-tbl' },
          h('thead', null, h('tr', null,
            ['#', '段名', '区间', '生成秒', '模式', '素材', '状态'].map((x) => h('th', { key: x }, x)))),
          h('tbody', null, list.map((s) => h('tr', { key: s.idx },
            h('td', null, s.idx),
            h('td', { className: 'fw-mono' }, s.slug),
            h('td', { className: 'fw-mono' }, `${fmtTc(s.start)}–${fmtTc(s.end)}`),
            h('td', { className: 'fw-mono' }, String(s.genDur ?? '—')),
            h('td', { className: 'fw-mono' }, s.mode || '—'),
            h('td', { style: { maxWidth: 200, wordBreak: 'break-all' } }, s.mat || '—'),
            h('td', null, s.hasClip ? '✅' : '⛔'))))))
    }

    function LedgerView({ snap }) {
      const l = snap.ledger || { rows: [], total: 0 }
      const budget = l.budget || 0
      const ratio = budget ? Math.min(1, l.total / budget) : 0
      return h('div', null,
        h('div', { className: 'fw-row' },
          h('span', { className: 'fw-chip' }, `累计 ${fmtCny(l.total)}`),
          budget ? h('span', { className: `fw-chip ${ratio >= 0.9 ? 'fw-chip-err' : ratio >= 0.7 ? 'fw-chip-warn' : 'fw-chip-ok'}` }, `预算 ${fmtCny(budget)}（${Math.round(ratio * 100)}%）`) : null,
          budget ? h('span', { className: 'fw-chip' }, `剩 ${fmtCny(Math.max(0, budget - l.total))}`) : null),
        budget ? h('div', { className: `fw-bar ${ratio >= 0.9 ? 'err' : ratio >= 0.7 ? 'warn' : ''}` }, h('i', { style: { width: `${ratio * 100}%` } })) : null,
        h(Section, { title: '逐笔花费（结账以 _进度/成本台账.csv 为准）', count: (l.rows || []).length },
          h('table', { className: 'fw-tbl' },
            h('thead', null, h('tr', null, ['时间', '阶段', '项目', '金额', '累计', '备注'].map((x) => h('th', { key: x }, x)))),
            h('tbody', null, (l.rows || []).map((r, i) => h('tr', { key: i },
              h('td', { className: 'fw-mono' }, r.time), h('td', null, r.stage), h('td', null, r.item),
              h('td', { className: 'fw-mono' }, fmtCny(r.amount)), h('td', { className: 'fw-mono' }, r.cumulative == null ? '—' : fmtCny(r.cumulative)),
              h('td', { className: 'fw-dim' }, r.note)))))),
        h(Section, { title: '成品索引', defaultOpen: true },
          h('div', { className: 'fw-grid' }, Object.entries(snap.config.video.deliverables || {}).map(([k, v]) => h('div', { className: 'fw-card', key: k },
            h('div', { className: 'fw-card-t' }, k), h('div', { className: 'fw-card-p' }, String(v)))))))
    }

    // ── 主面板 ───────────────────────────────────────────────────────────
    function WorkbenchPanel(props) {
      const ctx = props.ctx || props.__ctx
      const [song, setSong] = useState(null)
      const [tab, setTab] = useState('guide')
      const [toast, setToast] = useState(null)
      const [error, setError] = useState(null)
      const [wizard, setWizard] = useState(false)
      const [openStage, setOpenStage] = useState(null)
      const [reloadKey, setReloadKey] = useState(0)
      const [state, reload, busy] = useSnapshot(song)
      const snap = state.data
      const active = song || (snap && snap.active) || null
      const agent = useMemo(() => makeAgent(ctx), [ctx])
      const jobRunner = useJobRunner(ctx)

      const onToast = useCallback((msg) => { setToast(msg); setError(null); setTimeout(() => setToast(null), 3200) }, [])
      const onError = useCallback((msg) => { setError(String(msg)); setTimeout(() => setError(null), 6000) }, [])
      const refresh = useCallback(() => { void reload() }, [reload])

      // 打开面板时默认把「当前阶段」展开（只自动展开一次，之后听用户的）
      const didOpen = useRef(false)
      useEffect(() => {
        if (!snap || didOpen.current) return
        didOpen.current = true
        const cur = (snap.pipeline?.stages || []).find((s) => s.status === 'current') || (snap.pipeline?.stages || [])[0]
        if (cur) setOpenStage(cur.id)
      }, [snap])
      // 作业跑完自动刷新一次（产物可能变了）
      useEffect(() => {
        if (jobRunner.job && jobRunner.job.status !== 'running' && jobRunner.job.status !== 'cancelling') refresh()
      }, [jobRunner.job && jobRunner.job.status, refresh])

      if (!snap) {
        return h('div', { className: 'fw-root' },
          h('div', { className: 'fw-head' }, h('span', { className: 'fw-title' }, TITLE),
            h('span', { className: 'fw-spacer' }),
            h('button', { className: 'fw-btn fw-btn-ghost', onClick: refresh }, '⟳')),
          h('div', { className: 'fw-scroll' },
            state.status === 'error'
              ? h(Alert, { level: 'error', text: `读取失败：${state.error || '未知错误'}` })
              : h(Alert, { level: 'info', text: '读取中…' })))
      }

      const pipeline = snap.pipeline || { stages: [] }
      const stages = pipeline.stages || []
      const running = (snap.jobs && snap.jobs.running) || []
      const spent = snap.ledger.total
      const budget = snap.ledger.budget
      const tabs = [
        ['guide', '引导', stages.length],
        ['materials', '素材', (snap.materials || []).length],
        ['lyrics', '歌词', (snap.lyrics || []).length],
        ['shots', '出片', snap.segments.done],
        ['ledger', '账本', (snap.ledger.rows || []).length],
        ['jobs', '日志', running.length + ((jobRunner.job && jobRunner.job.status !== 'running') ? 1 : 0)],
      ]

      return h('div', { className: 'fw-rel' },
        // 头部
        h('div', { className: 'fw-head' },
          h('span', { className: 'fw-title' }, TITLE),
          h('select', {
            className: 'fw-input-sm', value: active || '', onChange: (e) => setSong(e.target.value),
          }, (snap.songs || []).map((s) => h('option', { key: s.id, value: s.root },
            `${s.name}${s.configOk ? '' : '（配置有问题）'}${s.hasProgress ? '' : '（无进度文档）'}`))),
          h('button', { className: 'fw-btn fw-btn-sm', onClick: () => setWizard(true) }, '＋新建翻填任务'),
          h('span', { className: 'fw-spacer' }),
          // 宿主半边没重启时快照里没有 pipeline —— 与其显示 undefined/undefined，不如直接说清楚
          pipeline.stageCount
            ? h('span', { className: 'fw-chip' }, `阶段 ${pipeline.doneStages}/${pipeline.stageCount}`)
            : h('span', { className: 'fw-chip fw-chip-warn', title: '宿主半边返回的快照里没有 pipeline：常见原因是 index.js 改了但没重启 dsh web' }, '流水线未就绪'),
          pipeline.stepCount
            ? h('span', { className: 'fw-chip' }, `子步骤 ${pipeline.doneSteps}/${pipeline.stepCount}`)
            : null,
          budget ? h('span', { className: 'fw-chip' }, `${fmtCny(spent)} / ${fmtCny(budget)}`) : h('span', { className: 'fw-chip' }, fmtCny(spent)),
          running.length ? h('span', { className: 'fw-chip fw-chip-info' }, `作业 ${running.length}`) : null,
          h('button', { className: 'fw-btn fw-btn-ghost', title: '全屏（右侧栏展开）', onClick: () => {
            try { const l = ctx.get('layout'); if (l && l.openRightbar) l.openRightbar(false, true) } catch { /* ignore */ }
          } }, '⛶'),
          h('button', { className: 'fw-btn fw-btn-ghost', title: '重新读取（不动文件）', onClick: refresh }, busy ? '…' : '⟳')),

        // Tab
        h('div', { className: 'fw-tabs' }, tabs.map(([k, label, n]) => h('button', {
          key: k, className: `fw-tab ${k === tab ? 'fw-tab-on' : ''}`, onClick: () => setTab(k),
        }, `${label}${typeof n === 'number' ? ` ${n}` : ''}`))),

        // 主体
        h('div', { className: 'fw-scroll' },
          error ? h(Alert, { level: 'error', text: error }) : null,
          toast ? h(Alert, { level: 'ok', text: toast }) : null,
          !snap.songs?.length ? h(Alert, { level: 'info', text: '还没有登记任何歌：点右上角「＋新建翻填任务」。' }) : null,

          tab === 'guide' ? h('div', null,
            // 异常优先
            h(Section, { title: '需要你注意', count: (snap.warnings || []).filter((w) => w.level !== 'info').length },
              (snap.warnings || []).length
                ? (snap.warnings || []).map((w, i) => h(Alert, { key: i, level: w.level, text: w.text }))
                : h(Alert, { level: 'ok', text: '没有需要你注意的项' })),
            (snap.decisions || []).length ? h(Section, { title: '待你决定（来自 _进度/进度.md）', count: snap.decisions.length },
              snap.decisions.map((d, i) => h('div', { key: i, className: 'fw-row' }, h('span', null, '▢'), h('span', null, d.text)))) : null,
            snap.pipeline?.specErrors?.length ? h(Alert, { level: 'error', text: snap.pipeline.specErrors.join('；') }) : null,
            snap.pipeline?.hasOverride
              ? h('div', { className: 'fw-dim fw-mono', style: { margin: '2px 0 6px' } }, `本歌覆盖：${snap.pipeline.overridePath}`)
              : h('div', { className: 'fw-dim fw-mono', style: { margin: '2px 0 6px' } }, '用通用骨架（没有 工作台覆盖文件）'),
            stages.map((stage) => {
              const isOpen = openStage === stage.id
              return h('div', { key: stage.id },
                h(StageCard, {
                  stage, song: active, snap, expectSha: snap.configMeta?.sha256,
                  agent: (text, mode) => agent(props, text, mode),
                  onDraft: (text) => fillDraft(props, text),
                  jobRunner, open: isOpen, onToggle: () => setOpenStage(isOpen ? null : stage.id),
                  onChanged: refresh, onError, onToast,
                }),
                isOpen && stage.form && stage.form.length
                  ? h(ConfigForm, { stage, snap, song: active, expectSha: snap.configMeta?.sha256, onChanged: refresh, onError, onToast })
                  : null)
            })) : null,
          tab === 'materials' ? h(MaterialsView, { snap }) : null,
          tab === 'lyrics' ? h(LyricsView, { snap }) : null,
          tab === 'shots' ? h(ShotsView, { snap, song: active, onError, onToast }) : null,
          tab === 'ledger' ? h(LedgerView, { snap }) : null,
          tab === 'jobs' ? h('div', null,
            jobRunner.job ? h(Section, { title: `当前作业：${jobRunner.job.label}（${jobRunner.job.timedOut ? '超时中止' : jobRunner.job.status}）`, defaultOpen: true },
              h('div', { className: 'fw-row' },
                h('span', { className: 'fw-chip' }, jobRunner.job.timedOut ? '超时中止' : jobRunner.job.status),
                h('span', { className: 'fw-mono fw-dim' }, jobRunner.job.command || ''),
                h('span', { className: 'fw-spacer' }),
                jobRunner.job.status === 'running'
                  ? h('button', { className: 'fw-btn fw-btn-sm', onClick: () => void jobRunner.cancel() }, '中止')
                  : null),
              h('pre', { className: 'fw-pre' }, jobRunner.job.log || '（还没有输出）')) : h(Alert, { level: 'info', text: '这一轮还没有在本机跑过动作。' }),
            running.length ? h(Section, { title: '正在跑', count: running.length },
              running.map((j) => h('div', { key: j.id, className: 'fw-row' },
                h('span', { className: 'fw-chip fw-chip-info' }, j.status),
                h('span', null, j.label),
                h('span', { className: 'fw-spacer' }),
                h('button', { className: 'fw-btn fw-btn-sm', onClick: () => void postJson('/job/cancel', { job: j.id }) }, '中止')))) : null) : null),

        // 作业条（跑着的时候一直可见）
        (running.length || (jobRunner.job && jobRunner.job.status === 'running')) ? h('div', { className: 'fw-dock' },
          h('div', { className: 'fw-dock-row' },
            h('span', { className: 'fw-chip fw-chip-info' }, '作业进行中'),
            h('span', { className: 'fw-mono', style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              (jobRunner.job && jobRunner.job.label) || (running[0] && running[0].label) || ''),
            h('span', { className: 'fw-spacer' }),
            h('button', { className: 'fw-btn fw-btn-sm', onClick: () => setTab('jobs') }, '看日志'))) : null,

        // 智能体 dock
        h(AgentDock, { props, agent: (text, mode) => agent(props, text, mode), onDraft: (text) => fillDraft(props, text), snap, pipeline, active, onToast, onError }),

        wizard ? h(NewSongWizard, {
          ctx, onClose: () => setWizard(false), onError,
          onCreated: (s) => { setSong(s.root); onToast(`已建立：${s.root}`); refresh() },
        }) : null)
    }

    function AgentDock({ props, agent, onDraft, snap, pipeline, active, onToast, onError }) {
      const [text, setText] = useState('')
      const [sending, setSending] = useState(false)
      const [mode, setMode] = useState('queue')
      const running = !!(snap.jobs && snap.jobs.running && snap.jobs.running.length)
      const cur = (pipeline?.stages || []).find((s) => s.status === 'current') || (pipeline?.stages || [])[0]
      const send = async () => {
        const body = text.trim()
        if (!body) return
        if (mode === 'draft') {
          const r = onDraft(body)
          if (r.ok) { setText(''); onToast('已填入输入框，自己改完再发') } else onError(r.error || '填不进去')
          return
        }
        setSending(true)
        const r = await agent(`【工作台】${body}`, running && mode === 'steer' ? 'steer' : 'queue')
        setSending(false)
        if (r.ok) { setText(''); onToast('已发送到当前会话') } else onError(r.error || '发送失败')
      }
      return h('div', { className: 'fw-dock' },
        h('div', { className: 'fw-dock-row', style: { flexWrap: 'wrap', marginBottom: 4 } },
          cur ? h('button', { className: 'fw-btn fw-btn-sm', onClick: () => { setText(cur.prompt || cur.goal); } }, '⌁ 下一步的提示词') : null,
          cur ? h('button', { className: 'fw-btn fw-btn-sm', onClick: () => { setText(`请解释「阶段 ${cur.n} · ${cur.title}」现在卡在哪、下一步该做什么，不要动手，先给结论。`) } }, '⌁ 解释这一步') : null,
          h('button', { className: 'fw-btn fw-btn-sm', onClick: () => { setText('请读 _进度/进度.md 与 翻填项目.json，告诉我当前断点、还缺什么、下一个不花钱的动作是什么。') } }, '⌁ 我在哪一步'),
          h('span', { className: 'fw-spacer' }),
          h('select', { className: 'fw-input-sm', value: mode, onChange: (e) => setMode(e.target.value) },
            h('option', { value: 'queue' }, '发送（排队）'),
            h('option', { value: 'steer' }, '打断并插入'),
            h('option', { value: 'draft' }, '只填进输入框'))),
        h('div', { className: 'fw-dock-row' },
          h('input', {
            className: 'fw-input', value: text, placeholder: '和当前会话的智能体说话…（例：帮我跑阶段 3 的分镜，先给预览）',
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } },
          }),
          h('button', { className: 'fw-btn fw-btn-primary', onClick: () => void send(), disabled: sending }, sending ? '…' : '发送')))
    }

    return {
      name: 'fantian-workbench-client',
      // sessions/layout 用于派单与全屏；拿不到就降级（每个调用点都 try/catch）。
      inject: ['slots', 'sidebarRightTabs', 'sessions', 'layout'],
      apply(ctx) {
        ctx.effect(applyStyles, 'fantian-workbench: styles')
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: () => TITLE,
          guide: [{ order: 70, title: () => TITLE, description: () => '引导式流水线：按阶段交素材、跑预览、派单给智能体。' }],
        }), 'fantian-workbench: sidebar tab type')
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, function PanelWithCtx(props) {
          return h(WorkbenchPanel, { ...props, __ctx: ctx })
        }))
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'fantian-workbench-entry',
          order: 60,
        }, function Entry() {
          return h('button', {
            type: 'button', className: 'fw-btn', title: TITLE,
            onClick: () => {
              try {
                const face = ctx.get('sidebarRight')
                if (face && typeof face.openTab === 'function') { face.openTab(TAB_KIND); return }
              } catch { /* 服务不在就退化为无动作 */ }
            },
          }, '工作台')
        }))
      },
    }
  },
})
