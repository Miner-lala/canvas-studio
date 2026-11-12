'use client'

/**
 * 画布这一侧的远程控制：每秒向本地服务取一次外部工具（MCP）发来的指令，
 * 用和手动操作相同的逻辑执行（建节点、连线、生成），再把结果交回去。
 * 改动会正常进撤销历史、自动保存。
 */
import { nanoid } from 'nanoid'
import { useEffect } from 'react'
import type { AssetMeta, GenSettings } from '@/lib/types'
import { defaultGen, estimateHeight, findFreeSpot, findModel, generate, makeNode, nodeHeight, settingsForModel } from './actions'
import { absolutePosition } from './graph'
import { getCanvas } from './store'
import { IMAGE_NODE_WIDTH, TEXT_NODE_WIDTH, type AppNode, type ImageNode, type TextNode } from './types'

const POLL_MS = 800

interface RemoteCommand {
  id: string
  type: string
  args: unknown
}

interface GenOptions {
  /** 模型 id 或模型名称；不填沿用画布上最近一个图片节点的设置 */
  model?: string
  aspectRatio?: string
  size?: string
  count?: number
  /** 画质、背景、格式、种子等模型参数 */
  params?: Record<string, unknown>
}

interface GenerationItem extends GenOptions {
  prompt: string
  /** 画布上已有的图片节点，作为参考图（按顺序成为 图1、图2…） */
  referenceNodeIds?: string[]
  /** 外部工具刚上传的图片，会各建一个图片节点作为参考图 */
  referenceAssets?: AssetMeta[]
}

// ---------- 参数 ----------

/** 默认沿用画布上最近一个图片节点的模型和参数（通常就是你最近在用的设置） */
function baseGen(): GenSettings {
  const s = getCanvas()
  const images = s.nodes.filter((n): n is ImageNode => n.type === 'image')
  for (let i = images.length - 1; i >= 0; i--) {
    const gen = images[i].data.gen
    if (findModel(s.providers, gen.providerId, gen.modelId)) return { ...gen, extra: { ...gen.extra } }
  }
  return defaultGen(s.providers)
}

function resolveGen(opts: GenOptions): GenSettings {
  const s = getCanvas()
  let gen = baseGen()
  if (opts.model) {
    const all = s.providers.flatMap((p) => p.models.map((m) => ({ p, m })))
    const hit = all.find(({ m }) => m.id === opts.model) ?? all.find(({ m }) => m.label === opts.model)
    if (!hit) throw new Error(`没有模型「${opts.model}」。可用：${all.map(({ m }) => m.id).join('、') || '无'}`)
    gen = settingsForModel(hit.p.id, hit.m, gen)
  }
  const found = findModel(s.providers, gen.providerId, gen.modelId)
  if (!found) throw new Error('画布上还没有可用的模型，请先在「设置」里配置')
  const { model } = found

  const pick = (name: string, value: string | undefined, allowed: string[]) => {
    if (value === undefined) return undefined
    if (!allowed.includes(value)) throw new Error(`${model.label} 的${name}不支持「${value}」，可选：${allowed.join('、')}`)
    return value
  }
  gen.aspectRatio = pick('比例', opts.aspectRatio, model.aspectRatios) ?? gen.aspectRatio
  gen.size = pick('清晰度', opts.size, model.sizes) ?? gen.size
  if (opts.count !== undefined) {
    if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > model.maxCount)
      throw new Error(`张数要在 1–${model.maxCount} 之间`)
    gen.count = opts.count
  }
  for (const [key, value] of Object.entries(opts.params ?? {})) {
    const p = model.extraParams?.find((x) => x.key === key)
    if (!p) {
      const keys = (model.extraParams ?? []).map((x) => x.key).join('、') || '无'
      throw new Error(`${model.label} 没有参数「${key}」，可用：${keys}`)
    }
    if (p.type === 'select' && !p.options?.some((o) => o.value === value))
      throw new Error(`参数「${key}」可选：${p.options?.map((o) => o.value).join('、')}`)
    gen.extra[key] = value
  }
  return gen
}

function describeGen(gen: GenSettings) {
  return { model: gen.modelId, aspectRatio: gen.aspectRatio, size: gen.size, count: gen.count, params: gen.extra }
}

// ---------- 摆放 ----------

/** 新内容放在现有内容的下方，从最左边开始 */
function startPoint() {
  const nodes = getCanvas().nodes
  if (!nodes.length) return { x: 0, y: 0 }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let minX = Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    const p = absolutePosition(n, byId)
    minX = Math.min(minX, p.x)
    maxY = Math.max(maxY, p.y + nodeHeight(n))
  }
  return { x: minX, y: maxY + 120 }
}

/** 文本节点会按内容自动长高，还没渲染时按字数估一个高度 */
function textHeight(text: string) {
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 18)), 0)
  return 60 + lines * 21
}

function imageNodeFromAsset(a: AssetMeta, position: { x: number; y: number }): ImageNode {
  const node = makeNode('image', position) as ImageNode
  const now = Date.now()
  node.data = {
    ...node.data,
    versions: [{ assetId: a.id, width: a.width, height: a.height, batchId: `upload-${nanoid(8)}`, createdAt: now }],
    current: 0,
  }
  return node
}

const ROW_GAP = 80
const COL_GAP = 100

// ---------- 指令 ----------

function snapshot() {
  const s = getCanvas()
  return {
    name: s.name,
    nodes: s.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, parentId: n.parentId, data: n.data })),
    edges: s.edges.map((e) => ({ source: e.source, target: e.target })),
  }
}

async function startGenerations(ids: string[]) {
  const out = []
  for (const id of ids) {
    const before = getCanvas().nodes.find((n) => n.id === id) as ImageNode | undefined
    if (before?.data.task) {
      out.push({ nodeId: id, started: false, error: '这个节点正在生成中，等它完成后再试' })
      continue
    }
    await generate(id)
    const node = getCanvas().nodes.find((n) => n.id === id) as ImageNode | undefined
    out.push({ nodeId: id, started: !!node?.data.task, error: node?.data.error })
  }
  return out
}

async function addGenerations(args: { items?: GenerationItem[]; generate?: boolean }) {
  const items = args.items ?? []
  if (!items.length) throw new Error('至少要有一条提示词')
  const s = getCanvas()
  const imageIds = new Set(s.nodes.filter((n) => n.type === 'image').map((n) => n.id))

  // 先全部检查一遍，有问题就一个都不加
  const plans = items.map((item, i) => {
    const prompt = (item.prompt ?? '').trim()
    if (!prompt) throw new Error(`第 ${i + 1} 条提示词是空的`)
    for (const id of item.referenceNodeIds ?? [])
      if (!imageIds.has(id)) throw new Error(`第 ${i + 1} 条：参考图节点 ${id} 不存在或不是图片节点`)
    const gen = resolveGen(item)
    const { model } = findModel(s.providers, gen.providerId, gen.modelId)!
    const refCount = (item.referenceNodeIds?.length ?? 0) + (item.referenceAssets?.length ?? 0)
    if (refCount > model.maxRefImages) throw new Error(`第 ${i + 1} 条：${model.label} 最多 ${model.maxRefImages} 张参考图`)
    if (!refCount && !model.modes.includes('t2i')) throw new Error(`第 ${i + 1} 条：${model.label} 需要参考图`)
    return { item, prompt, gen }
  })

  s.breakHistory()
  const start = startPoint()
  let cursorY = start.y
  const created = []

  for (const { item, prompt, gen } of plans) {
    // 左边一列：提示词在上，参考图依次往下；右边是生成结果。连线都从左往右，不会从别的节点下面穿过
    const refAssets = item.referenceAssets ?? []
    const refHeights = refAssets.map((a) => (IMAGE_NODE_WIDTH * a.height) / a.width)
    const textH = textHeight(prompt)
    const imageH = estimateHeight('image', gen)
    const leftW = refAssets.length ? Math.max(TEXT_NODE_WIDTH, IMAGE_NODE_WIDTH) : TEXT_NODE_WIDTH
    const leftH = textH + refHeights.reduce((sum, h) => sum + h + 40, 0)
    const rowH = Math.max(leftH, imageH)
    const rowW = leftW + COL_GAP + IMAGE_NODE_WIDTH
    const spot = findFreeSpot(start.x, cursorY, rowW, rowH)

    const leftTop = spot.y + (rowH - leftH) / 2
    const textNode = makeNode('text', { x: spot.x, y: leftTop }) as TextNode
    textNode.data = { text: prompt }
    const refNodes: ImageNode[] = []
    let refY = leftTop + textH + 40
    refAssets.forEach((a, i) => {
      refNodes.push(imageNodeFromAsset(a, { x: spot.x, y: refY }))
      refY += refHeights[i] + 40
    })
    const imageNode = makeNode('image', { x: spot.x + leftW + COL_GAP, y: spot.y + (rowH - imageH) / 2 }, gen) as ImageNode
    const refIds = [...(item.referenceNodeIds ?? []), ...refNodes.map((n) => n.id)]
    if (refIds.length) imageNode.data = { ...imageNode.data, refOrder: refIds }

    const newNodes: AppNode[] = [...refNodes, textNode, imageNode]
    s.setNodes((all) => [...all, ...newNodes])
    s.setEdges((es) => [
      ...es,
      { id: `e-${nanoid(8)}`, source: textNode.id, target: imageNode.id },
      ...refIds.map((id) => ({ id: `e-${nanoid(8)}`, source: id, target: imageNode.id })),
    ])
    created.push({
      imageNodeId: imageNode.id,
      textNodeId: textNode.id,
      referenceNodeIds: refIds,
      settings: describeGen(gen),
    })
    cursorY = spot.y + rowH + ROW_GAP
  }
  s.breakHistory()

  if (!args.generate) return created.map((c) => ({ ...c, started: false }))
  const started = await startGenerations(created.map((c) => c.imageNodeId))
  return created.map((c, i) => ({ ...c, started: started[i].started, error: started[i].error }))
}

function addImages(args: { assets?: AssetMeta[] }) {
  const assets = args.assets ?? []
  if (!assets.length) throw new Error('没有图片')
  const s = getCanvas()
  s.breakHistory()
  const start = startPoint()
  const heights = assets.map((a) => (IMAGE_NODE_WIDTH * a.height) / a.width)
  const rowW = assets.length * IMAGE_NODE_WIDTH + (assets.length - 1) * 40
  const spot = findFreeSpot(start.x, start.y, rowW, Math.max(...heights))
  const nodes = assets.map((a, i) => imageNodeFromAsset(a, { x: spot.x + i * (IMAGE_NODE_WIDTH + 40), y: spot.y }))
  s.setNodes((all) => [...all, ...nodes])
  s.breakHistory()
  return nodes.map((n) => n.id)
}

async function generateNodes(args: { nodeIds?: string[] }) {
  const ids = args.nodeIds ?? []
  const nodes = getCanvas().nodes
  for (const id of ids) {
    const n = nodes.find((x) => x.id === id)
    if (!n || n.type !== 'image') throw new Error(`节点 ${id} 不存在或不是图片节点`)
  }
  return startGenerations(ids)
}

async function run(cmd: RemoteCommand): Promise<unknown> {
  const args = (cmd.args ?? {}) as Record<string, unknown>
  switch (cmd.type) {
    case 'snapshot':
      return snapshot()
    case 'add_generations':
      return addGenerations(args)
    case 'add_images':
      return addImages(args)
    case 'generate':
      return generateNodes(args)
    default:
      throw new Error(`不认识的指令：${cmd.type}`)
  }
}

/** 挂在画布上：轮询并执行外部指令 */
export function useRemoteControl() {
  useEffect(() => {
    let busy = false
    const tick = async () => {
      const projectId = getCanvas().projectId
      if (busy || !projectId) return
      busy = true
      try {
        const res = await fetch(`/api/remote/${projectId}/poll`)
        if (!res.ok) return
        const cmds = (await res.json()) as RemoteCommand[]
        for (const cmd of cmds) {
          let reply: { ok: boolean; result?: unknown; error?: string }
          try {
            reply = { ok: true, result: await run(cmd) }
          } catch (e) {
            reply = { ok: false, error: (e as Error).message }
          }
          await fetch(`/api/remote/${projectId}/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: cmd.id, ...reply }),
          })
        }
      } catch {
        // 网络抖动，下次再取
      } finally {
        busy = false
      }
    }
    const timer = setInterval(tick, POLL_MS)
    void tick()
    return () => clearInterval(timer)
  }, [])
}

