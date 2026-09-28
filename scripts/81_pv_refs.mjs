#!/usr/bin/env node
/**
 * 81_pv_refs.mjs —— 把 CG 原图处理成"送 H3 作参考图"的干净版本
 * ---------------------------------------------------------------------------
 * 为什么需要它：H3 的 reference_image 会强影响生成结果，而多数 CG 左上/右下角带「崩坏3」logo，
 * 直接送进去可能把水印画进成片。这里按**配置里的去水印矩形**擦掉 logo 区，再统一缩到 1536 宽（只缩不放）。
 *
 * **配置化**（见 00_docs/08_翻填项目配置规范.md）：
 *   · 源目录   `video.cgDir`（缺省 `01_input/CG`）
 *   · 去水印   `video.delogo`（数组，**空数组 = 不擦**；每项 {anchor,x,y,w,h}，x/y/w/h 是源图比例）
 *   · 输出目录 `video.refDir`
 *   本脚本对歌名、分辨率、水印位置**零硬编码**。
 *
 * 说明（2026-09-27 实测）：原计划的 image-01 "二创关键帧"路线已废弃 ——
 *   MiniMax /v1/image_generation 的 subject_reference 只接受**公网可访问的 URL**，
 *   data URL / file_id / mm_file:// 全部被拒（status_code=1000 disallowed image url）。
 *   改走 H3 原生参考图机制（支持 mm_file:// 与 data URI），即"原图只作参考、入画的是新生成画面"。
 *
 * 用法：
 *   node scripts/81_pv_refs.mjs --plan    # 只打印将要做的事（不发请求、不写产物）
 *   node scripts/81_pv_refs.mjs           # 生成/刷新参考图（同名旧图先归档到 history/）
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  loadConfig, parseArgv, log, run, probeMedia, ensureDirs, finishPlan, nonClobber, FFMPEG,
} from './lib/fanfill-config.mjs'

const { plan: PLAN_ONLY } = parseArgv()
const ROOT = process.cwd()
const cfg = loadConfig(ROOT)

// ── 路径与参数：全部来自配置 ────────────────────────────────────────────────
const SRC_DIR = cfg.abs(cfg.raw.video.cgDir || '01_input/CG')   // 输入目录（video.cgDir）
const OUT = cfg.dirs.refs                                        // 输出目录（video.refDir）
const MAX_W = 1536                                               // 只缩不放：源图窄于 1536 时保持原宽

// 需要参考图的素材清单（本歌分镜用到的 CG）＋ 每张的 logo 位置标签：
//   'tl' = 左上角 logo → 取 video.delogo 里 anchor=top-left 的矩形
//   'br' = 右下角 logo → 取 anchor=bottom-right 的矩形
//   false = 无 logo，不擦
const NEEDED = [
  { src: '德丽莎2022生日.png', logo: 'tl' },
  { src: '星海绘卷.png', logo: 'tl' },
  { src: '然后向着明天.png', logo: 'tl' },
  { src: '屏幕截图(321).png', logo: false },
  { src: '薪火传承.png', logo: 'tl' },
  { src: '屏幕截图(115).png', logo: false },
  { src: '屏幕截图(163).png', logo: false },
  { src: '月下1.png', logo: false },
  { src: '月下3.jpg', logo: false },
  { src: '10th.jpg', logo: 'br' },
  { src: 'ElysianRealm.png', logo: 'br' },
]

// ── 去水印矩形：数值全部来自 video.delogo ───────────────────────────────────
const ANCHOR_OF = { tl: 'top-left', br: 'bottom-right' }
const DELOGO = Array.isArray(cfg.raw.video.delogo) ? cfg.raw.video.delogo : []

function rectsFor(label) {
  const anchor = ANCHOR_OF[label]
  if (!anchor) return []
  return DELOGO.filter((d) => (d.anchor || 'top-left') === anchor)
}

/** 比例 → delogo 滤镜表达式（与 ffmpeg delogo 的 x/y/w/h 同义；<2px 夹到 2px）。 */
function delogoExpr(r, w, h) {
  const bw = Math.round(w * Number(r.w))
  const bh = Math.round(h * Number(r.h))
  const anchored = (r.anchor || 'top-left') === 'bottom-right'
  const x = anchored ? Math.max(2, w - bw - Math.round(w * Number(r.x))) : Math.max(2, Math.round(w * Number(r.x)))
  const y = anchored ? Math.max(2, h - bh - Math.round(h * Number(r.y))) : Math.max(2, Math.round(h * Number(r.y)))
  return `delogo=x=${x}:y=${y}:w=${bw}:h=${bh}`
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
    fs.writeFileSync(readme, `# 归档 ${stamp}\n\n- 原因：${reason}\n- 说明：这些产物在本次运行中被重新生成，旧版本先移到这里（非破坏性，未删除）。\n\n`
      + moved.map((m) => `- \`${path.basename(m)}\``).join('\n') + '\n', 'utf8')
  }
  log(`归档 ${moved.length} 个旧产物 → ${path.relative(ROOT, dir)}（${reason}）`)
  return moved
}

// ── 计划 ────────────────────────────────────────────────────────────────────
const planned = []
const rows = []
for (const item of NEEDED) {
  const srcPath = path.join(SRC_DIR, item.src)
  const outName = 'ref_' + item.src.replace(/\.[^.]+$/, '') + '.jpg'
  const outPath = path.join(OUT, outName)
  const rects = rectsFor(item.logo)
  let dims = null
  if (fs.existsSync(srcPath)) {
    if (PLAN_ONLY) dims = null   // 计划阶段不必探测，直接列出比例口径
    else {
      try {
        const m = await probeMedia(srcPath)   // 一律 ffprobe -of json，不解析人读文本
        dims = m.width && m.height ? { w: m.width, h: m.height } : null
        if (!dims) throw new Error('ffprobe 没给出宽高')
      } catch (e) {
        rows.push({ src: item.src, ok: false, logo: item.logo, note: `取源图尺寸失败：${String(e.message).slice(0, 120)}` })
        console.error(`❌ ${item.src} 取源图尺寸失败：${String(e.message).slice(0, 200)}`)
        continue
      }
    }
  }
  planned.push({ item, srcPath, outName, outPath, rects, dims })
}

const logoLabel = (l) => (l === true ? '是' : l === false || l == null ? '否' : String(l))

if (PLAN_ONLY) {
  console.log(`源目录：${path.relative(ROOT, SRC_DIR)}（video.cgDir）`)
  console.log(`输出：  ${path.relative(ROOT, OUT)}（video.refDir）｜最长边只缩不放（≤${MAX_W} 宽）`)
  console.log(`去水印：video.delogo ${DELOGO.length} 个矩形${DELOGO.length ? '' : '（空数组 = 不擦）'}`)
  for (const d of DELOGO) {
    console.log(`        · anchor=${d.anchor || 'top-left'} x=${d.x} y=${d.y} w=${d.w} h=${d.h}${d.note ? `  // ${d.note}` : ''}`)
  }
  console.log('')
  console.log('源素材'.padEnd(24) + '带logo'.padEnd(8) + '去水印'.padEnd(10) + '输出'.padEnd(30) + '状态')
  for (const p of planned) {
    const ex = fs.existsSync(p.srcPath)
    console.log(
      p.item.src.padEnd(24) + logoLabel(p.item.logo).padEnd(8) +
      String(p.rects.length ? `${p.rects.length} 个` : '不擦').padEnd(10) +
      p.outName.padEnd(30) +
      (ex ? (fs.existsSync(p.outPath) ? '已存在（会先归档）' : '待生成') : '❌ 源图缺失')
    )
  }
  const miss = planned.filter((p) => !fs.existsSync(p.srcPath))
  console.log('')
  if (miss.length) console.log(`⚠ ${miss.length} 张源图缺失：${miss.map((m) => m.item.src).join('、')}`)
  finishPlan([{
    label: `生成 ${planned.length} 张参考图 → ${path.relative(ROOT, OUT)}/`,
    detail: `ffmpeg delogo + lanczos 缩放（只缩不放，≤${MAX_W} 宽）；同名旧图先归档 history/`,
    cny: 0,
  }], cfg, { title: '81 参考图处理（本地 ffmpeg，不花钱）' })
}

// ── 实跑 ────────────────────────────────────────────────────────────────────
ensureDirs(OUT, cfg.dirs.history)

for (const p of planned) {
  const { item, srcPath, outName, outPath, rects, dims } = p
  if (!fs.existsSync(srcPath)) { rows.push({ src: item.src, ok: false, note: '源图缺失' }); continue }
  const filters = rects.map((r) => delogoExpr(r, dims.w, dims.h))
  filters.push(`scale='min(${MAX_W},iw)':-2:flags=lanczos`)
  archiveOld([outPath], `81 重新生成参考图 ${outName}`)
  const r = await run(FFMPEG, ['-y', '-v', 'error', '-i', srcPath, '-vf', filters.join(','), '-q:v', '3', '-pix_fmt', 'rgb24', outPath], { timeoutMs: 300000 })
  const size = r.code === 0 && fs.existsSync(outPath) ? fs.statSync(outPath).size : 0
  const ok = r.code === 0 && size > 0
  if (!ok) console.error(`❌ ${item.src} 处理失败：${String(r.stderr).slice(0, 200)}`)
  rows.push({
    src: item.src, out: outName, ok, logo: item.logo,
    from: `${dims.w}x${dims.h}`, bytes: size, note: ok ? '' : String(r.stderr).slice(0, 160),
  })
}

console.log('源素材'.padEnd(24) + '带logo'.padEnd(8) + '原始尺寸'.padEnd(12) + '输出'.padEnd(30) + '大小')
for (const r of rows) {
  console.log(
    r.src.padEnd(24) + String(r.logo === true ? '是' : r.logo === false ? '否' : '-').padEnd(8) +
    String(r.from || '-').padEnd(12) + String(r.out || '-').padEnd(30) +
    (r.ok ? (r.bytes / 1024).toFixed(0) + ' KB' : '❌ ' + r.note)
  )
}
const bad = rows.filter((r) => !r.ok)
console.log('')
console.log(bad.length ? `❌ ${bad.length}/${rows.length} 张失败` : `✅ ${rows.length}/${rows.length} 张参考图就绪 → ${path.relative(ROOT, OUT)}`)
if (bad.length) process.exitCode = 1
