/**
 * 翻填工作台 · Client 半边
 *
 * 一个只读面板：把 Host 半边 `/fantian-workbench/v1/snapshot` 的快照渲染成
 * 「状态条 + 异常优先区 + Tab（歌词/素材/清单/出片/账本）+ 选项抽屉」。
 *
 * 设计原则（照计划 §7.1）：
 *   1. 异常优先——默认只亮出"需要你注意的"，正常项收进折叠区。
 *   2. 角色驱动——素材按"在流水线里扮演什么角色"分组，不按扩展名堆列表。
 *   3. 只读优先——本版不写回任何文件。
 *   4. 样式只用主题 token（`--dsw-*`）——亮/暗主题都自动正确，且不 import 任何
 *      Harness Client 包（技能硬要求）。
 */
window.__ModuleLoader__.load({
  // ⚠️ 这个 id 必须**逐字等于** package.json 的 `name`。
  // boot 检查是："这一批里每个条目，自己的模块注册 id 是否等于它的包名"
  // （见 client-modules 的 boot 校验），不匹配就整批失败并白屏。
  id: 'dsh-fantian-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    const TAB_ID = 'fantian-workbench'
    const TAB_KIND = 'fantian-workbench'
    const TITLE = '翻填工作台'
    const LOCALE_NS = 'fantianWorkbench'
    /**
     * 快照路由。
     * Host 半边用 `webServer.register({kind:'prefix', path:'/fantian-workbench/v1'})` 挂载，
     * 那是**进程级绝对路径**，与工作区无关——所以这里固定一个同源根路径就够了。
     * （探测期的第二条编码兜底已删除：它是本机工作区名编出来的死码，换机器必然打不中。）
     */
    const API_CANDIDATES = ['/fantian-workbench/v1/snapshot']
    /** 自动刷新间隔：面板是监控面，不必太勤。 */
    const POLL_MS = 10000

    const DICT = {
      zh: {
        'tab.title': '翻填工作台',
        'tab.guide': '查看这首歌的歌词对照、素材齐缺、流水线进度与花费台账。',
        'state.loading': '读取中…',
        'state.error': '读取失败',
        'state.retry': '重试',
        'state.refresh': '刷新',
        'state.empty': '暂无数据',
        'attention.title': '需要你注意',
        'attention.none': '没有需要你注意的项',
        'tab.lyrics': '歌词',
        'tab.materials': '素材',
        'tab.pipeline': '清单',
        'tab.shoot': '出片',
        'tab.ledger': '账本',
        'options.title': '选项',
        'options.folded': '展开选项抽屉',
      },
      en: {
        'tab.title': 'Fanfill Workbench',
        'tab.guide': 'Lyric alignment, material readiness, pipeline progress and spend ledger.',
        'state.loading': 'Loading…',
        'state.error': 'Load failed',
        'state.retry': 'Retry',
        'state.refresh': 'Refresh',
        'state.empty': 'No data',
        'attention.title': 'Needs your attention',
        'attention.none': 'Nothing needs your attention',
        'tab.lyrics': 'Lyrics',
        'tab.materials': 'Assets',
        'tab.pipeline': 'Pipeline',
        'tab.shoot': 'Shots',
        'tab.ledger': 'Ledger',
        'options.title': 'Options',
        'options.folded': 'Show options',
      },
    }

    // ── 样式：只用主题 token，亮/暗自动跟随 ─────────────────────────────────
    const CSS = `
.fw-root{display:flex;flex-direction:column;height:100%;min-height:0;
  font-family:var(--dsw-font-family);font-size:var(--dsw-font-s-14-font-size,13px);
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);}
.fw-head{display:flex;align-items:center;gap:8px;padding:10px 12px;
  border-bottom:1px solid var(--dsw-alias-separator-primary);flex:none;flex-wrap:wrap;}
.fw-title{font-weight:600;font-size:var(--dsw-font-base-strong-16-font-size,14px);}
.fw-song{color:var(--dsw-alias-label-secondary);}
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
  padding:2px 9px;cursor:pointer;font:inherit;line-height:1.6;}
.fw-btn:hover{background:var(--dsw-alias-button-tool-bar-hover);}
.fw-btn-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-link);padding:2px 5px;}
.fw-btn-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);}
.fw-scroll{overflow:auto;min-height:0;flex:1 1 auto;padding:10px 12px 16px;}
.fw-sec{margin-bottom:14px;}
.fw-sec-head{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;
  padding:3px 0;color:var(--dsw-alias-label-primary);font-weight:600;}
.fw-sec-head:hover{color:var(--dsw-alias-link);}
.fw-caret{width:10px;display:inline-block;color:var(--dsw-alias-label-tertiary);}
.fw-count{color:var(--dsw-alias-label-tertiary);font-weight:400;}
.fw-alert{display:flex;gap:7px;align-items:flex-start;padding:6px 9px;margin-bottom:6px;
  border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);
  border-left:3px solid var(--dsw-alias-border-l2);line-height:1.55;}
.fw-alert-warn{border-left-color:var(--dsw-alias-state-warn-primary);}
.fw-alert-error{border-left-color:var(--dsw-alias-state-error-primary);}
.fw-alert-info{border-left-color:var(--dsw-alias-state-business-primary);}
.fw-alert-ok{border-left-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-secondary);}
.fw-tabs{display:flex;gap:2px;padding:0 8px;border-bottom:1px solid var(--dsw-alias-separator-primary);flex:none;overflow-x:auto;}
.fw-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;
  padding:7px 9px;font:inherit;border-bottom:2px solid transparent;white-space:nowrap;}
.fw-tab:hover{color:var(--dsw-alias-label-primary);}
.fw-tab-on{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600;}
.fw-row{display:flex;gap:8px;align-items:baseline;padding:4px 0;
  border-bottom:1px solid var(--dsw-alias-separator-primary);}
.fw-row:last-child{border-bottom:none;}
.fw-mono{font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);
  font-size:var(--dsw-font-xxs-12-font-size,12px);}
.fw-dim{color:var(--dsw-alias-label-tertiary);}
.fw-2{color:var(--dsw-alias-label-secondary);}
.fw-num{color:var(--dsw-alias-label-tertiary);min-width:26px;text-align:right;
  font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);
  font-size:var(--dsw-font-xxs-12-font-size,12px);}
.fw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px;}
.fw-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);
  border-radius:var(--dsw-radius-md,8px);padding:7px 9px;line-height:1.5;min-width:0;}
.fw-card-t{display:flex;align-items:center;gap:6px;font-weight:600;}
.fw-card-p{color:var(--dsw-alias-label-tertiary);word-break:break-all;
  font-size:var(--dsw-font-xxxs-11-font-size,11px);margin-top:2px;}
.fw-bar{height:5px;border-radius:3px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;margin-top:5px;}
.fw-bar>i{display:block;height:100%;background:var(--dsw-alias-state-success-primary);}
.fw-bar.warn>i{background:var(--dsw-alias-state-warn-primary);}
.fw-bar.err>i{background:var(--dsw-alias-state-error-primary);}
.fw-ly{display:grid;grid-template-columns:34px 62px 1fr;gap:6px;align-items:baseline;
  padding:4px 2px;border-bottom:1px solid var(--dsw-alias-separator-primary);}
.fw-ly-over{background:var(--dsw-alias-bg-mask-1);}
.fw-ly-text{min-width:0;word-break:break-word;}
.fw-tbl{width:100%;border-collapse:collapse;font-size:var(--dsw-font-xxs-12-font-size,12px);}
.fw-tbl th{text-align:left;color:var(--dsw-alias-label-tertiary);font-weight:500;
  padding:3px 5px;border-bottom:1px solid var(--dsw-alias-separator-primary);white-space:nowrap;}
.fw-tbl td{padding:3px 5px;border-bottom:1px solid var(--dsw-alias-separator-primary);vertical-align:top;}
.fw-tbl tr:last-child td{border-bottom:none;}
.fw-foot{flex:none;border-top:1px solid var(--dsw-alias-separator-primary);background:var(--dsw-alias-bg-layer-1);}
.fw-foot-h{display:flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;user-select:none;
  color:var(--dsw-alias-label-secondary);}
.fw-foot-h:hover{color:var(--dsw-alias-label-primary);}
.fw-foot-b{padding:2px 12px 10px;}
.fw-opt{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--dsw-alias-separator-primary);}
.fw-opt:last-child{border-bottom:none;}
.fw-opt-k{min-width:76px;color:var(--dsw-alias-label-tertiary);}
.fw-opt-v{min-width:0;word-break:break-word;}
.fw-pre{margin:0;padding:8px;background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-sm,6px);
  font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);
  font-size:var(--dsw-font-xxxs-11-font-size,11px);white-space:pre-wrap;word-break:break-word;
  max-height:340px;overflow:auto;color:var(--dsw-alias-label-primary);}
.fw-md h1,.fw-md h2,.fw-md h3{font-size:var(--dsw-font-s-strong-14-font-size,13px);margin:12px 0 5px;}
.fw-md ul{padding-left:18px;margin:4px 0;}
.fw-md p{margin:5px 0;}
.fw-md code{background:var(--dsw-alias-markdown-inline-code);padding:0 3px;border-radius:3px;
  font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);}
`

    // ── 小工具 ─────────────────────────────────────────────────────────────
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
      const sec = s - m * 60
      return `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`
    }
    const fmtCny = (n) => (typeof n === 'number' && isFinite(n) ? `¥${n.toFixed(2)}` : '—')
    const fmtDelta = (n) => (typeof n !== 'number' ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}s`)

    /** 一个可折叠区块。默认折叠状态由 `defaultOpen` 决定。 */
    function Section({ title, count, defaultOpen = true, children }) {
      const [open, setOpen] = useState(defaultOpen)
      return h('div', { className: 'fw-sec' },
        h('div', { className: 'fw-sec-head', onClick: () => setOpen(!open), role: 'button', tabIndex: 0,
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } } },
          h('span', { className: 'fw-caret' }, open ? '▾' : '▸'),
          h('span', null, title),
          typeof count === 'number' ? h('span', { className: 'fw-count' }, `（${count}）`) : null),
        open ? h('div', null, children) : null)
    }

    function Alert({ level, text }) {
      return h('div', { className: `fw-alert fw-alert-${level}` },
        h('span', null, level === 'error' ? '⛔' : level === 'warn' ? '⚠' : level === 'ok' ? '✅' : 'ℹ'),
        h('span', { style: { minWidth: 0 } }, text))
    }

    // ── 数据获取 ───────────────────────────────────────────────────────────
    function useSnapshot(pollMs) {
      const [state, setState] = useState({ status: 'loading', data: null, error: null, endpoint: null })
      const alive = useRef(true)
      const load = useCallback(async () => {
        for (const url of API_CANDIDATES) {
          try {
            const r = await fetch(url, { headers: { accept: 'application/json' } })
            if (!r.ok) continue
            const data = await r.json()
            if (!alive.current) return
            setState({ status: 'ready', data, error: data.ok === false ? (data.error ?? 'snapshot not ok') : null, endpoint: url })
            return
          } catch { /* 换下一个候选 */ }
        }
        if (!alive.current) return
        setState((s) => ({ ...s, status: s.data ? 'ready' : 'error', error: s.error ?? '无法连接工作台快照路由' }))
      }, [])
      useEffect(() => {
        alive.current = true
        void load()
        const t = setInterval(() => { void load() }, pollMs)
        return () => { alive.current = false; clearInterval(t) }
      }, [load, pollMs])
      return [state, load]
    }

    // ── 头部状态条 ─────────────────────────────────────────────────────────
    function StatusBar({ snap, onRefresh, busy }) {
      const song = snap.song || {}
      const seg = snap.segments || {}
      const ledger = snap.ledger || {}
      const stage = (snap.progress && snap.progress.header && snap.progress.header.stage) || null
      const spent = ledger.total > 0 ? ledger.total : ((snap.config.budget || {}).spentCny ?? 0)
      const budget = ledger.budget ?? (snap.config.budget || {}).totalCny ?? null
      const done = seg.done ?? 0
      const total = seg.total ?? 0
      const chips = []
      if (stage) chips.push(h('span', { className: 'fw-chip', key: 'stage' }, stage))
      if (total > 0) chips.push(h('span', { className: `fw-chip ${done >= total ? 'fw-chip-ok' : 'fw-chip-info'}`, key: 'seg' },
        `出片 ${done}/${total}`))
      if (budget) chips.push(h('span', { className: 'fw-chip', key: 'money' }, `${fmtCny(spent)} / ${fmtCny(budget)}`))
      return h('div', { className: 'fw-head' },
        h('span', { className: 'fw-title' }, song.name || '翻填工作台'),
        song.source ? h('span', { className: 'fw-song fw-dim' }, song.source) : null,
        h('span', { className: 'fw-spacer' }),
        ...chips,
        h('button', { className: 'fw-btn fw-btn-ghost', onClick: onRefresh, title: '重新读取（不动文件）', disabled: busy },
          busy ? '…' : '⟳'))
    }

    // ── Tab：歌词 ──────────────────────────────────────────────────────────
    function LyricsTab({ snap }) {
      const lyrics = snap.lyrics || []
      const min = (snap.config.video.subtitle && snap.config.video.subtitle.minDisplaySec) || 3
      if (!lyrics.length) return h(Alert, { level: 'info', text: '还没有歌词对齐数据——先跑 scripts/80_pv_shotlist.mjs 生成 plan/segments.json。' })
      const over = lyrics.filter((l) => l.flag === 'over')
      const near = lyrics.filter((l) => l.flag === 'near')
      const short = lyrics.filter((l) => l.shortDisplay)
      const okCount = lyrics.length - over.length - near.length
      return h('div', null,
        h('div', { className: 'fw-row', style: { gap: 10, flexWrap: 'wrap' } },
          h('span', { className: 'fw-chip fw-chip-ok' }, `≤0.25s：${okCount}`),
          h('span', { className: 'fw-chip fw-chip-warn' }, `0.25–0.40s：${near.length}`),
          h('span', { className: 'fw-chip fw-chip-err' }, `>0.40s：${over.length}`),
          h('span', { className: 'fw-chip' }, `共 ${lyrics.length} 句`)),
        over.length ? h(Section, { title: '超阈值句（建议回头修 LRC）', count: over.length, defaultOpen: true },
          over.map((l) => h('div', { className: 'fw-ly fw-ly-over', key: l.n },
            h('span', { className: 'fw-num' }, l.n),
            h('span', { className: 'fw-mono fw-chip fw-chip-err' }, fmtDelta(l.dev)),
            h('span', { className: 'fw-ly-text' }, l.text)))) : null,
        short.length ? h(Section, { title: `保底时长不足 ${min}s 的句（字幕会顺延）`, count: short.length, defaultOpen: true },
          short.map((l) => h('div', { className: 'fw-ly', key: l.n },
            h('span', { className: 'fw-num' }, l.n),
            h('span', { className: 'fw-mono' }, `${l.displaySec}s`),
            h('span', { className: 'fw-ly-text' }, l.text)))) : null,
        h(Section, { title: '歌词对照：LRC 名义时间 / 实测起音 / 偏差', count: lyrics.length, defaultOpen: true },
          h('div', { className: 'fw-row fw-dim fw-mono', style: { paddingBottom: 2 } },
            h('span', { className: 'fw-num' }, '#'),
            h('span', { style: { minWidth: 62 } }, 'LRC'),
            h('span', { style: { minWidth: 62 } }, '实测'),
            h('span', { style: { minWidth: 56 } }, 'Δ'),
            h('span', null, '歌词')),
          lyrics.map((l) => h('div', { className: `fw-ly ${l.flag === 'over' ? 'fw-ly-over' : ''}`, key: l.n },
            h('span', { className: 'fw-num' }, l.n),
            h('span', { className: 'fw-mono fw-2' }, fmtTc(l.lrc)),
            h('span', { className: 'fw-mono' }, fmtTc(l.onset)),
            h('span', { className: `fw-mono fw-chip ${l.flag === 'over' ? 'fw-chip-err' : l.flag === 'near' ? 'fw-chip-warn' : 'fw-chip-ok'}` }, fmtDelta(l.dev)),
            h('span', { className: 'fw-ly-text' }, l.text)))))
    }

    // ── Tab：素材 ──────────────────────────────────────────────────────────
    function MaterialsTab({ snap }) {
      const mats = snap.materials || []
      const last = (n) => (typeof n === 'number' ? n.toFixed(2) : '—')
      const ds = snap.dirStats || {}
      const chips = (s) => Object.entries(s.byExt || {}).filter(([k]) => k !== '(none)')
        .map(([k, v]) => `${k}×${v.count}`).join(' · ')
      const dirCards = [
        ['参考图 refs', ds.refs], ['每段 prompt', ds.prompts], ['成片 clips', ds.clips],
        ['字幕 subs', ds.subs], ['封面 cover', ds.cover], ['核验 verify', ds.verify], ['归档 history', ds.history],
      ].filter(([, v]) => v)
      return h('div', null,
        h(Section, { title: '按流水线角色', count: mats.length, defaultOpen: true },
          h('div', { className: 'fw-grid' }, mats.map((m) => h('div', { className: 'fw-card', key: m.key },
            h('div', { className: 'fw-card-t' },
              h('span', null, m.exists ? '✅' : '⛔'),
              h('span', null, m.role),
              h('span', { className: 'fw-dim', style: { marginLeft: 'auto', fontWeight: 400 } },
                m.exists ? fmtBytes(m.bytes) : '缺')),
            h('div', { className: 'fw-card-p' }, m.path || '—'),
            h('div', { className: 'fw-dim', style: { fontSize: 11, marginTop: 2 } }, m.hint))))),
        h(Section, { title: '产物目录规模', count: dirCards.length, defaultOpen: true },
          h('div', { className: 'fw-grid' }, dirCards.map(([label, s]) => h('div', { className: 'fw-card', key: label },
            h('div', { className: 'fw-card-t' },
              h('span', null, label),
              h('span', { className: 'fw-dim', style: { marginLeft: 'auto', fontWeight: 400 } },
                `${s.files} 个 · ${fmtBytes(s.bytes)}`)),
            h('div', { className: 'fw-card-p' }, chips(s) || '—'))))))
    }

    // ── Tab：清单 ──────────────────────────────────────────────────────────
    function PipelineTab({ snap }) {
      const stages = (snap.progress && snap.progress.stages) || []
      const seg = snap.segments || {}
      const done = seg.done ?? 0
      const total = seg.total ?? 0
      const pps = snap.config.video.pricePerSecond
      const remainSec = (seg.list || []).filter((s) => !s.hasClip).reduce((a, s) => a + (s.genDur || 0), 0)
      const remainCny = pps ? remainSec * pps : null
      const md = snap.progress && snap.progress.markdown
      return h('div', null,
        total > 0 ? h(Section, { title: '当前推进', defaultOpen: true },
          h('div', { className: 'fw-card' },
            h('div', { className: 'fw-card-t' }, h('span', null, `出片 ${done}/${total}`),
              remainSec > 0 ? h('span', { className: 'fw-dim', style: { marginLeft: 'auto', fontWeight: 400 } },
                `剩余约 ${remainSec}s${remainCny !== null ? ` · 预估 ${fmtCny(remainCny)}` : ''}`) : null),
            h('div', { className: `fw-bar ${done >= total ? '' : 'warn'}` },
              h('i', { style: { width: `${total ? (done / total) * 100 : 0}%` } })))) : null,
        stages.length
          ? h(Section, { title: '阶段总表（来自 _进度/进度.md）', count: stages.length, defaultOpen: true },
            h('table', { className: 'fw-tbl' },
              h('thead', null, h('tr', null,
                h('th', null, '#'), h('th', null, '阶段'), h('th', null, '状态'),
                h('th', null, '产物'), h('th', null, '验收'), h('th', null, '花费'))),
              h('tbody', null, stages.map((s, i) => h('tr', { key: i },
                h('td', { className: 'fw-mono' }, s.idx),
                h('td', null, s.stage),
                h('td', null, s.status),
                h('td', { className: 'fw-mono fw-dim' }, s.artifact),
                h('td', { className: 'fw-2' }, s.acceptance),
                h('td', { className: 'fw-mono' }, s.cost))))))
          : h(Alert, { level: 'info', text: '还没有 _进度/进度.md，或它里面没有「阶段总表」。' }),
        md ? h(Section, { title: '进度.md 原文', defaultOpen: false },
          h('pre', { className: 'fw-pre' }, md)) : null)
    }

    // ── Tab：出片台 ────────────────────────────────────────────────────────
    function ShootTab({ snap }) {
      const seg = snap.segments || {}
      const list = seg.list || []
      const pps = snap.config.video.pricePerSecond
      const clips = snap.clips || []
      const clipBytes = clips.reduce((a, c) => a + (c.bytes || 0), 0)
      if (!list.length) return h(Alert, { level: 'info', text: '还没有分镜表——跑 scripts/80_pv_shotlist.mjs 生成。' })

      const head = h('thead', null, h('tr', null,
        h('th', null, '#'), h('th', null, '段名'), h('th', null, '区间'),
        h('th', null, '生成'), h('th', null, '模式'), h('th', null, '素材'),
        h('th', null, '成本'), h('th', null, '状态')))

      const body = h('tbody', null, list.map((s) => {
        const mats = s.mat ? (s.mat2 ? `${s.mat} + ${s.mat2}` : s.mat) : '—'
        const status = s.hasClip
          ? h('span', { className: 'fw-chip fw-chip-ok' }, '✅')
          : h('span', { className: 'fw-chip fw-chip-info' }, '待出')
        return h('tr', { key: s.idx },
          h('td', { className: 'fw-mono' }, s.idx),
          h('td', null, s.slug),
          h('td', { className: 'fw-mono' }, `${fmtTc(s.start)}–${fmtTc(s.end)}`),
          h('td', { className: 'fw-mono' }, `${s.genDur}s`),
          h('td', null, h('span', { className: 'fw-chip', style: { fontSize: 11 } }, s.mode)),
          h('td', { className: 'fw-mono fw-dim' }, mats),
          h('td', { className: 'fw-mono' }, pps ? fmtCny((s.genDur || 0) * pps) : '—'),
          h('td', null, status))
      }))

      const summaryCard = (label, value) => h('div', { className: 'fw-card', key: label },
        h('div', { className: 'fw-card-t' }, label),
        h('div', null, value))

      const summary = h('div', { className: 'fw-grid' },
        summaryCard('段数', `${seg.done}/${seg.total}`),
        summaryCard('生成秒数', `${seg.generatedSeconds ?? '—'}s`),
        summaryCard('名义预估', fmtCny(seg.estimatedCny)),
        summaryCard('成片体积', fmtBytes(clipBytes)))

      return h('div', null,
        h(Section, { title: '分镜表', count: list.length, defaultOpen: true },
          h('table', { className: 'fw-tbl' }, head, body)),
        h(Section, { title: '汇总', defaultOpen: true }, summary))
    }

    // ── Tab：账本 ──────────────────────────────────────────────────────────
    function LedgerTab({ snap }) {
      const ledger = snap.ledger || { rows: [], total: 0, budget: null }
      const rows = ledger.rows || []
      const budget = ledger.budget
      const pct = budget ? Math.min(100, Math.round((ledger.total / budget) * 100)) : null
      const warnLvl = pct === null ? '' : pct >= 90 ? 'err' : pct >= 70 ? 'warn' : ''
      const d = snap.config.video.deliverables || {}
      const dl = [
        ['PV（基准）', d.pv], ['PV（交付高分辨率）', d.pv1080p], ['封面', d.cover], ['投稿文案', d.copy],
      ].filter(([, p]) => p)
      const ds = (snap.dirStats && snap.dirStats.history) || null
      return h('div', null,
        h(Section, { title: '预算执行', defaultOpen: true },
          h('div', { className: 'fw-card' },
            h('div', { className: 'fw-card-t' }, h('span', null, fmtCny(ledger.total)),
              budget ? h('span', { className: 'fw-dim', style: { marginLeft: 'auto', fontWeight: 400 } }, `/ ${fmtCny(budget)}（${pct}%）`) : null),
            budget ? h('div', { className: `fw-bar ${warnLvl}` }, h('i', { style: { width: `${pct}%` } })) : null,
            h('div', { className: 'fw-card-p' }, snap.config.budget && snap.config.budget.authorizationNote
              ? snap.config.budget.authorizationNote : '未记录授权说明'))),
        rows.length
          ? h(Section, { title: '逐笔花费', count: rows.length, defaultOpen: true },
            h('table', { className: 'fw-tbl' },
              h('thead', null, h('tr', null,
                h('th', null, '时间'), h('th', null, '阶段'), h('th', null, '项目'),
                h('th', null, '金额'), h('th', null, '累计'))),
              h('tbody', null, rows.map((r, i) => h('tr', { key: i },
                h('td', { className: 'fw-mono fw-dim' }, r.time),
                h('td', null, r.stage),
                h('td', null, r.item),
                h('td', { className: 'fw-mono' }, fmtCny(r.amount)),
                h('td', { className: 'fw-mono fw-2' }, r.cumulative !== null && r.cumulative !== undefined ? fmtCny(r.cumulative) : '—'))))))
          : h(Alert, { level: 'info', text: '_进度/成本台账.csv 还没有数据行。' }),
        dl.length ? h(Section, { title: '成品索引', defaultOpen: true },
          dl.map(([label, p]) => {
            const found = /^([a-z0-9]+):/i.test(p || '') ? null : p
            return h('div', { className: 'fw-row', key: label },
              h('span', { style: { minWidth: 108 } }, label),
              h('span', { className: 'fw-mono fw-dim', style: { minWidth: 0, wordBreak: 'break-all' } }, found || '—'))
          })) : null,
        ds && ds.files ? h(Section, { title: '版本归档', defaultOpen: false },
          h('div', { className: 'fw-row' },
            h('span', { className: 'fw-mono fw-dim' }, `${snap.config.video.dir}/history · ${ds.files} 个文件 · ${fmtBytes(ds.bytes)}`))) : null)
    }

    // ── 选项抽屉 ───────────────────────────────────────────────────────────
    function OptionsDrawer({ snap }) {
      const [open, setOpen] = useState(false)
      const v = snap.config.video || {}
      const a = snap.config.audio || {}
      const sub = v.subtitle || {}
      const up = (v.deliverRes && v.deliverRes[0]) || null
      const rows = [
        ['分离路线', `${a.separation || '—'}${a.separationModel ? `（模型 ${a.separationModel}）` : ''}`],
        ['音色', `${(a.voice && a.voice.target) || '—'} · ${(a.voice && a.voice.engine) || '—'}`],
        ['响度', a.loudness ? `${a.loudness.iLufs} LUFS / TP ${a.loudness.truePeakDbtp} dBTP` : '—'],
        ['画幅', `${v.aspect || '—'} · 基准 ${v.baseRes || '—'}${v.baseSize ? `（${v.baseSize[0]}×${v.baseSize[1]}）` : ''}`],
        ['出片模型', `${v.model || '—'}${v.pricePerSecond ? ` · ¥${v.pricePerSecond}/秒` : ''}`],
        ['交付分辨率', up ? `${up.name} ${up.size ? `${up.size[0]}×${up.size[1]}` : ''} · ${up.method}` : '—'],
        ['转场', `${v.transition || '—'}${v.transitionDurSec ? ` ${v.transitionDurSec}s` : ''}`],
        ['字幕', `${sub.font || '—'} ${sub.size || ''} · 保底 ${sub.minDisplaySec || '—'}s · ${sub.lineLevel ? '行级' : '整段'} · ${sub.followMeasuredOnset ? '跟随实测收声' : '跟随 LRC'}`],
        ['分镜上限', v.segMaxSec ? `单段 ≤ ${v.segMaxSec}s` : '—'],
        ['prompt 上限', `${v.maxPromptChars || 7000} 字符`],
      ]
      return h('div', { className: 'fw-foot' },
        h('div', { className: 'fw-foot-h', onClick: () => setOpen(!open), role: 'button', tabIndex: 0,
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } } },
          h('span', { className: 'fw-caret' }, open ? '▾' : '▸'),
          h('span', null, '选项（当前值 · 来自 翻填项目.json）')),
        open ? h('div', { className: 'fw-foot-b' },
          rows.map(([k, val]) => h('div', { className: 'fw-opt', key: k },
            h('span', { className: 'fw-opt-k' }, k),
            h('span', { className: 'fw-opt-v' }, val)))) : null)
    }

    // ── 面板主体 ───────────────────────────────────────────────────────────
    function WorkbenchPanel() {
      const [snapState, reload] = useSnapshot(POLL_MS)
      const [tab, setTab] = useState('lyrics')
      const [busy, setBusy] = useState(false)
      const snap = snapState.data

      const onRefresh = useCallback(() => {
        setBusy(true)
        Promise.resolve(reload()).finally(() => setBusy(false))
      }, [reload])

      if (!snap) {
        return h('div', { className: 'fw-root' },
          h('div', { className: 'fw-head' }, h('span', { className: 'fw-title' }, TITLE),
            h('span', { className: 'fw-spacer' }),
            h('button', { className: 'fw-btn fw-btn-ghost', onClick: onRefresh }, '⟳')),
          h('div', { className: 'fw-scroll' },
            snapState.status === 'error'
              ? h(Alert, { level: 'error', text: `读取失败：${snapState.error ?? '未知错误'}` })
              : h(Alert, { level: 'info', text: '读取中…' })))
      }

      const warnings = snap.warnings || []
      const tabs = [
        ['lyrics', DICT.zh['tab.lyrics'], LyricsTab],
        ['materials', DICT.zh['tab.materials'], MaterialsTab],
        ['pipeline', DICT.zh['tab.pipeline'], PipelineTab],
        ['shoot', DICT.zh['tab.shoot'], ShootTab],
        ['ledger', DICT.zh['tab.ledger'], LedgerTab],
      ]
      const Active = (tabs.find(([k]) => k === tab) || tabs[0])[2]
      const real = warnings.filter((w) => w.level !== 'info')
      const infos = warnings.filter((w) => w.level === 'info')

      return h('div', { className: 'fw-root' },
        h(StatusBar, { snap, onRefresh, busy }),
        h('div', { className: 'fw-tabs' }, tabs.map(([k, label]) => h('button', {
          key: k, className: `fw-tab ${k === tab ? 'fw-tab-on' : ''}`, onClick: () => setTab(k),
        }, label))),
        h('div', { className: 'fw-scroll' },
          h('div', { className: 'fw-sec' },
            h('div', { className: 'fw-sec-head' }, h('span', { className: 'fw-caret' }, '⚠'),
              h('span', null, '需要你注意'),
              h('span', { className: 'fw-count' }, `（${real.length}）`)),
            real.length ? real.map((w, i) => h(Alert, { key: i, level: w.level, text: w.text }))
              : h(Alert, { level: 'ok', text: '没有阻塞项。' }),
            infos.length ? infos.map((w, i) => h(Alert, { key: `i${i}`, level: 'info', text: w.text })) : null),
          h(Active, { snap })),
        h(OptionsDrawer, { snap }))
    }

    // 非组件化的样式注入：卸载时随 ctx.effect 回收。
    function applyStyles() {
      const el = document.createElement('style')
      el.id = 'fantian-workbench-styles'
      el.textContent = CSS
      document.head.appendChild(el)
      return () => { el.remove() }
    }

    return {
      name: 'fantian-workbench-client',
      // 右侧栏 tab 注册需要 sidebarRightTabs；slots 是面板本体。
      // 两者都写成硬依赖：本 profile 一定装了 ui-sidebar-right（已核实）。
      inject: ['slots', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(applyStyles, 'fantian-workbench: styles')

        // 1) 注册一个右侧栏 tab 类型（id 与 kind 同名，最简形）
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: () => TITLE,
          guide: [{ order: 70, title: () => TITLE, description: () => DICT.zh['tab.guide'] }],
        }), 'fantian-workbench: sidebar tab type')

        // 2) 面板主体：keyed by 类型 id
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, WorkbenchPanel))

        // 3) 顺带在会话头部工具条放一个入口按钮，便于随时打开
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'fantian-workbench-entry',
          order: 60,
        }, function Entry() {
          const open = () => {
            try {
              const face = ctx.get('sidebarRight')
              if (face && typeof face.openTab === 'function') { face.openTab(TAB_KIND); return }
            } catch { /* 服务不在就退化为无动作 */ }
          }
          return h('button', { type: 'button', className: 'fw-btn', onClick: open, title: TITLE }, '工作台')
        }))
      },
    }
  },
})
