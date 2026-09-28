#!/usr/bin/env node
/**
 * 86_pv_cover.mjs —— 生成投稿用 16:9 封面
 * ---------------------------------------------------------------------------
 * 关键点（都是踩过的坑）：
 *  1. 底帧从 **clips/ 分镜片** 取，不从成片取 —— 成片的帧带烧录字幕，当封面很脏
 *  2. 分辨率用**配置里的尺寸**（`cover.sizes[0]` = 基准成片尺寸，`[1]` = B站推荐尺寸）
 *  3. 文字走 ASS（UTF-8 文件），中文不经过 argv，也不交给图像模型画
 *  4. logo 用配置 `cover.logos` 里的官方素材；ACE 与 DeepSeek 鲸鱼是**黑标**，
 *     深色画面上要垫浅色底片才看得清
 *
 * **配置化**：主副标题 `cover.title/subtitle`、尺寸 `cover.sizes`、logo `cover.logos`、
 *   主推版式 `cover.preset`、署名 `credits.*`、底帧分镜 `segments.json`、输出 `video.coverDir`。
 *   本脚本对歌名、分辨率、分镜文件名、署名字串**零硬编码**。
 *
 * 用法：
 *   node scripts/86_pv_cover.mjs --plan        # 只打印将要做的事（不写产物）
 *   node scripts/86_pv_cover.mjs               # 生成全部方向（同名旧图先归档）
 *   node scripts/86_pv_cover.mjs --only D_10th
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  loadConfig, loadSegments, parseArgv, log, run, ensureDirs, finishPlan, nonClobber, pad2,
  ffmpegBin,
} from './lib/fanfill-config.mjs'

const { arg, plan: PLAN_ONLY } = parseArgv()
const ROOT = process.cwd()
const cfg = loadConfig(ROOT)

// ── 路径与参数：全部来自配置 ────────────────────────────────────────────────
// ffmpeg 走可移植解析（环境变量 FANFILL_FFMPEG_DIR > video.ffmpegDir > 历史默认 > PATH）
const FFMPEG = ffmpegBin()
// ImageMagick 只在少数封面版式上用到；没有就跳过那几步，不阻断
const MAGICK = process.env.FANFILL_MAGICK
  || 'C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe'
const PV = path.dirname(cfg.dirs.clips)
const CLIPS = cfg.dirs.clips
const OUT = cfg.dirs.cover
const TMP = path.join(PV, '.tmp')                    // 脚本缓存区（取帧 / 中间 ASS）
const FONT = cfg.delivery.subtitle.font

const COVER = cfg.raw.cover || {}
const SIZES = Array.isArray(COVER.sizes) ? COVER.sizes : []
const [W, H] = SIZES[0] || cfg.delivery.baseSize
const [SMALL_W, SMALL_H] = SIZES[1] || SIZES[0] || cfg.delivery.baseSize
const PRESET = COVER.preset || 'D_10th'

const ONLY = arg('only', '')

// ── 文案：标题/副标题/署名全部来自配置 ──────────────────────────────────────
const THIS = (cfg.raw.credits || {}).thisVersion || {}
const TOOLS = Array.isArray(THIS.tools) ? THIS.tools : []
const toolName = (role, dflt) => TOOLS.find((t) => t.role === role)?.name || dflt
const TITLE = COVER.title || cfg.raw.song.name
const SUB = COVER.subtitle || cfg.raw.song.source || ''

// 角色 → 配置里的 logo 素材（按文件名关键字匹配）+ 卡面前的动词 + 垫片/logo 像素尺寸
const ROLE_LOGO_RE = { 歌声合成: /ace/i, 视频生成: /minimax/i, 'Agent 编排': /whale/i }
const ROLE_PREFIX = { 歌声合成: 'AI 演唱 ', 视频生成: 'PV 生成 ', 'Agent 编排': '工作台 ' }
const LOGO_BOX = {
  歌声合成: { box: [120, 40], chip: [132, 48] },
  视频生成: { box: [120, 40], chip: [132, 48] },
  'Agent 编排': { box: [40, 40], chip: [52, 48] },
}
const COVER_LOGOS = (COVER.logos || []).map((p) => cfg.abs(p))
const logoPathOf = (role) => {
  const re = ROLE_LOGO_RE[role]
  return re ? (COVER_LOGOS.find((x) => re.test(path.basename(x))) || null) : null
}

// 带 logo 的署名块（文字与 logo 的坐标在下面 LAYOUT 里）
const CREDITS = ['歌声合成', '视频生成', 'Agent 编排'].map((role) => ({
  logo: role,
  text: `${ROLE_PREFIX[role] || ''}${toolName(role, role)}`,
  file: logoPathOf(role),
}))
const CREDIT_TEXT = { 改词: `改词 ${THIS.改词 || ''}`.trim() }
// 无 logo 版式的单行署名
const INLINE_CREDIT = [
  CREDIT_TEXT.改词,
  CREDITS.find((c) => c.logo === '歌声合成').text,
  CREDITS.find((c) => c.logo === '视频生成').text,
].join('　｜　')

// ── 排版：A/B/C 无 logo；D 用 10 周年底图 + 三个官方 logo ────────────────────
// clip 用**段号**引用（文件名由 segments.json 推），坐标是基准尺寸下的像素值
const LAYOUT = {
  A_xinyan: { seg: 7, at: 4.6, title: [86, 74, 7], sub: [90, 222, 7], credits: [[90, 688, 7]] },
  B_moon: { seg: 14, at: 7.9, title: [86, 336, 7], sub: [90, 488, 7], credits: [[90, 688, 7]] },
  C_moonwide: { seg: 5, at: 11.1, title: [672, 40, 8], sub: [672, 180, 8], credits: [[672, 700, 8]] },
  // D：十周年贺图（段 2 就是参考 10th.jpg 生成的画面）+ 三个官方 logo
  D_10th: {
    seg: 2, at: 0.6,
    title: [86, 52, 7], sub: [90, 198, 7],
    bands: true,
    logos: [
      { logo: '歌声合成', chipXY: [86, 630], textXY: [240, 644] },
      { logo: '视频生成', chipXY: [520, 630], textXY: [676, 644] },
      { logo: 'Agent 编排', chipXY: [86, 696], textXY: [240, 710] },
    ],
    credits: [[676, 710, 7]],  // 改词（与 MiniMax 列对齐）
  },
}

const VARIANTS = [
  { id: 'D_10th', name: '十周年贺图 + 官方 logo（主推）' },
  { id: 'A_xinyan', name: '薪炎·举剑金环' },
  { id: 'B_moon', name: '红月·伸手' },
  { id: 'C_moonwide', name: '星海·三人升华' },
]
if (!VARIANTS.some((v) => v.id === PRESET)) { log(`❌ cover.preset="${PRESET}" 在 LAYOUT 里没有对应版式`); process.exit(1) }
VARIANTS.sort((a, b) => (a.id === PRESET ? -1 : b.id === PRESET ? 1 : 0))   // 主推版式排在最前
const chosen = VARIANTS.filter((v) => !ONLY || ONLY.split(',').map((s) => s.trim()).includes(v.id))

// ── 底帧：段号 → clips/<NN>_<slug>.mp4 ──────────────────────────────────────
const { segments } = loadSegments(cfg)
const clipOf = (segIdx) => {
  const s = segments.find((x) => x.idx === segIdx)
  if (!s) { log(`❌ segments.json 里没有段 ${segIdx}（cover 版式引用了不存在的段）`); process.exit(1) }
  return path.join(CLIPS, `${pad2(s.idx)}_${s.slug}.mp4`)
}

/** 子进程：spawn 失败不抛，统一成 code=-1（错误要响，不要静默） */
async function tryRun(cmd, args) {
  try { return await run(cmd, args, { timeoutMs: 600000 }) } catch (e) { return { code: -1, stdout: '', stderr: String(e.message) } }
}

// ── 覆盖前归档（非破坏性红线：旧封面 → history/<时间戳>/）────────────────────
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
    fs.writeFileSync(readme, `# 归档 ${stamp}\n\n- 原因：${reason}\n- 说明：这些产物在本次运行中被重新生成，旧版本先移到这里（非破坏性，未删除）。\n\n`
      + moved.map((m) => `- \`${path.basename(m)}\``).join('\n') + '\n', 'utf8')
  }
  log(`归档 ${moved.length} 个旧产物 → ${path.relative(ROOT, dir)}（${reason}）`)
  return moved
}

const assTime = (t) => `0:00:${t.toFixed(2).padStart(5, '0')}`

function coverAss(layout) {
  const styles = [
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Title,${FONT},118,&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,2,0,1,7,5,7,0,0,0,134`,
    `Style: Sub,${FONT},39,&H00F5F5F5,&H00F5F5F5,&H00101010,&H90000000,-1,0,0,0,100,100,1,0,1,3.5,3,7,0,0,0,134`,
    `Style: Credit,${FONT},30,&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,0.5,0,1,3,2,7,0,0,0,134`,
    // 垫片文字：黑字，用在浅色底片上
    `Style: ChipText,${FONT},30,&H00202020,&H00202020,&H00FFFFFF,&H00000000,-1,0,0,0,100,100,0.5,0,1,0,0,7,0,0,0,134`,
  ]
  const ev = []
  const put = (style, pos, text) =>
    ev.push(`Dialogue: 0,${assTime(0)},${assTime(2)},${style},,0,0,0,,{\\an${pos[2]}\\pos(${pos[0]},${pos[1]})}${text}`)

  put('Title', layout.title, TITLE)
  put('Sub', layout.sub, SUB)

  if (layout.logos) {
    for (const L of layout.logos) put('Credit', L.textXY, CREDITS.find((x) => x.logo === L.logo).text)
    for (const pos of layout.credits) put('Credit', pos, CREDIT_TEXT.改词)
  } else {
    put('Credit', layout.credits[0], INLINE_CREDIT)
  }

  return [
    '[Script Info]', 'Title: PV cover', 'ScriptType: v4.00+',
    `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]', ...styles, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...ev, '',
  ].join('\n')
}

// ── --plan：只打印 ──────────────────────────────────────────────────────────
if (PLAN_ONLY) {
  console.log(`配置：${path.relative(ROOT, cfg.configPath)}｜标题「${TITLE}」副标题「${SUB}」`)
  console.log(`尺寸：${W}x${H}（cover.sizes[0]）+ ${SMALL_W}x${SMALL_H}（cover.sizes[1]）｜字体 ${FONT}`)
  console.log(`主推版式：${PRESET}（cover.preset）`)
  console.log(`署名（来自 credits.thisVersion）：${CREDITS.map((c) => c.text).join('｜')}｜${CREDIT_TEXT.改词}`)
  console.log('logo：')
  for (const c of CREDITS) {
    console.log(`  · ${c.logo} → ${c.file ? path.relative(ROOT, c.file) : '❌ 配置 cover.logos 里找不到对应素材'}`)
  }
  console.log('')
  console.log('方向  底帧（段 → clips/）                 输出')
  for (const v of chosen) {
    const layout = LAYOUT[v.id]
    const src = clipOf(layout.seg)
    const at = fs.existsSync(src) ? `${layout.at}s` : '❌缺'
    console.log(
      v.id.padEnd(12) + `${layout.seg} ${at} → ${path.basename(src)}`.padEnd(34) +
      `${path.basename(path.join(OUT, `封面_${v.id}_${W}x${H}.jpg`))}` + (fs.existsSync(src) ? (fs.existsSync(path.join(OUT, `封面_${v.id}_${W}x${H}.jpg`)) ? '（已存在，会先归档）' : '') : ' ❌ 缺分镜片')
    )
  }
  const miss = chosen.filter((v) => !fs.existsSync(clipOf(LAYOUT[v.id].seg)))
  const missLogo = CREDITS.filter((c) => !c.file)
  if (miss.length) console.log(`\n⚠ 缺分镜片：${miss.map((v) => v.id).join('、')}（先跑 82_pv_clips.mjs）`)
  if (missLogo.length) console.log(`\n⚠ 缺 logo 素材：${missLogo.map((c) => c.logo).join('、')}`)
  finishPlan(chosen.map((v) => ({
    label: `${v.id} ${v.name}`,
    detail: `底帧 段 ${LAYOUT[v.id].seg} @${LAYOUT[v.id].at}s → 封面_${v.id}_${W}x${H}.jpg + _${SMALL_W}x${SMALL_H}.jpg`,
    cny: 0,
  })), cfg, { title: `86 封面 ${chosen.length} 个方向（纯本地，不花钱）` })
}

// ── 实跑 ────────────────────────────────────────────────────────────────────
const missLogo = CREDITS.filter((c) => !c.file)
if (missLogo.length) { log(`❌ 缺 logo 素材（cover.logos 里没有匹配项）：${missLogo.map((c) => c.logo).join('、')}`); process.exit(1) }

ensureDirs(OUT, TMP, cfg.dirs.history)

const made = []
for (const v of chosen) {
  const layout = LAYOUT[v.id]
  const src = clipOf(layout.seg)
  if (!fs.existsSync(src)) { log(`❌ 缺分镜片：${src}`); continue }

  const frame = path.join(TMP, `cover_${v.id}.png`)
  const ass = path.join(TMP, `cover_${v.id}.ass`)
  const big = path.join(OUT, `封面_${v.id}_${W}x${H}.jpg`)
  const small = path.join(OUT, `封面_${v.id}_${SMALL_W}x${SMALL_H}.jpg`)
  await fsp.writeFile(ass, coverAss(layout), 'utf8')

  // 显式取帧一次（两个分支都依赖它）
  const ex = await tryRun(FFMPEG, ['-y', '-v', 'error', '-ss', String(layout.at), '-i', src, '-frames:v', '1', '-q:v', '1', frame])
  if (ex.code !== 0) { log(`❌ ${v.id} 取帧失败：${String(ex.stderr).slice(0, 200)}`); continue }

  let args
  if (layout.logos) {
    // 先用 ImageMagick 生成**渐变**遮罩（比 drawbox 的硬边好看得多），叠到帧上
    let base = frame
    if (layout.bands) {
      const topG = path.join(TMP, 'band_top.png')
      const botG = path.join(TMP, 'band_bottom.png')
      const H1 = 300, H2 = 240
      await tryRun(MAGICK, ['-size', `${W}x${H1}`, 'gradient:#00000073-#00000000', topG])
      await tryRun(MAGICK, ['-size', `${W}x${H2}`, 'gradient:#00000000-#0000008F', botG])
      const banded = path.join(TMP, `cover_${v.id}_banded.png`)
      const r0 = await tryRun(FFMPEG, ['-y', '-v', 'error', '-i', frame, '-i', topG, '-i', botG,
        '-filter_complex', `[0:v][1:v]overlay=0:0[a];[a][2:v]overlay=0:${H - H2}[out]`,
        '-map', '[out]', '-frames:v', '1', banded])
      if (r0.code !== 0) { log(`❌ ${v.id} 渐变遮罩失败：${String(r0.stderr).slice(0, 300)}`); continue }
      base = banded
    }

    const inputs = ['-y', '-v', 'error', '-i', base]
    const chains = []
    const chips = layout.logos.map((L) => {
      const [cw, ch] = LOGO_BOX[L.logo].chip
      return `drawbox=x=${L.chipXY[0]}:y=${L.chipXY[1]}:w=${cw}:h=${ch}:color=white@0.92:t=fill`
    }).join(',')
    chains.push(`[0:v]${chips}[bg]`)
    layout.logos.forEach((L, i) => {
      const spec = LOGO_BOX[L.logo]
      chains.push(`[${i + 1}:v]scale=${spec.box[0]}:${spec.box[1]}[lg${i}]`)
    })
    let cur = 'bg'
    layout.logos.forEach((L, i) => {
      const spec = LOGO_BOX[L.logo]
      const [cw, ch] = spec.chip
      const [bw, bh] = spec.box
      const x = L.chipXY[0] + Math.round((cw - bw) / 2)
      const y = L.chipXY[1] + Math.round((ch - bh) / 2)
      const next = `o${i}`
      chains.push(`[${cur}][lg${i}]overlay=${x}:${y}[${next}]`)
      cur = next
    })
    chains.push(`[${cur}]ass='${ass.replace(/\\/g, '/').replace(/:/g, '\\:')}'[out]`)
    for (const L of layout.logos) inputs.push('-i', CREDITS.find((c) => c.logo === L.logo).file)
    args = [...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-frames:v', '1', '-q:v', '2', big]
  } else {
    args = ['-y', '-v', 'error', '-i', frame,
      '-vf', `ass='${ass.replace(/\\/g, '/').replace(/:/g, '\\:')}'`, '-frames:v', '1', '-q:v', '2', big]
  }

  archiveOld([big, small], `86 重新生成封面（${v.id}）`)
  const r = await tryRun(FFMPEG, args)
  if (r.code !== 0) { log(`❌ ${v.id} 合成失败：${String(r.stderr).slice(0, 400)}`); continue }

  await tryRun(FFMPEG, ['-y', '-v', 'error', '-i', big, '-vf', `scale=${SMALL_W}:${SMALL_H}:flags=lanczos`, '-q:v', '2', small])

  const kb = (f) => fs.existsSync(f) ? Math.round(fs.statSync(f).size / 1024) : 0
  made.push(v)
  console.log(`✅ ${v.id.padEnd(12)} ${v.name}`)
  console.log(`     ${path.relative(ROOT, big)}  ${W}x${H}  ${kb(big)} KB`)
  console.log(`     ${path.relative(ROOT, small)}  ${SMALL_W}x${SMALL_H}  ${kb(small)} KB`)
}

console.log('')
console.log(`${made.length} 个方向 → ${path.relative(ROOT, OUT)}`)
if (made.length !== chosen.length) process.exitCode = 1
