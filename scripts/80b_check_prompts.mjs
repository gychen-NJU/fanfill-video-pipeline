#!/usr/bin/env node
/**
 * 80b_check_prompts.mjs —— PV 提示词合规检查（独立验证，不信任撰写/修补 agent 的自述）
 * ---------------------------------------------------------------------------
 * 逐份检查 `<promptDir>/NN_<slug>.txt` 与 `<promptDir>/ref2va/NN_<slug>.txt`
 * 是否符合 H3 三段式规范与分镜约束。
 *
 * 配置化：目录、风格后缀、生成时长上限、prompt 字符上限全部来自 `翻填项目.json`。
 *
 * 选哪一份来检？与 `82_pv_clips.mjs` 的 `promptPathFor()` **同口径**：
 *   先 `ref2va/NN_<slug>.txt`，存在就用它；否则用 `NN_<slug>.txt`。
 *   （`segments.json.mode` 是创作约定，实跑模式由这个文件是否存在决定。）
 *
 * 用法：
 *   node scripts/80b_check_prompts.mjs --plan   # 只列将检查哪些文件，不读全文
 *   node scripts/80b_check_prompts.mjs          # 实际检查
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, loadSegments, parseArgv, pad2 } from './lib/fanfill-config.mjs'

const { plan: PLAN_ONLY } = parseArgv()
const ROOT = process.cwd()
const cfg = loadConfig(ROOT)
const { segments } = loadSegments(cfg)

const PDIR = cfg.dirs.prompts
const REF2VA_DIR = path.join(PDIR, 'ref2va')
const MAX_CHARS = cfg.delivery.maxPromptChars

// 风格前缀：取配置里的整串（新歌若还没写 promptStyleSuffix，退化为宽松判定）
const STYLE_FULL = cfg.delivery.styleSuffix || ''
/** 只取风格串的**前三个逗号段**做判定——历史上有 17 份 prompt 只带了前 10 项。 */
const styleKey = (s) => s.split(',').slice(0, 3).join(',').trim()

/** 与 82_pv_clips.mjs 同口径的提示词选路。 */
function promptPathFor(s) {
  const base = `${pad2(s.idx)}_${s.slug}.txt`
  const ref2va = path.join(REF2VA_DIR, base)
  if (fs.existsSync(ref2va)) return { file: ref2va, kind: 'ref2va' }
  return { file: path.join(PDIR, base), kind: 'base' }
}

if (PLAN_ONLY) {
  console.log(`配置：${cfg.rel(cfg.configPath)}｜prompt 目录：${cfg.rel(PDIR)}`)
  console.log(`将检查 ${segments.length} 段；实际选用：`)
  for (const s of segments) {
    const p = promptPathFor(s)
    console.log(`  段 ${pad2(s.idx)} ${s.slug.padEnd(16)} mode=${String(s.mode).padEnd(7)} → ${p.kind.padEnd(6)} ${fs.existsSync(p.file) ? '✅' : '❌缺'}`)
  }
  const kinds = segments.reduce((a, s) => { const k = promptPathFor(s).kind; a[k] = (a[k] || 0) + 1; return a }, {})
  console.log('')
  console.log(`合计：${Object.entries(kinds).map(([k, v]) => `${k} ${v} 份`).join('／')}`)
  console.log(`本步骤只读文件、**不发请求、不花钱、不写产物**。`)
  process.exit(0)
}

if (!fs.existsSync(PDIR)) {
  console.error(`❌ prompt 目录不存在：${PDIR}\n   先跑：node scripts/80_pv_shotlist.mjs（会生成骨架）`)
  process.exit(2)
}

const rows = []
const problems = []

for (const s of segments) {
  const p = promptPathFor(s)
  const name = path.relative(PDIR, p.file).replace(/\\/g, '/').replace(/^ref2va\//, '')
  const r = { name, mode: s.mode, kind: p.kind, gen: s.genDur, ok: true, issues: [] }
  if (!fs.existsSync(p.file)) {
    // 只有骨架（`NN_slug.skeleton.txt`，80 的产物）而没有实写的提示词 —— 这是**新歌的正常起点**，
    // 不是"文件缺失"。要报得准确，否则换歌时第一次自检会让人以为少文件。
    const skelBase = path.basename(p.file, '.txt') + '.skeleton.txt'
    const skel = [path.join(PDIR, skelBase), path.join(REF2VA_DIR, skelBase)].find((x) => fs.existsSync(x))
    r.ok = false
    if (skel) {
      r.kind = 'skeleton'
      r.issues.push('只有骨架文件，提示词尚未撰写（用骨架里的要求写出三段式/六段式提示词）')
    } else {
      r.issues.push('文件缺失（连骨架都没有 —— 先跑 80_pv_shotlist.mjs）')
    }
    rows.push(r)
    problems.push({ name, issues: r.issues })
    continue
  }
  const t = fs.readFileSync(p.file, 'utf8')
  const has = (re) => re.test(t)

  // 0. 字符上限（H3 硬顶）+ 骨架占位符未填写
  r.chars = t.length
  if (t.length > MAX_CHARS) r.issues.push(`prompt ${t.length} 字符 > 上限 ${MAX_CHARS}`)
  // 骨架文件（80 的产物）留着 `<待撰写：…>` 占位符；这种文件不能算"通过"，
  // 否则换歌时第一次自检会全绿，而提示词其实一个字都没写。
  const placeholders = [...t.matchAll(/<待撰写[：:][^>]*>/g)].map((m) => m[0])
  if (placeholders.length) {
    r.issues.push(`仍是未填写的骨架（${placeholders.length} 处 <待撰写：…> 占位符，第一处：${placeholders[0].slice(0, 30)}…）`)
  }

  // ── 两种真实格式（实测口径，不要想当然）──────────────────────────────────
  //   基线三段式：integrated_multimodal_description / overall_soundscape / non_diegetic_music
  //   Ref2VA  六段式：subject_definitions / summary / retention_analysis /
  //                    detailed_description / overall_soundscape / non_diegetic_music
  const isRef2va = p.kind === 'ref2va'

  // 公共段：两格式都有
  for (const f of ['overall_soundscape:', 'non_diegetic_music:']) {
    if (!has(new RegExp('^\\s*' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm'))) r.issues.push(`缺字段 ${f}`)
  }
  if (isRef2va) {
    for (const f of ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:']) {
      if (!has(new RegExp('^\\s*' + f, 'm'))) r.issues.push(`Ref2VA 缺字段 ${f}`)
    }
    // 主体与参考图编号必须成对出现
    if (!/<Subject\s+\d+>/.test(t)) r.issues.push('Ref2VA 未定义 <Subject N>')
    if (!/<Picture\s+\d+>/.test(t)) r.issues.push('Ref2VA 未引用 <Picture N>')
    // subject_definitions 必须逐个锚定到某张参考图
    const sd = t.split(/^summary:/m)[0] || ''
    const subjects = [...sd.matchAll(/<Subject\s+(\d+)>/g)].map((m) => m[1])
    if (subjects.length === 0) r.issues.push('subject_definitions 段里没有 <Subject N>')
    for (const n of subjects) {
      const line = sd.split(/\r?\n/).find((l) => l.includes(`<Subject ${n}>`))
      if (line && !/<Picture\s+\d+>/.test(line)) r.issues.push(`<Subject ${n}> 的定义没有锚定到某张 <Picture N>`)
    }
    if (!/\[reference generation\]/i.test(t)) r.issues.push('summary 缺 [reference generation] 标记')
    if (!/fully_preserved|partially_preserved|weak_reference/.test(t)) r.issues.push('retention_analysis 缺保留等级标记')
  } else {
    if (!has(/^\s*integrated_multimodal_description:/m)) r.issues.push('缺字段 integrated_multimodal_description:')
  }
  // 2. non_diegetic_music 必须为 N/A
  const ndm = t.match(/non_diegetic_music:\s*(.+)/i)
  if (!ndm || !/^N\/A\s*$/.test(ndm[1].trim())) r.issues.push('non_diegetic_music 不是纯 N/A')
  // 3. 禁止对白
  if (/<d>|<\/d>|<d\s/.test(t)) r.issues.push('出现对白块 <d>')
  // 4. 禁止文字/水印
  if (!/no on-screen text/i.test(t)) r.issues.push('未声明 no on-screen text')
  if (!/no (watermark|logo)/i.test(t)) r.issues.push('未声明 no watermark/logo')
  if (/\b(subtitle|signboard|neon sign|caption)\b/i.test(t)) r.issues.push('描述里出现字幕/招牌类词')
  // 5. 风格前缀（只校验前 3 段，避免历史 prompt 因后缀截短被误判）
  if (STYLE_FULL && !t.includes(styleKey(STYLE_FULL))) r.issues.push('缺统一风格前缀')

  // 6. 首行/开头对齐指令按**实际选用的提示词类型**区分（不是 segments.json 的 mode）
  const firstLine = t.split(/\r?\n/)[0].trim()
  if (isRef2va) {
    if (firstLine !== 'subject_definitions:') r.issues.push(`Ref2VA 首行应为 subject_definitions:（实际 "${firstLine.slice(0, 40)}"）`)
  } else if (s.mode === 'FL2VA') {
    if (!/^How the reference pictures align with the target video —/.test(firstLine)) r.issues.push('FL2VA 缺首行对齐指令')
    if (/\(from \[Shot/.test(firstLine)) r.issues.push('FL2VA 对齐指令误用方括号')
    const marks = [...firstLine.matchAll(/(\d+\.\d{2})-second mark/g)].map((m) => Number(m[1]))
    if (!marks.includes(s.genDur)) r.issues.push(`FL2VA 秒数未落 ${s.genDur}.00（实测 ${JSON.stringify(marks)}）`)
  } else if (s.mode === 'I2VA' && s.chainFrom == null) {
    if (!/^For the target video, at 0\.00 seconds into the target video, <Picture 1> \(from \[Shot 1\]\) is fully referenced\.$/.test(firstLine)) {
      r.issues.push('I2VA 首行对齐指令不符合规范（含方括号 [Shot 1]）')
    }
  } else if (s.mode === 'T2VA') {
    if (/^For the target video|^How the reference pictures/.test(firstLine)) r.issues.push('T2VA 不应有对齐指令')
    if (!/^integrated_multimodal_description:/.test(firstLine)) r.issues.push('T2VA 首行应为 integrated_multimodal_description')
  }
  // 链式段（chainFrom != null）走上一段末帧做首帧，不要求参考图对齐指令

  // 7. 时间码不得超出生成时长
  const times = [...t.matchAll(/At (\d{2}):(\d{2}\.\d{3})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]))
  const over = times.filter((x) => x >= s.genDur)
  if (over.length) r.issues.push(`时间码超出生成时长：${over.join(', ')} ≥ ${s.genDur}s`)
  if (times.length === 0) r.issues.push('完全没有可观察的时序节拍（At 00:0X.XXX）')

  // 8. 收束到片尾（实测写法："holds until the video ends at 00:11.000"）
  const endRe = new RegExp('holds until|video ends at\\s*(?:0?0:)?0*' + s.genDur + '\\.000|' + s.genDur + '\\.00-second')
  if (!endRe.test(t)) {
    r.issues.push(`未见收束到 ${s.genDur}s 的表述（末拍 ${times.length ? times[times.length - 1].toFixed(3) : '—'}s）`)
  }

  r.times = times
  r.ok = r.issues.length === 0
  if (!r.ok) problems.push({ name, issues: r.issues })
  rows.push(r)
}

console.log('序号 段名            选用      模式    生成  字符   时间拍点              结论')
for (const r of rows) {
  console.log(
    String(r.name.slice(0, 2)).padEnd(4) +
    r.name.slice(3, -4).padEnd(17) +
    String(r.kind).padEnd(10) +
    String(r.mode).padEnd(7) +
    String(r.gen).padStart(4) + '  ' +
    String(r.chars ?? '—').padStart(5) + '  ' +
    String(r.times ? r.times.length : 0).padStart(3) + ' 个 ' +
    (r.times && r.times.length ? `末拍 ${r.times[r.times.length - 1].toFixed(3)}s`.padEnd(16) : ''.padEnd(16)) +
    (r.ok ? '✅' : '❌ ' + r.issues.join('；'))
  )
}
console.log('')
const maxChars = Math.max(...rows.map((r) => r.chars ?? 0))
console.log(`最长 prompt：${maxChars} 字符（上限 ${MAX_CHARS}，余量 ${MAX_CHARS - maxChars}）`)
if (problems.length) {
  console.log(`❌ ${problems.length}/${rows.length} 份不合格`)
  process.exitCode = 1
} else {
  console.log(`✅ ${rows.length}/${rows.length} 份全部通过合规检查`)
}
