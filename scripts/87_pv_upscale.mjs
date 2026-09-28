#!/usr/bin/env node
/**
 * 87_pv_upscale.mjs —— 本地免费把成片时间轴从基准尺寸提到交付分辨率（按 video.deliverRes）
 * ---------------------------------------------------------------------------
 * 路线：ffmpeg 抽帧 → Real-ESRGAN ncnn-vulkan（realesr-animevideov3 ×2，纯本地 GPU）
 *       → 超采样降到交付分辨率 → 分段编码 → 拼接
 * 全程不调任何云 API；字幕后烧（84）在交付画布上重排，所以字幕比"放大烧录版"更锐。
 *
 * 分段处理是为了控制磁盘峰值（全解会占十几 GB）。
 *
 * **配置化**：源尺寸 `video.baseSize`、帧率 `song.fps`、交付分辨率与 tag `video.deliverRes`、
 *   工具/模型/倍数/分段/CRF `video.upscale.*`、目录 `video.*Dir`。
 *   本脚本对歌名、分辨率、模型名**零硬编码**（`--chunk/--crf/--scale/--model` 仍可覆盖）。
 *
 * 用法：
 *   node scripts/87_pv_upscale.mjs --plan         # 只报计划（不写产物）
 *   node scripts/87_pv_upscale.mjs                # 实跑
 *   node scripts/87_pv_upscale.mjs --chunk 200 --crf 14
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  loadConfig, parseArgv, log, run, ensureDirs, finishPlan, FFMPEG, FFPROBE,
} from './lib/fanfill-config.mjs'

const { arg, plan: PLAN_ONLY } = parseArgv()
const ROOT = process.cwd()
const cfg = loadConfig(ROOT)

// ── 路径与参数：全部来自配置 ────────────────────────────────────────────────
const PV = path.dirname(cfg.dirs.clips)
const SRC = path.join(PV, '.norm', 'timeline.mp4')     // 无字幕、无音轨的拼接时间轴（84 的中间产物）
const WORK = path.join(PV, '.up')
const IN = path.join(WORK, 'in')
const OUT = path.join(WORK, 'out')
const PARTS = path.join(WORK, 'parts')

const UP = cfg.raw.video.upscale || {}
const ESRGAN = cfg.abs(UP.tool || 'tools/upscale/realesrgan-ncnn-vulkan.exe')
const MODEL = arg('model', UP.model || 'realesrgan-x4plus')
const SCALE = Number(arg('scale', UP.scale ?? 2))
const CHUNK = Number(arg('chunk', UP.chunk ?? 250))
const CRF = arg('crf', UP.crf ?? '14')

const [SRC_W, SRC_H] = cfg.delivery.baseSize
const FPS = Number(cfg.raw.song.fps)
const [AR_W, AR_H] = String(cfg.delivery.aspect || '16:9').split(':').map(Number)
const MID_W = SRC_W * SCALE
const MID_H = SRC_H * SCALE

// 交付分辨率：取 deliverRes 里 method = realesrgan-* 的那一项（h3-2k-regen 是花钱路线，这里不做）
const DELIV = Array.isArray(cfg.delivery.deliverRes) ? cfg.delivery.deliverRes : []
const entry = DELIV.find((d) => String(d.method || '').startsWith('realesrgan')) || null
if (!entry) {
  const paid = DELIV.find((d) => String(d.method || '') === 'h3-2k-regen')
  log(paid
    ? `❌ video.deliverRes 只有 h3-2k-regen（H3 原生 2K 重生成，**花钱**）路线，本脚本只做本地 Real-ESRGAN 超分；请改用 h3.mjs regenerate 或补一条 realesrgan-* 配置`
    : `❌ video.deliverRes 没有可用的超分项（需要 {name,size,method:"realesrgan-x2-then-downsample",tag}）`)
  process.exit(1)
}
const [TW, TH] = entry.size
const TAG = entry.tag || String(TH)
const DST = path.join(WORK, `timeline_${TAG}.mp4`)

/** 子进程：spawn 失败不抛，统一成 code=-1（错误要响，不要静默） */
async function tryRun(cmd, args, timeoutMs) {
  try { return await run(cmd, args, { timeoutMs }) } catch (e) { return { code: -1, stdout: '', stderr: String(e.message) } }
}

// ── 检查 ────────────────────────────────────────────────────────────────────
log(`配置：${path.relative(ROOT, cfg.configPath)}｜源 ${SRC_W}x${SRC_H} @${FPS}fps（video.baseSize / song.fps）`)
for (const f of [SRC, ESRGAN]) if (!fs.existsSync(f)) { log(`❌ 缺文件：${f}${f === SRC ? '（先跑 84_pv_assemble.mjs 生成 .norm/timeline.mp4）' : '（检查 video.upscale.tool）'}`); process.exit(1) }
const pr = await tryRun(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,r_frame_rate,nb_frames', '-of', 'json', SRC], 60000)
if (pr.code !== 0) { log(`❌ ffprobe 读取失败：${SRC}\n${String(pr.stderr).slice(0, 300)}`); process.exit(1) }
const st = JSON.parse(pr.stdout).streams[0]
const total = Number(st.nb_frames)
const chunks = Math.ceil(total / CHUNK)

log(`源：${st.width}x${st.height} @${st.r_frame_rate}，共 ${total} 帧`)
log(`目标：${MID_W}x${MID_H}（${MODEL} ×${SCALE}）→ 超采样降到 ${TW}×${TH}`)
log(`分段：每段 ${CHUNK} 帧，共 ${chunks} 段；磁盘峰值约 ${((CHUNK * 0.6 + CHUNK * 4.0) / 1024).toFixed(1)} GB`)

// ── --plan：只报计划 ────────────────────────────────────────────────────────
if (PLAN_ONLY) {
  console.log(`配置：${path.relative(ROOT, cfg.configPath)}`)
  console.log(`源时间轴：${path.relative(ROOT, SRC)} → ${st.width}x${st.height} @${st.r_frame_rate}，${total} 帧（约 ${(total / FPS).toFixed(2)}s）`)
  console.log(`超分工具：${path.relative(ROOT, ESRGAN)}｜模型 ${MODEL} ×${SCALE}（video.upscale.*）`)
  console.log(`交付分辨率：${TW}x${TH}（tag=${TAG}，method=${entry.method}，video.deliverRes）`)
  console.log(`分段：每段 ${CHUNK} 帧 → ${chunks} 段；CRF ${CRF}；中间产物落在 ${path.relative(ROOT, WORK)}/（脚本缓存区，可重算）`)
  console.log(`输出：${path.relative(ROOT, DST)}`)
  console.log(`  随后：字幕 node scripts/83_pv_subs.mjs --w ${TW} --h ${TH} --tag ${TAG}；合成 node scripts/84_pv_assemble.mjs --timeline ${cfg.rel(DST)} --ass ${cfg.rel(path.join(cfg.dirs.subs, `${cfg.raw.song.name}_${TAG}.ass`))}`)
  console.log('  本步骤纯本地 GPU，不调云 API、不花钱。')
  finishPlan([
    { label: `Real-ESRGAN 超分 ${total} 帧 → ${path.relative(ROOT, DST)}`, detail: `${SRC_W}x${SRC_H} → ${TW}x${TH}｜${chunks} 段 × ${CHUNK} 帧｜CRF ${CRF}`, cny: 0 },
  ], cfg, { title: '87 本地超分（不花钱，耗时较长）' })
}

await ensureDirs(IN, OUT, PARTS)

const clean = async (dir) => {
  for (const f of await fsp.readdir(dir)) await fsp.rm(path.join(dir, f), { force: true, recursive: true })
}

const t0 = Date.now()
const partFiles = []
for (let c = 0; c < chunks; c++) {
  const ss = (c * CHUNK / FPS).toFixed(4)
  const part = path.join(PARTS, `part_${String(c).padStart(3, '0')}.mp4`)
  partFiles.push(part)
  if (fs.existsSync(part)) { log(`段 ${c + 1}/${chunks} 已存在，跳过`); continue }

  await clean(IN); await clean(OUT)

  // 1) 抽帧
  let r = await tryRun(FFMPEG, ['-y', '-v', 'error', '-ss', ss, '-i', SRC, '-frames:v', String(CHUNK),
    '-q:v', '1', path.join(IN, '%05d.jpg')], 900000)
  if (r.code !== 0) { log(`❌ 段 ${c + 1} 抽帧失败：${String(r.stderr).slice(0, 200)}`); process.exit(1) }
  const nIn = (await fsp.readdir(IN)).length
  if (!nIn) { log(`段 ${c + 1} 无帧（已到末尾），结束`); partFiles.pop(); break }

  // 2) Real-ESRGAN 超分
  const tA = Date.now()
  r = await tryRun(ESRGAN, ['-i', IN, '-o', OUT, '-n', MODEL, '-s', String(SCALE), '-f', 'png'], 7200000)
  if (r.code !== 0) { log(`❌ 段 ${c + 1} 超分失败：${String(r.stderr || r.stdout).slice(0, 300)}`); process.exit(1) }
  const nOut = (await fsp.readdir(OUT)).length
  if (nOut !== nIn) { log(`❌ 段 ${c + 1} 输出帧数不符：in=${nIn} out=${nOut}`); process.exit(1) }

  // 3) 超采样降到交付分辨率并编码本段
  const cropH = Math.round(MID_W * AR_H / AR_W)             // 2688 → 1512
  // 居中裁掉上下各 (MID_H-cropH)/2 px。按 video.baseSize 7:4 算，2688x1536 → 1512，每边 12px，
  // 等价于源片丢掉上下各 6px 后得到精确 16:9（旧注释写"12px"易被误读成源像素，已改正）。
  const cropY = Math.round((MID_H - cropH) / 2)
  const vf = `crop=${MID_W}:${cropH}:0:${cropY},scale=${TW}:${TH}:flags=lanczos`
  r = await tryRun(FFMPEG, ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(OUT, '%05d.png'),
    '-vf', vf, '-c:v', 'libx264', '-crf', CRF, '-preset', 'medium', '-pix_fmt', 'yuv420p', part], 1800000)
  if (r.code !== 0) { log(`❌ 段 ${c + 1} 编码失败：${String(r.stderr).slice(0, 300)}`); process.exit(1) }

  const el = (Date.now() - t0) / 1000
  const done = c + 1
  const eta = el / done * (chunks - done)
  log(`段 ${done}/${chunks} ✅ ${nIn} 帧，超分 ${((Date.now() - tA) / 1000).toFixed(0)}s，累计 ${(el / 60).toFixed(1)} 分钟，预计剩余 ${(eta / 60).toFixed(1)} 分钟`)
}

// 4) 拼接所有交付分辨率段
const list = path.join(WORK, 'parts.txt')
await fsp.writeFile(list, partFiles.filter((f) => fs.existsSync(f)).map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n') + '\n', 'utf8')
let r = await tryRun(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', DST], 600000)
if (r.code !== 0) { log(`❌ 拼接失败：${String(r.stderr).slice(0, 300)}`); process.exit(1) }

const pr2 = await tryRun(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,nb_frames', '-show_entries', 'format=duration,size', '-of', 'json', DST], 60000)
if (pr2.code !== 0) { log(`❌ 输出核验失败：${String(pr2.stderr).slice(0, 200)}`); process.exit(1) }
const out = JSON.parse(pr2.stdout)
log(`✅ ${TH}p 时间轴：${path.relative(ROOT, DST)}`)
log(`   ${out.streams[0].width}x${out.streams[0].height}，${out.streams[0].nb_frames} 帧，${Number(out.format.duration).toFixed(3)}s，${(out.format.size / 1048576).toFixed(1)} MB`)
log(`   总用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`)
log(`   下一步：node scripts/83_pv_subs.mjs --w ${TW} --h ${TH} --tag ${TAG}  → 再用 84 --timeline 该文件 --ass 该字幕 合成`)
