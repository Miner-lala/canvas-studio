#!/usr/bin/env node
// 画布的 MCP 服务：让 Claude 等 AI 助手直接操作画布——建项目、写提示词、连参考图、生成图片、查看结果。
//
// 它只和本机运行的画布通信（打包的 App 或 npm run dev），改动由打开着的画布页面执行，
// 所以你能在画布上实时看到，也能照常撤销。
//
// 用法见 README「让 AI 助手操作画布（MCP）」。
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// 先找打包的 App（37210），再找开发服务（3000）；也可以用环境变量 CANVAS_URL 指定
const CANDIDATES = process.env.CANVAS_URL
  ? [process.env.CANVAS_URL.replace(/\/$/, '')]
  : ['http://127.0.0.1:37210', 'http://127.0.0.1:3000']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let baseUrl = null
async function base() {
  if (baseUrl) return baseUrl
  for (const url of CANDIDATES) {
    try {
      const res = await fetch(`${url}/api/projects`, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return (baseUrl = url)
    } catch {}
  }
  throw new Error('画布没有在运行：请先打开「画布」App，或在项目目录运行 npm run dev')
}

async function api(pathname, init = {}) {
  const url = `${await base()}${pathname}`
  let res
  try {
    res = await fetch(url, init)
  } catch (e) {
    baseUrl = null // 可能换了运行方式，下次重新找
    throw new Error(`连不上画布：${e.message}`)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(json?.error || `请求失败（HTTP ${res.status}）`)
    err.status = res.status
    throw err
  }
  return json
}

const postJson = (pathname, body) =>
  api(pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ---------- 打开项目、发指令 ----------

async function isOpen(projectId) {
  return (await api(`/api/remote/${projectId}`)).open
}

/** 确保项目在画布上打开着（没开就打开，最多等 20 秒） */
async function ensureOpen(projectId) {
  if (await isOpen(projectId)) return
  const r = await postJson(`/api/remote/${projectId}/open`, {})
  if (r.open) return
  if (!r.app) {
    // 不是 App（npm run dev）：用默认浏览器打开
    execFile('open', [`${await base()}/p/${projectId}`])
  }
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    if (await isOpen(projectId)) return
  }
  throw new Error('等了 20 秒，画布还没打开这个项目。请手动在画布里打开它再试')
}

async function command(projectId, type, args = {}) {
  await ensureOpen(projectId)
  return (await postJson(`/api/remote/${projectId}`, { type, args })).result
}

async function uploadFiles(paths) {
  const assets = []
  for (const p of paths) {
    const abs = path.resolve(p)
    const buf = await readFile(abs).catch(() => {
      throw new Error(`读不到文件：${abs}`)
    })
    const form = new FormData()
    form.append('file', new Blob([buf]), path.basename(abs))
    const [meta] = await api('/api/assets', { method: 'POST', body: form })
    assets.push(meta)
  }
  return assets
}

// ---------- 画布内容摘要 ----------

function statusOf(d) {
  if (d.task) return 'running'
  if (d.error) return 'error'
  return d.versions?.length ? 'done' : 'empty'
}

function summarize(doc) {
  const incoming = new Map()
  for (const e of doc.edges ?? []) {
    if (!incoming.has(e.target)) incoming.set(e.target, [])
    incoming.get(e.target).push(e.source)
  }
  const byId = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
  const nodes = (doc.nodes ?? []).map((n) => {
    const base = { id: n.id, type: n.type, x: Math.round(n.position.x), y: Math.round(n.position.y) }
    if (n.parentId) base.group = n.parentId
    if (n.type === 'text') return { ...base, text: n.data.text }
    if (n.type === 'frame') return { ...base, label: n.data.label }
    const d = n.data
    const inputs = incoming.get(n.id) ?? []
    return {
      ...base,
      status: statusOf(d),
      error: d.error,
      promptNodes: inputs.filter((id) => byId.get(id)?.type === 'text'),
      referenceNodes: inputs.filter((id) => byId.get(id)?.type === 'image'),
      panelPrompt: d.prompt || undefined,
      settings: { model: d.gen?.modelId, aspectRatio: d.gen?.aspectRatio, size: d.gen?.size, count: d.gen?.count, params: d.gen?.extra },
      images: (d.versions ?? []).length,
      currentImage: d.versions?.[d.current]?.assetId,
    }
  })
  return { name: doc.name, nodes }
}

async function readCanvas(projectId) {
  if (await isOpen(projectId)) return command(projectId, 'snapshot')
  return api(`/api/projects/${projectId}`)
}

// ---------- 工具 ----------

const server = new McpServer({ name: 'canvas-studio', version: '0.1.0' })

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })

function tool(name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      return await handler(args)
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e.message || String(e) }] }
    }
  })
}

const projectIdSchema = z.string().describe('项目 id（用 list_projects 查）')

tool(
  'list_projects',
  { title: '列出画布项目', description: '列出画布里的所有项目（id、名称、节点数、最后修改时间）。' },
  async () => {
    const list = await api('/api/projects')
    return text(
      list.map((p) => ({
        id: p.id,
        name: p.name,
        nodes: p.nodeCount,
        updatedAt: new Date(p.updatedAt).toLocaleString('zh-CN'),
      })),
    )
  },
)

tool(
  'create_project',
  {
    title: '新建画布项目',
    description: '新建一个画布项目，并在画布里打开它。',
    inputSchema: { name: z.string().optional().describe('项目名称') },
  },
  async ({ name }) => {
    const doc = await postJson('/api/projects', { name })
    await ensureOpen(doc.id)
    return text({ id: doc.id, name: doc.name, opened: true })
  },
)

tool(
  'open_project',
  {
    title: '打开画布项目',
    description: '在画布 App（或浏览器）里打开一个项目，让用户能看到你的操作。添加内容的工具会自动打开项目，一般不用单独调用。',
    inputSchema: { projectId: projectIdSchema },
  },
  async ({ projectId }) => {
    await ensureOpen(projectId)
    return text({ projectId, opened: true })
  },
)

tool(
  'list_models',
  {
    title: '列出可用模型和参数',
    description:
      '列出画布里能用的生图模型，以及每个模型支持的比例（aspectRatio）、清晰度（size）、最大张数（maxCount）、参考图上限和其它参数（params，比如画质 quality、背景 background、格式 output_format）。传给 add_generations 的值必须是这里列出的。',
  },
  async () => {
    const providers = await api('/api/providers')
    return text(
      providers.flatMap((p) =>
        p.models.map((m) => ({
          model: m.id,
          name: m.label,
          provider: p.name,
          modes: m.modes.map((x) => (x === 't2i' ? '文生图' : '图生图')),
          maxReferenceImages: m.maxRefImages,
          aspectRatios: m.aspectRatios,
          sizes: m.sizes,
          maxCount: m.maxCount,
          params: Object.fromEntries(
            (m.extraParams ?? []).map((x) => [
              x.key,
              x.options ? { options: x.options.map((o) => o.value), default: x.default } : { type: x.type, default: x.default },
            ]),
          ),
        })),
      ),
    )
  },
)

tool(
  'get_canvas',
  {
    title: '查看画布内容',
    description:
      '查看一个项目画布上的所有节点：文本节点的提示词、图片节点的状态（empty 空 / running 生成中 / done 有图 / error 出错）、参数、连进来的提示词节点和参考图节点。',
    inputSchema: { projectId: projectIdSchema },
  },
  async ({ projectId }) => text(summarize(await readCanvas(projectId))),
)

tool(
  'add_image',
  {
    title: '放入本地图片',
    description: '把本机的图片文件放到画布上（每张一个图片节点），返回节点 id，之后可以作为参考图（referenceNodeIds）反复使用。',
    inputSchema: {
      projectId: projectIdSchema,
      paths: z.array(z.string()).min(1).max(20).describe('图片文件的路径（png / jpg / webp 等）'),
    },
  },
  async ({ projectId, paths }) => {
    const assets = await uploadFiles(paths)
    const nodeIds = await command(projectId, 'add_images', { assets })
    return text({ nodeIds })
  },
)

const generationItem = z.object({
  prompt: z.string().min(1).describe('提示词'),
  referenceNodeIds: z.array(z.string()).optional().describe('画布上已有的图片节点 id，作为参考图（顺序即 图1、图2…）'),
  referenceImagePaths: z.array(z.string()).optional().describe('本机图片路径，会先放到画布上再作为参考图'),
  model: z.string().optional().describe('模型 id（见 list_models）；不填沿用画布上最近一次的设置'),
  aspectRatio: z.string().optional().describe('比例，如 1:1、16:9；不填沿用最近一次的设置'),
  size: z.string().optional().describe('清晰度，如 1K、2K（取决于模型）'),
  count: z.number().int().min(1).optional().describe('这条提示词生成几张'),
  params: z.record(z.string(), z.unknown()).optional().describe('其它模型参数，如 { "quality": "high" }'),
})

tool(
  'add_generations',
  {
    title: '添加提示词并生成',
    description:
      '在画布上为每条提示词建一组节点：文本节点（提示词）→ 图片节点，参考图也会连上。generate 为 true 时立刻开始生成——会调用付费的生图接口，花用户的钱，张数和画质越高越贵。' +
      '只想先把提示词摆上画布、让用户审核后自己点生成，就传 generate: false。没指定的参数沿用画布上最近一次的设置。生成需要一两分钟，之后用 get_results 查看结果。',
    inputSchema: {
      projectId: projectIdSchema,
      items: z.array(generationItem).min(1).max(30).describe('每一项是一条提示词，各自生成到一个图片节点'),
      generate: z.boolean().default(true).describe('是否立刻开始生成（会产生费用）'),
    },
  },
  async ({ projectId, items, generate }) => {
    const prepared = []
    for (const item of items) {
      const { referenceImagePaths, ...rest } = item
      const referenceAssets = referenceImagePaths?.length ? await uploadFiles(referenceImagePaths) : undefined
      prepared.push({ ...rest, referenceAssets })
    }
    const result = await command(projectId, 'add_generations', { items: prepared, generate })
    return text(result)
  },
)

tool(
  'generate',
  {
    title: '生成已有的图片节点',
    description: '让画布上已有的图片节点开始生成（比如用户审核过提示词，或者重试出错的节点）。会调用付费的生图接口。',
    inputSchema: { projectId: projectIdSchema, nodeIds: z.array(z.string()).min(1).max(30).describe('图片节点 id') },
  },
  async ({ projectId, nodeIds }) => text(await command(projectId, 'generate', { nodeIds })),
)

tool(
  'get_results',
  {
    title: '查看生成结果',
    description:
      '查看图片节点的生成状态和结果；可以等待生成完成（waitSeconds），并把结果的缩略图直接返回给你看（includeImages）。每个节点返回它最近一批生成的图。',
    inputSchema: {
      projectId: projectIdSchema,
      nodeIds: z.array(z.string()).min(1).max(30).describe('图片节点 id'),
      waitSeconds: z.number().int().min(0).max(600).default(0).describe('最多等多少秒，直到这些节点都不在生成中'),
      includeImages: z.boolean().default(true).describe('是否附上结果缩略图'),
    },
  },
  async ({ projectId, nodeIds, waitSeconds, includeImages }) => {
    const deadline = Date.now() + waitSeconds * 1000
    let byId
    let taskById
    for (;;) {
      const doc = await readCanvas(projectId)
      byId = new Map(doc.nodes.map((n) => [n.id, n]))
      // 直接查任务状态：项目没打开时，结果还没写进节点，但任务本身已经完成了
      const taskIds = nodeIds.map((id) => byId.get(id)?.data?.task?.id).filter(Boolean)
      const tasks = taskIds.length ? await api(`/api/tasks?ids=${taskIds.join(',')}`) : []
      taskById = new Map(tasks.map((t) => [t.id, t]))
      const running = nodeIds.filter((id) => {
        const task = byId.get(id)?.data?.task
        return task && (!task.id || taskById.get(task.id)?.status === 'running')
      })
      if (!running.length || Date.now() >= deadline) break
      await sleep(3000)
    }

    const root = await base()
    const results = []
    const images = []
    for (const id of nodeIds) {
      const n = byId.get(id)
      if (!n || n.type !== 'image') {
        results.push({ nodeId: id, status: 'missing' })
        continue
      }
      const d = n.data
      let status = statusOf(d)
      let latest = []
      const t = d.task?.id && taskById.get(d.task.id)
      if (t && t.status !== 'running') {
        status = t.status === 'done' ? 'done' : 'error'
        latest = (t.results ?? []).map((a) => a.id)
      } else if (d.versions?.length) {
        const lastBatch = d.versions[d.versions.length - 1].batchId
        latest = d.versions.filter((v) => v.batchId === lastBatch).map((v) => v.assetId)
      }
      results.push({
        nodeId: id,
        status,
        error: (t && t.error) || d.error,
        latestImages: latest.map((assetId) => ({ assetId, original: `${root}/api/assets/${assetId}` })),
        totalImages: d.versions?.length ?? 0,
      })
      if (includeImages && status !== 'running') for (const assetId of latest) images.push({ nodeId: id, assetId })
    }

    const content = [{ type: 'text', text: JSON.stringify(results, null, 2) }]
    const MAX_IMAGES = 12
    for (const img of images.slice(0, MAX_IMAGES)) {
      try {
        const res = await fetch(`${root}/api/assets/${img.assetId}?thumb=1`)
        if (!res.ok) continue
        content.push({ type: 'text', text: `节点 ${img.nodeId} · ${img.assetId}` })
        content.push({ type: 'image', data: Buffer.from(await res.arrayBuffer()).toString('base64'), mimeType: 'image/webp' })
      } catch {}
    }
    if (images.length > MAX_IMAGES) content.push({ type: 'text', text: `还有 ${images.length - MAX_IMAGES} 张没附上，可以分批查询` })
    return { content }
  },
)

await server.connect(new StdioServerTransport())
