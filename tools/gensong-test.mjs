/**
 * 换歌验证（DoD 最后一项）
 * ---------------------------------------------------------------------------
 * 目标：证明这套流水线**真的通用** —— 用「另一首歌的空壳目录 + 一份最小
 * `翻填项目.json`」，能跑到"分镜"阶段而不报错。
 *
 * 做法（全程零副作用、零花费、不动真实项目）：
 *   在系统临时目录建一个空壳工作区 → 写一份最小配置与 5 行 LRC →
 *   用 ffmpeg 合成一段 30s 的测试音频当 master/aceVocal →
 *   `node 80_pv_shotlist.mjs --plan` 与实跑，检查配置读取、切分、校验全通。
 *
 * 注意：这是**新歌的一次真实演练**，所以刻意用与《未来再见》完全不同的参数
 * （不同歌名/总长/BPM/画幅目录名），好让"还残留硬编码"这类问题暴露出来。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT = path.resolve(HERE, '..')   // 仓库根（只读借用脚本）
const FFMPEG = 'E:\\software\\FFmpeg\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe'

const SHELL = path.join(os.tmpdir(), `fanfill-gensong-test-${Date.now()}`)
const SONG = '测试歌_换歌验证'
const TOTAL = 30.0

const step = (n, s) => console.log(`\n[${n}] ${s}`)
const run = (cmd, args, cwd) => new Promise((res) => {
  const p = spawn(cmd, args, { cwd, windowsHide: true })
  let o = '', e = ''
  p.stdout.on('data', (d) => (o += d))
  p.stderr.on('data', (d) => (e += d))
  p.on('close', (code) => res({ code, stdout: o, stderr: e }))
})

console.log(`换歌验证工作区：${SHELL}`)

step(1, '建空壳目录结构（新歌用 10_video，不是 10_h3video）')
for (const d of ['01_input/CG', '02_stems', '03_midi', '04_lyrics', '05_vocals', '06_svc',
  '07_mix', '08_release', '09_aceproject', 'music', 'scripts', '10_video']) {
  fs.mkdirSync(path.join(SHELL, d), { recursive: true })
}
// 借脚本（真实项目只读）
fs.cpSync(path.join(PROJECT, 'scripts/lib'), path.join(SHELL, 'scripts/lib'), { recursive: true })
fs.copyFileSync(path.join(PROJECT, 'scripts/80_pv_shotlist.mjs'), path.join(SHELL, 'scripts/80_pv_shotlist.mjs'))
fs.copyFileSync(path.join(PROJECT, 'scripts/80b_check_prompts.mjs'), path.join(SHELL, 'scripts/80b_check_prompts.mjs'))
console.log('   ✅ 目录 + 脚本就位')

step(2, `写最小 翻填项目.json（歌名 ${SONG}，总长 ${TOTAL}s，40BPM，9:16）`)
const cfg = {
  schema: 1,
  song: { name: SONG, source: '换歌验证用空壳素材', lrc: 'music/test.lrc', bpm: 40, totalSec: TOTAL, fps: 30 },
  audio: {
    reference: '01_input/原曲.mp3',
    instrumental: '02_stems/inst.wav',
    aceVocal: '09_aceproject/test.Vocals.wav',
    master: '09_aceproject/test.wav',
    separation: 'python-audio-separator',
    voice: { target: '测试音色', engine: 'ace-studio' },
    loudness: { iLufs: -14, toleranceLufs: 1, truePeakDbtp: -1 },
  },
  video: {
    dir: '10_video',                       // ← 新歌默认布局，与《未来再见》不同
    aspect: '9:16',                        // ← 不同画幅
    baseRes: '768P',
    baseSize: [768, 1344],
    deliverRes: [{ name: '1080p', size: [1080, 1920], method: 'realesrgan-x2-then-downsample', tag: '1080' }],
    model: 'MiniMax-H3',
    pricePerSecond: 0.5,
    maxPromptChars: 7000,
    promptStyleSuffix: '2D anime animation frame, cel-shaded, clean line art',
    subtitle: { font: 'Microsoft YaHei', size: 48, minDisplaySec: 3.0, lineLevel: true, followMeasuredOnset: true },
    transition: 'cut',
    segMaxSec: 12,                         // ← 与《未来再见》的 15 不同，用来验证配置真的生效
  },
  credits: {
    original: { 词: '测试词', 曲: '测试曲' },
    thisVersion: { 改词: 'TEST', tools: [{ role: '视频生成', name: 'MiniMax-H3' }], disclaimer: 'AI 生成 · 非商用' },
  },
  budget: { totalCny: 20, spentCny: 0, authorized: false, authorizationNote: '换歌验证：不花钱' },
  cover: { title: SONG, subtitle: '换歌验证', preset: 'A', sizes: [[1146, 717]], logos: [] },
}
fs.writeFileSync(path.join(SHELL, '翻填项目.json'), JSON.stringify(cfg, null, 2), 'utf8')

// 15 句 LRC，均匀铺在 0–28s（第一句起在 3s，避开"曲目信息行"判定）
const lines = []
for (let i = 0; i < 15; i++) {
  const t = 3 + i * 1.8
  const m = Math.floor(t / 60)
  const s = (t - m * 60).toFixed(2).padStart(5, '0')
  lines.push(`[0${m}:${s}]测试歌词第${i + 1}句`)
}
fs.writeFileSync(path.join(SHELL, 'music/test.lrc'),
  `[ti:${SONG}]\n[ar:测试]\n[by:换歌验证]\n[offset:0]\n` + lines.join('\n') + '\n', 'utf8')
console.log(`   ✅ 配置 + LRC（15 句）`)

step(3, '合成测试音频（30s 正弦 + 静音间隙，供 VAD/切分用）')
// 用「正弦爆发 + 静音」交替，制造真实的"静音谷"，让边界吸附有东西可抓
const af = 'sine=frequency=440:duration=1.2,volume=0.5'
const parts = []
for (let t = 3; t < 28; t += 1.8) parts.push(`-f lavfi -i "aevalsrc=0.4*sin(2*PI*440*t)*between(t,${t.toFixed(2)},${(t + 1.2).toFixed(2)}):s=8000:d=${TOTAL}"`)
const r = await run(FFMPEG, [
  '-v', 'error', '-y',
  ...parts.flatMap((p) => p.split(' ')),
  '-filter_complex', `${Array.from({ length: parts.length }, (_, i) => `[${i}:a]`).join('')}amix=inputs=${parts.length}:normalize=0[a]`,
  '-map', '[a]', '-ac', '1', '-ar', '8000', path.join(SHELL, '09_aceproject/test.Vocals.wav'),
], SHELL)
if (r.code !== 0) { console.log('   ⚠ 多输入合成失败，退回单路生成：', r.stderr.slice(0, 200))
  const r2 = await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi',
    '-i', `aevalsrc=0.4*sin(2*PI*440*t)*between(mod(t\\,1.8)\\,0\\,1.2):s=8000:d=${TOTAL}`,
    '-ac', '1', '-ar', '8000', path.join(SHELL, '09_aceproject/test.Vocals.wav')], SHELL)
  if (r2.code !== 0) { console.log('   ❌ 音频合成失败：', r2.stderr.slice(0, 300)); process.exit(1) }
}
fs.copyFileSync(path.join(SHELL, '09_aceproject/test.Vocals.wav'), path.join(SHELL, '09_aceproject/test.wav'))
const dur = fs.statSync(path.join(SHELL, '09_aceproject/test.wav')).size
console.log(`   ✅ 测试音频（${(dur / 1024).toFixed(0)} KB）`)

step(4, '跑 80 --plan（应读到新配置、不报错、不写产物）')
const plan = await run('node', ['scripts/80_pv_shotlist.mjs', '--plan', '--boundaries', '0,9,18,27'], SHELL)
console.log('   exit=' + plan.code)
for (const l of plan.stdout.split('\n').filter((l) => l.trim()).slice(0, 6)) console.log('   ' + l)
if (plan.code !== 0) { console.log('   ❌ --plan 失败\n' + plan.stderr.slice(0, 800)); process.exit(1) }

step(5, '实跑 80（应产出分镜到 10_video/plan，且校验全通）')
const real = await run('node', ['scripts/80_pv_shotlist.mjs', '--boundaries', '0,9,18,27'], SHELL)
console.log('   exit=' + real.code)
for (const l of real.stderr.split('\n').filter((l) => l.trim()).slice(-8)) console.log('   ' + l)
if (real.code !== 0) { console.log('   ❌ 实跑失败'); process.exit(1) }

step(6, '检查产物与配置是否真的生效')
const planDir = path.join(SHELL, '10_video/plan')
const seg = JSON.parse(fs.readFileSync(path.join(planDir, 'segments.json'), 'utf8'))
const got = {
  '产物落在 video.dir 指定的 10_video（不是硬编码的 10_h3video）': fs.existsSync(planDir),
  'segments.json 段数 > 0': seg.segments.length > 0,
  '每段 ≤ video.segMaxSec(=12)': seg.segments.every((s) => s.dur <= 12.0001),
  '单价取自配置（0.5）': seg.pricePerSecond === 0.5,
  '分辨率档取自配置（768P）': seg.resolution === '768P',
  'prompt 骨架落在 10_video/prompts': fs.existsSync(path.join(SHELL, '10_video/prompts')),
  'shotlist.draft.json 已生成（换歌数据可复用）': fs.existsSync(path.join(planDir, 'shotlist.draft.json')),
  'problems 为空': seg.problems.length === 0,
}
let allOk = true
for (const [k, v] of Object.entries(got)) { if (!v) allOk = false; console.log(`   ${v ? '✅' : '❌'} ${k}`) }
console.log(`   段数 ${seg.segments.length}｜生成总秒 ${seg.totals.generatedSeconds}｜预估 ¥${seg.totals.estimatedCny}`)
console.log(`   边界：${seg.segments.map((s) => `${s.start}–${s.end}`).join('  ')}`)

step(7, '跑 80b 自检（新歌无 prompt 内容，应如实报"缺字段"而不是崩）')
const chk = await run('node', ['scripts/80b_check_prompts.mjs'], SHELL)
console.log('   exit=' + chk.code + '（骨架未填充 → 非 0 是**正确**行为，说明自检真的在检）')
console.log('   ' + chk.stdout.split('\n').filter((l) => l.trim()).slice(-1)[0])

console.log('\n' + '='.repeat(64))
console.log(allOk ? '✅ 换歌验证通过：新歌空壳目录可跑到"分镜"阶段且零报错' : '❌ 换歌验证未通过，见上面 ❌ 项')
console.log('='.repeat(64))

// 保留目录供人工复核；路径打印出来
console.log(`\n验证工作区（可删）：${SHELL}`)
if (!allOk) process.exit(1)
