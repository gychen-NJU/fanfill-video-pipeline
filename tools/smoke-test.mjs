/**
 * smoke-test.mjs —— 翻填工作台 Host 半边的自检
 * ---------------------------------------------------------------------------
 * 不需要你准备任何素材：在系统临时目录里**现造一个最小工作区**（配置 + 一个 3 段的
 * 分镜表 + 占位文件 + 一行台账），然后独立跑一遍插件的只读快照路由，确认：
 *   · 路由注册成功
 *   · 快照返回 200 且结构完整、不炸
 *   · 异常优先区真的从数据里挑出了该注意的项（故意放了一句偏差 0.55s 的歌词）
 *   · 未知端点返回 404 而不是崩
 *
 * 想拿**真实工作区**体检：设 FANFILL_WORKSPACE=<工作区绝对路径> 再跑。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

/** 现造一个最小工作区。 */
function makeSyntheticWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fanfill-smoke-'))
  for (const d of ['01_input', '02_stems', '05_vocals', '07_mix', '10_video/plan',
    '10_video/prompts', '10_video/refs', '10_video/clips', '10_video/subs',
    '10_video/cover', '10_video/verify', '_进度']) {
    fs.mkdirSync(path.join(ws, d), { recursive: true })
  }
  // 用仓库 examples/ 里那份真实配置当模板，只把路径指到本临时工作区
  const tpl = JSON.parse(fs.readFileSync(path.join(REPO, 'examples/project-config.json'), 'utf8'))
  tpl.audio.aceVocal = '05_vocals/vocal.wav'
  tpl.audio.master = '07_mix/master.wav'
  tpl.audio.instrumental = '02_stems/inst.wav'
  tpl.video.dir = '10_video'
  for (const k of ['planDir', 'promptDir', 'refDir', 'clipDir', 'subDir', 'coverDir', 'verifyDir', 'historyDir']) {
    delete tpl.video[k]
  }
  fs.writeFileSync(path.join(ws, '翻填项目.json'), JSON.stringify(tpl, null, 2), 'utf8')

  for (const f of ['05_vocals/vocal.wav', '07_mix/master.wav', '02_stems/inst.wav', '01_input/original.mp3']) {
    fs.writeFileSync(path.join(ws, f), 'placeholder')
  }

  // 3 段分镜；第 2 句故意让偏差 0.55s 超阈值，用来验证"异常优先区"真的在工作
  fs.writeFileSync(path.join(ws, '10_video/plan/segments.json'), JSON.stringify({
    model: tpl.video.model, resolution: tpl.video.baseRes, pricePerSecond: tpl.video.pricePerSecond,
    audio: { file: '07_mix/master.wav', duration: tpl.song.totalSec },
    lrc: {
      credits: [],
      lyrics: [
        { t: 3.0, nominalEnd: 6.0, onset: 3.05, dev: 0.05, onsetLevel: -30, vocalEnd: 6.5, text: 'line one' },
        { t: 6.0, nominalEnd: 9.0, onset: 6.55, dev: 0.55, onsetLevel: -30, vocalEnd: 8.0, text: 'line two (over threshold)' },
        { t: 9.0, nominalEnd: 12.0, onset: 9.02, dev: 0.02, onsetLevel: -30, vocalEnd: 12.4, text: 'line three' },
      ],
    },
    segments: [
      { idx: 1, slug: 'a', start: 0, end: 6, dur: 6, genDur: 6, mode: 'I2VA', mat: '', mat2: '', trans: 'cut', refs: [], chainFrom: null, lyrics: ['line one'], lyricTimes: [3] },
      { idx: 2, slug: 'b', start: 6, end: 12, dur: 6, genDur: 6, mode: 'I2VA', mat: '', mat2: '', trans: 'cut', refs: [], chainFrom: null, lyrics: ['line two (over threshold)'], lyricTimes: [6] },
      { idx: 3, slug: 'c', start: 12, end: 18, dur: 6, genDur: 6, mode: 'I2VA', mat: '', mat2: '', trans: 'cut', refs: [], chainFrom: null, lyrics: ['line three'], lyricTimes: [9] },
    ],
    totals: { generatedSeconds: 18, estimatedCny: 9 },
    problems: [],
  }, null, 2), 'utf8')

  fs.writeFileSync(path.join(ws, '10_video/prompts/01_a.txt'), 'x'.repeat(100))
  fs.writeFileSync(path.join(ws, '_进度/成本台账.csv'),
    '时间,阶段,项目,金额CNY,累计CNY,备注\n2026-01-01 00:00,PV出片,试片,9.00,9.00,smoke\n', 'utf8')
  return ws
}

const explicit = process.env.FANFILL_WORKSPACE
const ws = explicit ? path.resolve(explicit) : makeSyntheticWorkspace()
console.log(`workspace: ${ws}${explicit ? ' (user-specified)' : ' (synthetic)'}`)
if (!fs.existsSync(path.join(ws, '翻填项目.json'))) {
  console.error('FAIL: this workspace has no 翻填项目.json — pick another directory or create one first.')
  process.exit(1)
}

const mod = await import(pathToFileURL(path.join(REPO, 'ui-workbench/index.js')).href)
const captured = []
const fakeCtx = {
  webServer: { register(route) { captured.push(route); return () => {} } },
  effect(fn) { const d = fn(); return () => d && d() },
  logger: { info: () => {} },
}
mod.apply(fakeCtx, { workspace: ws })

if (captured.length !== 1) throw new Error('route was not registered')
const route = captured[0]
console.log(`route: ${route.kind} ${route.path}`)

const res = {
  status: null, headers: null, body: '',
  writeHead(s, hd) { this.status = s; this.headers = hd },
  end(b) { this.body = b },
}

await route.handler({ url: '/fantian-workbench/v1/ping' }, res)
if (res.status !== 200) throw new Error(`ping failed: ${res.status}`)
console.log(`ping  -> ${res.status} ${res.body}`)

await route.handler({ url: '/fantian-workbench/v1/snapshot' }, res)
if (res.status !== 200) throw new Error(`snapshot failed: ${res.status}`)
const snap = JSON.parse(res.body)

const checks = []
const check = (name, cond, got) => checks.push({ name, ok: !!cond, got })

check('ok is true', snap.ok === true, snap.ok)
check('song name read', !!snap.song?.name, snap.song?.name)
check('segment count = 3', snap.segments.total === 3, snap.segments.total)
check('shots-done parsed (0 clips yet)', snap.segments.done === 0, snap.segments.done)
check('lyric lines = 3', snap.lyrics.length === 3, snap.lyrics.length)
check('over-threshold line detected (0.55)', snap.lyrics.filter((l) => l.flag === 'over').length === 1,
  JSON.stringify(snap.lyrics.map((l) => l.flag)))
check('ledger parsed (1 row)', snap.ledger.rows.length === 1, snap.ledger.rows.length)
check('ledger total = 9', snap.ledger.total === 9, snap.ledger.total)
check('assets grouped by role, readiness known', snap.materials.length === 6 && snap.materials.some((m) => m.exists),
  `${snap.materials.filter((m) => m.exists).length}/${snap.materials.length} ready`)
check('output dir stats available', typeof snap.dirStats?.prompts?.files === 'number', snap.dirStats?.prompts?.files)
check('prompt char count works', snap.promptChars.length === 1 && snap.promptChars[0].chars === 100,
  JSON.stringify(snap.promptChars))
check('attention zone non-empty', snap.warnings.length > 0, snap.warnings.length)

await route.handler({ url: '/fantian-workbench/v1/nope' }, res)
check('unknown endpoint -> 404', res.status === 404, res.status)

console.log('')
console.log('--- self-check ---')
let failed = 0
for (const c of checks) {
  if (!c.ok) failed++
  console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(36)} ${c.got}`)
}
console.log('')
console.log('--- attention zone (derived from the data) ---')
for (const w of snap.warnings) console.log(`  [${w.level}] ${w.text}`)

console.log('')
if (failed) {
  console.log(`FAILED: ${failed}/${checks.length} checks`)
  process.exit(1)
}
console.log(`OK: all ${checks.length} checks passed`)
if (!explicit) console.log(`\n(temporary workspace kept for inspection: ${ws})`)
