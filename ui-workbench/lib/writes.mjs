/**
 * 翻填工作台 · 写层（全部写操作集中在这里，便于审计）
 *
 * 纪律（对应项目 AGENTS.md 与《翻填项目配置规范》）：
 *   1. **绝不覆盖**：任何落盘先过 nonClobber，冲突加 `-2`/`-3`。
 *   2. **改配置先备份**：写 翻填项目.json 前备份到 dev/_probe/backup/config/，并用
 *      sha256 + mtime 做乐观锁（别人改过就 409，不硬写）。
 *   3. **只写该写的**：槽目标目录、翻填项目.json、_进度/工作台状态.json、新建歌骨架。
 *      永不写 _进度/进度.md、成本台账.csv、保护区素材。
 *   4. **失败即清理**：流式写盘中途失败或超限，删掉半成品临时文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { SONG_SKELETON_DIRS, relOf, resolveIn, statSafe, readJsonSafe } from './state.mjs'

export const DEFAULT_MAX_UPLOAD_BYTES = 512 * 1024 * 1024

/** 目标存在就加 -2/-3…（与 scripts/lib/fanfill-config.mjs 的 nonClobber 同规则）。 */
export function nonClobber(abs) {
  if (!fs.existsSync(abs)) return abs
  const dir = path.dirname(abs)
  const ext = path.extname(abs)
  const stem = path.basename(abs, ext)
  for (let i = 2; i < 1000; i += 1) {
    const candidate = path.join(dir, `${stem}-${i}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error(`无法为 ${abs} 找到不冲突的名字（已试到 -999）`)
}

export function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 建目录（幂等）。 */
export function ensureDir(abs) {
  fs.mkdirSync(abs, { recursive: true })
  return abs
}

/**
 * 把请求体流式写进目标文件（先写临时文件，成功后 rename）。
 *
 * 关键顺序（独立核验 M3）：**先让调用方把响应写出去，再销毁请求流**。
 * 之前的写法是"一超限就 req.destroy()"，结果浏览器只拿到 ECONNRESET，看不到 413 那条原因。
 *
 * @param {object} opts
 * @param {number} [opts.maxBytes]
 * @param {(info: {bytes: number, maxBytes: number}) => Promise<void>|void} [opts.onOversize]
 *        超限时先执行它（调用方在这里写 413 响应），然后再断流。
 * @returns {Promise<{ok: true, path: string, bytes: number, mtimeMs: number} | {ok: false, error: string, oversize?: boolean, responded?: boolean}>}
 */
export async function streamRequestToFile(req, targetAbs, { maxBytes = DEFAULT_MAX_UPLOAD_BYTES, onOversize } = {}) {
  const dir = path.dirname(targetAbs)
  ensureDir(dir)
  const finalAbs = nonClobber(targetAbs)
  const tmpAbs = `${finalAbs}.part-${process.pid}-${Date.now()}`
  let bytes = 0
  let aborted = null
  const cleanup = () => { try { fs.rmSync(tmpAbs, { force: true }) } catch { /* ignore */ } }
  try {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmpAbs)
      let stopped = false
      req.on('data', (chunk) => {
        if (stopped) return
        bytes += chunk.length
        if (bytes > maxBytes) {
          stopped = true
          aborted = { ok: false, error: `文件超过上限 ${maxBytes} 字节`, oversize: true, responded: !!onOversize }
          req.pause()
          Promise.resolve(onOversize ? onOversize({ bytes, maxBytes }) : undefined)
            .catch(() => {})
            .then(() => {
              try { ws.destroy(new Error('oversize')) } catch { /* ignore */ }
              resolve()          // 不走 rename；由下面的 aborted 分支收尾
            })
          return
        }
        if (!ws.write(chunk)) req.pause()
      })
      ws.on('drain', () => req.resume())
      req.on('end', () => ws.end())
      req.on('error', (e) => { if (!aborted) aborted = { ok: false, error: `上传中断：${e.message}` }; ws.destroy() })
      ws.on('error', (e) => { if (aborted) resolve(); else reject(e) })
      ws.on('close', () => { if (aborted) { cleanup(); resolve() } else resolve() })
    })
    if (aborted) { cleanup(); return aborted }
    fs.renameSync(tmpAbs, finalAbs)
    const st = statSafe(finalAbs)
    return { ok: true, path: finalAbs, bytes: st.bytes ?? bytes, mtimeMs: st.mtimeMs ?? Date.now() }
  } catch (error) {
    cleanup()
    return aborted || { ok: false, error: String((error && error.message) || error) }
  }
}

/** 把工作区里已有的文件复制进目标目录（就地指定时不需要复制）。 */
export function copyInto(sourceAbs, targetDirAbs, name, { maxBytes = DEFAULT_MAX_UPLOAD_BYTES } = {}) {
  const st = statSafe(sourceAbs)
  if (!st.exists || st.isDir) return { ok: false, error: `源文件不存在：${sourceAbs}` }
  if (st.bytes > maxBytes) return { ok: false, error: `文件超过上限 ${maxBytes} 字节` }
  ensureDir(targetDirAbs)
  const finalAbs = nonClobber(path.join(targetDirAbs, name || path.basename(sourceAbs)))
  fs.copyFileSync(sourceAbs, finalAbs)
  const out = statSafe(finalAbs)
  return { ok: true, path: finalAbs, bytes: out.bytes ?? st.bytes, mtimeMs: out.mtimeMs ?? Date.now() }
}

// ── 配置写回 ────────────────────────────────────────────────────────────────

const WRITABLE_TOP = new Set(['schema', '$schema', 'song', 'audio', 'video', 'credits', 'budget', 'cover'])

function deepMerge(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out = (target && typeof target === 'object' && !Array.isArray(target)) ? { ...target } : {}
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v)
  return out
}

/**
 * 合并写 翻填项目.json：乐观锁 + 备份 + 原子写。
 * @param {object} args
 * @param {string} args.songRoot
 * @param {object} args.patch
 * @param {{sha256?: string, mtimeMs?: number}} [args.expect]
 * @param {string} args.backupDir
 * @returns {{ok: boolean, code?: number, error?: string, backup?: string, sha256?: string}}
 */
export function patchConfig({ songRoot, patch, expect, backupDir }) {
  const abs = path.join(songRoot, '翻填项目.json')
  const before = readJsonSafe(abs)
  if (before.__missing) return { ok: false, code: 404, error: '这首歌还没有 翻填项目.json' }
  if (before.__error) return { ok: false, code: 422, error: `翻填项目.json 解析失败：${before.__error}` }
  const text = fs.readFileSync(abs, 'utf8')
  const sha = sha256Text(text)
  const mtimeMs = statSafe(abs).mtimeMs
  if (expect && ((expect.sha256 && expect.sha256 !== sha) || (expect.mtimeMs && Math.abs(expect.mtimeMs - mtimeMs) > 1))) {
    return { ok: false, code: 409, error: '配置在别处被改过（内容或时间戳不一致），请刷新后重试' }
  }
  if (!patch || typeof patch !== 'object') return { ok: false, code: 400, error: 'patch 必须是对象' }
  for (const key of Object.keys(patch)) {
    if (!WRITABLE_TOP.has(key)) return { ok: false, code: 400, error: `不允许写顶层键：${key}` }
  }
  const merged = deepMerge(before, patch)
  ensureDir(backupDir)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupAbs = nonClobber(path.join(backupDir, `翻填项目-${path.basename(songRoot)}-${stamp}.json`))
  fs.copyFileSync(abs, backupAbs)
  const tmp = `${abs}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, abs)
  const after = sha256Text(fs.readFileSync(abs, 'utf8'))
  return { ok: true, backup: backupAbs, sha256: after, mtimeMs: statSafe(abs).mtimeMs }
}

/** 人工勾选/备注写入 _进度/工作台状态.json（工作台自己拥有的文件，不与 agent 抢进度文档）。 */
export function patchTicks({ songRoot, ticks }) {
  const abs = path.join(songRoot, '_进度', '工作台状态.json')
  const cur = readJsonSafe(abs)
  const base = (cur && !cur.__missing && !cur.__error) ? cur : { schema: 1, ticks: {} }
  const merged = { ...base, schema: 1, ticks: { ...(base.ticks || {}), ...(ticks || {}) }, updatedAt: new Date().toISOString() }
  ensureDir(path.dirname(abs))
  const tmp = `${abs}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, abs)
  return { ok: true, path: abs, ticks: merged.ticks }
}

// ── 新建歌骨架 ──────────────────────────────────────────────────────────────

const PV_SCRIPT_RE = /^(80b?|8[1-7])_[a-z0-9_]+\.mjs$/i

const PROGRESS_TEMPLATE = (name, source) => `# ${name} · 制作进度

> **最后更新**：${new Date().toISOString().slice(0, 16).replace('T', ' ')}
> **当前阶段**：阶段 1 · 素材盘点与配置（未开始）
> **累计花费**：¥0.00 ｜ **预算**：见 翻填项目.json

## 一、阶段总表

| # | 阶段 | 状态 | 产物 | 验收 |
|---|---|---|---|---|
| 1 | 素材盘点 | ⏸ | 翻填项目.json、素材入库 | 六键齐全、必填素材齐 |
| 2 | 人声/伴奏分离 | ⏸ | 02_stems/ | 伴奏 + 人声两轨 |
| 3 | 扒谱 / 对齐版 MIDI | ⏸ | 03_midi/ | 按目标 BPM 写 tick |
| 4 | 出人声 | ⏸ | 09_aceproject/ | 声库渲染 + 回读校验 |
| 5 | 换音色（可选） | ⏸ | 06_svc/ | 需要才做 |
| 6 | 混音 + 响度 | ⏸ | 音乐母版 | −14 LUFS ±1 / TP ≤ −1 dBTP |
| 7 | 歌词对齐 | ⏸ | plan/lyrics_timing.csv | 逐句偏差入表 |
| 8 | 分镜 | ⏸ | plan/segments.json | 每段 ≤ segMaxSec、不切断歌词句 |
| 9 | 参考图 | ⏸ | refs/ | 去水印 + 缩放 |
| 10 | prompt 自检 | ⏸ | prompts/ | ≤ maxPromptChars |
| 11 | 出片（花钱） | ⏸ | clips/ | 逐段 ffprobe 通过、台账记全 |
| 12 | 字幕 | ⏸ | subs/ | 句数一致 |
| 13 | 合成 | ⏸ | 成片 mp4 | 规格与配置一致 |
| 14 | 超分 | ⏸ | 交付分辨率 mp4 | 同帧 1:1 对比确认更清晰 |
| 15 | 核验 | ⏸ | verify/report.md | 7 项全过 |
| 16 | 封面 | ⏸ | cover/ | 平台尺寸齐全、定稿版本记进配置 |
| 17 | 投稿文案 | ⏸ | 投稿文案.md | 署名同源 + AI 与非商用声明 |

## 二、操作日志（新→旧）

### ${new Date().toISOString().slice(0, 10)} ｜ 建项

- 由「翻填工作台」新建：原曲来源 ${source || '（未填）'}
- 目录骨架与通用 PV 脚本已就位

## 三、待用户决定

- [ ] （暂无）

## 四、变更历史

| 日期 | 变更 | 原因 |
|---|---|---|
| ${new Date().toISOString().slice(0, 10)} | 建项 | 新歌开工 |
`

/**
 * 新建一首歌的目录骨架：目录 + 通用 PV 脚本 + 技能 + 配置 + 进度文档。
 * 绝不删除、绝不复制素材与歌专用脚本（音乐链脚本里写死了本歌文件名）。
 */
export function createSongSkeleton({ root, fields = {}, templateRoot, pluginDir }) {
  const rootAbs = path.resolve(root)
  // 独立核验 L5：`name: ".."` 之类会让 path.join 把骨架建到父目录的上一级 —— 显式拦住
  const parentAbs = path.dirname(rootAbs)
  if (fields.__parentDir) {
    const expectParent = path.resolve(fields.__parentDir)
    if (parentAbs !== expectParent) {
      return { ok: false, code: 400, error: `歌名不合法：会建到 ${parentAbs}（不在你选的父目录里）` }
    }
  }
  if (fs.existsSync(rootAbs)) {
    const entries = fs.readdirSync(rootAbs)
    if (entries.length > 0) {
      return { ok: false, code: 409, error: `目录已存在且非空：${rootAbs}`, suggestion: `${rootAbs}-2` }
    }
  }
  const created = []
  for (const rel of SONG_SKELETON_DIRS) {
    ensureDir(path.join(rootAbs, rel))
    created.push(rel)
  }

  // 通用 PV 脚本（配置驱动、非歌专用）
  let copiedScripts = 0
  const srcScripts = templateRoot ? path.join(templateRoot, 'scripts') : null
  if (srcScripts && fs.existsSync(srcScripts)) {
    for (const f of fs.readdirSync(srcScripts)) {
      if (PV_SCRIPT_RE.test(f)) {
        fs.copyFileSync(path.join(srcScripts, f), path.join(rootAbs, 'scripts', f))
        copiedScripts += 1
      }
    }
    const libSrc = path.join(srcScripts, 'lib')
    if (fs.existsSync(libSrc)) {
      ensureDir(path.join(rootAbs, 'scripts', 'lib'))
      for (const f of fs.readdirSync(libSrc)) {
        fs.copyFileSync(path.join(libSrc, f), path.join(rootAbs, 'scripts', 'lib', f))
      }
    }
  }

  // 技能（让新工作区自带同一条流水线的知识）
  let copiedSkill = false
  const skillSrc = templateRoot ? path.join(templateRoot, '.agents', 'skills', 'fanfill-video-pipeline') : null
  if (skillSrc && fs.existsSync(skillSrc)) {
    fs.cpSync(skillSrc, path.join(rootAbs, '.agents', 'skills', 'fanfill-video-pipeline'), { recursive: true })
    copiedSkill = true
  }

  const name = fields.name || path.basename(rootAbs)
  const config = {
    $schema: './dev/翻填项目.schema.json',
    schema: 1,
    song: {
      name,
      source: fields.source || '',
      lrc: 'music/翻填.lrc',
      bpm: Number(fields.bpm) || 0,
      totalSec: Number(fields.totalSec) || 0,
      fps: Number(fields.fps) || 24,
    },
    audio: {
      reference: '',
      referenceLocal: '',
      instrumental: '',
      stemsVocals: '',
      aceVocal: '',
      master: '',
      separation: fields.separation || 'python-audio-separator',
      voice: { target: fields.voiceTarget || '', engine: fields.voiceEngine || 'ace-studio' },
      loudness: { iLufs: -14, toleranceLufs: 1, truePeakDbtp: -1 },
    },
    video: {
      dir: '10_video',
      aspect: fields.aspect || '16:9',
      baseRes: '768P',
      baseSize: [1344, 768],
      deliverRes: [{ name: '1080p', size: [1920, 1080], method: 'realesrgan-x2-then-downsample', tag: '1080' }],
      model: 'MiniMax-H3',
      pricePerSecond: Number(fields.pricePerSecond) || 0.5,
      maxPromptChars: 7000,
      subtitle: { font: 'Microsoft YaHei', size: 54, minDisplaySec: 3, lineLevel: true, followMeasuredOnset: true },
      transition: 'cut',
      transitionDurSec: 0.4,
      segMaxSec: 15,
      cgDir: '01_input/CG',
    },
    credits: {
      original: { 词: '', 曲: '', 编曲: '', 原唱: [] },
      thisVersion: { 改词: fields.author || '', tools: [], disclaimer: '本作为非商业同人二创，全片含 AI 生成内容。原曲版权归原作者所有。' },
    },
    budget: { totalCny: Number(fields.budgetCny) || 0, spentCny: 0, authorized: false, authorizationNote: '' },
    cover: { title: name, subtitle: fields.source || '', preset: '', sizes: [[1344, 768], [1146, 717]], logos: [] },
  }
  const cfgAbs = path.join(rootAbs, '翻填项目.json')
  const tmp = `${cfgAbs}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, cfgAbs)

  fs.writeFileSync(path.join(rootAbs, '_进度', '进度.md'), PROGRESS_TEMPLATE(name, fields.source), 'utf8')
  fs.writeFileSync(path.join(rootAbs, '工作台流水线.json'), JSON.stringify({
    schema: 1,
    song: name,
    note: ['本歌的局部覆盖骨架：把这一首歌真正存在的脚本与解释器路径填进 stages.<id>.actions。', '不填也能用——通用骨架里的 PV 动作与引导照样可用。'],
    stages: {},
  }, null, 2) + '\n', 'utf8')

  return {
    ok: true,
    root: rootAbs,
    createdDirs: created.length,
    copiedScripts,
    copiedSkill,
    files: ['翻填项目.json', '_进度/进度.md', '工作台流水线.json'],
  }
}

/** 把新歌登记进注册表（合并语义，不删任何条目）。 */
export function upsertRegistrySong(songs, entry) {
  const key = path.resolve(entry.root).toLowerCase()
  const out = songs.filter((s) => path.resolve(s.root).toLowerCase() !== key)
  out.push({ ...entry, root: path.resolve(entry.root), addedAt: new Date().toISOString() })
  return out
}

export function forgetRegistrySong(songs, idOrRoot) {
  const key = String(idOrRoot).toLowerCase()
  return songs.map((s) => (s.id.toLowerCase() === key || path.resolve(s.root).toLowerCase() === key
    ? { ...s, hidden: true, hiddenAt: new Date().toISOString() }
    : s))
}

export { relOf, resolveIn }
