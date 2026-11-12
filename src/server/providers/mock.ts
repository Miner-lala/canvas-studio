import sharp, { type OverlayOptions } from 'sharp'
import type { ModelSpec } from '@/lib/types'
import type { GenerateRequest, ImageOut, ImageProvider } from './types'

/**
 * Mock 模型：不调用任何外部接口，在本地画一张占位图（把提示词画进图里），
 * 用来在接真实 API 之前跑通整套流程。
 *
 * 小技巧：提示词里包含 #error 会故意失败，用来测试报错展示。
 */

const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']

const syncModel: ModelSpec = {
  id: 'mock-v1',
  label: 'Mock 图像（同步）',
  modes: ['t2i', 'i2i'],
  maxRefImages: 6,
  aspectRatios: ASPECTS,
  sizes: ['1K', '2K'],
  maxCount: 10,
  extraParams: [
    {
      // 只是演示“模型特有参数”怎么出现在面板里：决定占位图用什么颜色画，和真实出图无关
      key: 'style',
      label: '占位图配色（仅 Mock）',
      type: 'select',
      options: [
        { value: 'vivid', label: '鲜艳色' },
        { value: 'pastel', label: '柔和色' },
        { value: 'mono', label: '黑白' },
      ],
      default: 'vivid',
    },
    { key: 'seed', label: '种子', type: 'number', min: 0, max: 99999, step: 1 },
  ],
}

const asyncModel: ModelSpec = {
  id: 'mock-async-v1',
  label: 'Mock 图像（异步）',
  modes: ['t2i', 'i2i'],
  maxRefImages: 6,
  aspectRatios: ASPECTS,
  sizes: ['1K'],
  maxCount: 10,
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(signal.reason ?? new Error('已取消'))
    })
  })
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function dimensionsOf(aspectRatio: string, size: string) {
  const [w, h] = aspectRatio.split(':').map(Number)
  const long = size === '2K' ? 2048 : 1024
  const r = w / h
  const width = r >= 1 ? long : Math.round(long * r)
  const height = r >= 1 ? Math.round(long / r) : long
  const snap = (n: number) => Math.max(64, Math.round(n / 8) * 8)
  return { width: snap(width), height: snap(height) }
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
}

/** 按大致字宽折行：中日韩字符算 1，其余算 0.55 */
function wrap(text: string, maxUnits: number, maxLines: number) {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    let units = 0
    for (const ch of para) {
      const u = /[⺀-￿]/.test(ch) ? 1 : 0.55
      if (units + u > maxUnits) {
        lines.push(line)
        line = ''
        units = 0
      }
      line += ch
      units += u
    }
    lines.push(line)
  }
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines)
    cut[maxLines - 1] = cut[maxLines - 1].slice(0, -1) + '…'
    return cut
  }
  return lines
}

function palette(style: string, seed: number) {
  const hue = seed % 360
  const hue2 = (hue + 40 + (seed % 80)) % 360
  if (style === 'mono') return [`hsl(0 0% ${18 + (seed % 20)}%)`, `hsl(0 0% ${55 + (seed % 25)}%)`]
  if (style === 'pastel') return [`hsl(${hue} 60% 78%)`, `hsl(${hue2} 55% 62%)`]
  return [`hsl(${hue} 75% 45%)`, `hsl(${hue2} 80% 30%)`]
}

async function renderOne(req: GenerateRequest, index: number): Promise<ImageOut> {
  const { width, height } = dimensionsOf(req.aspectRatio, req.size)
  const style = String(req.extra.style ?? 'vivid')
  const seedBase = req.extra.seed !== undefined && req.extra.seed !== '' ? Number(req.extra.seed) : Date.now()
  const seed = hash(`${req.prompt}|${seedBase}|${index}`)
  const [c1, c2] = palette(style, seed)
  const dark = style === 'pastel' ? '#1d1d24' : '#ffffff'
  const unit = Math.min(width, height)
  const fontSize = Math.round(unit * 0.055)
  const pad = Math.round(unit * 0.07)
  const maxUnits = Math.max(6, Math.floor((width - pad * 2) / fontSize))
  const lines = wrap(req.prompt || '（无提示词）', maxUnits, 7)
  const textSvg = lines
    .map(
      (l, i) =>
        `<text x="${pad}" y="${pad + fontSize * 1.1 + i * fontSize * 1.45}" font-size="${fontSize}">${escapeXml(l)}</text>`,
    )
    .join('')
  const small = Math.round(unit * 0.03)
  const label = `MOCK · ${index + 1}/${req.count} · ${width}×${height} · ${req.aspectRatio}`
  const cx = (seed % 70) + 15
  const cy = ((seed >> 8) % 60) + 25
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
      </linearGradient>
      <radialGradient id="r" cx="${cx}%" cy="${cy}%" r="45%">
        <stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="url(#r)"/>
    <g font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" fill="${dark}" font-weight="600">${textSvg}</g>
    <text x="${pad}" y="${height - pad}" font-family="Menlo, monospace" font-size="${small}" fill="${dark}" opacity="0.75">${escapeXml(label)}</text>
  </svg>`

  let img = sharp(Buffer.from(svg))
  // 有参考图时，把参考图缩略图贴在右下角，方便确认参考图确实传进来了
  if (req.refImages.length) {
    const thumbH = Math.round(unit * 0.16)
    const gap = Math.round(unit * 0.015)
    const composites: OverlayOptions[] = []
    let x = width - pad
    for (let i = req.refImages.length - 1; i >= 0; i--) {
      const buf = await sharp(Buffer.from(req.refImages[i].base64, 'base64'))
        .rotate()
        .resize({ height: thumbH })
        .png()
        .toBuffer()
      const meta = await sharp(buf).metadata()
      x -= meta.width ?? thumbH
      if (x < pad) break
      composites.push({ input: buf, left: x, top: height - pad - thumbH - small * 2 })
      x -= gap
    }
    img = sharp(await img.png().toBuffer()).composite(composites)
  }
  const out = await img.jpeg({ quality: 88 }).toBuffer()
  return { base64: out.toString('base64') }
}

async function renderAll(req: GenerateRequest) {
  if (req.prompt.includes('#error')) throw new Error('Mock：提示词里有 #error，按要求模拟一次失败')
  const images: ImageOut[] = []
  for (let i = 0; i < req.count; i++) images.push(await renderOne(req, i))
  return images
}

/** 同步示例：请求一直等到出图 */
export const mockProvider: ImageProvider = {
  id: 'mock',
  name: 'Mock（本地占位）',
  models: [syncModel],
  async generate(req, { signal }) {
    await sleep(1500 + Math.random() * 2000, signal)
    return { images: await renderAll(req) }
  },
}

/** 异步示例：先返回任务号，框架每隔一段时间调用 poll 查结果 */
const g = globalThis as unknown as {
  __mockJobs?: Map<string, { readyAt: number; req: GenerateRequest }>
}
const jobs = (g.__mockJobs ??= new Map())

export const mockAsyncProvider: ImageProvider = {
  id: 'mock-async',
  name: 'Mock（异步任务）',
  models: [asyncModel],
  pollIntervalMs: 1000,
  async submit(req) {
    const taskId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    jobs.set(taskId, { readyAt: Date.now() + 4000 + Math.random() * 3000, req })
    return { taskId }
  },
  async poll(taskId) {
    const job = jobs.get(taskId)
    if (!job) return { status: 'error', error: '任务不存在' }
    if (Date.now() < job.readyAt) return { status: 'running' }
    jobs.delete(taskId)
    try {
      return { status: 'done', images: await renderAll(job.req) }
    } catch (e) {
      return { status: 'error', error: (e as Error).message }
    }
  },
}
