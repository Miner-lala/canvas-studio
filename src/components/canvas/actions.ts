'use client'

import { nanoid } from 'nanoid'
import type { AssetMeta, GenerateBody, GenSettings, ModelSpec, ProviderInfo } from '@/lib/types'
import { absolutePosition, getInputs, parseRatio } from './graph'
import { getCanvas } from './store'
import {
  IMAGE_NODE_WIDTH,
  TEXT_NODE_WIDTH,
  type AppEdge,
  type AppNode,
  type FrameNode,
  type ImageNode,
  type ImageNodeData,
  type NodeKind,
  type TextNode,
} from './types'

// ---------- 模型和参数 ----------

export function findModel(providers: ProviderInfo[], providerId: string, modelId: string) {
  const provider = providers.find((p) => p.id === providerId)
  const model = provider?.models.find((m) => m.id === modelId)
  return provider && model ? { provider, model } : null
}

function extraDefaults(model: ModelSpec) {
  const extra: Record<string, unknown> = {}
  for (const p of model.extraParams ?? []) if (p.default !== undefined) extra[p.key] = p.default
  return extra
}

/** 切换模型时，尽量保留原来的比例/分辨率/张数，不支持的换成默认值 */
export function settingsForModel(providerId: string, model: ModelSpec, prev?: GenSettings): GenSettings {
  const keepExtra: Record<string, unknown> = {}
  const allowed = new Set((model.extraParams ?? []).map((p) => p.key))
  for (const [k, v] of Object.entries(prev?.extra ?? {})) if (allowed.has(k)) keepExtra[k] = v
  return {
    providerId,
    modelId: model.id,
    aspectRatio: prev && model.aspectRatios.includes(prev.aspectRatio) ? prev.aspectRatio : model.aspectRatios[0],
    size: prev && model.sizes.includes(prev.size) ? prev.size : model.sizes[0],
    count: Math.min(prev?.count ?? 1, model.maxCount),
    extra: { ...extraDefaults(model), ...keepExtra },
  }
}

export function defaultGen(providers: ProviderInfo[]): GenSettings {
  const p = providers[0]
  const m = p?.models[0]
  if (!p || !m) return { providerId: '', modelId: '', aspectRatio: '1:1', size: '1K', count: 1, extra: {} }
  return settingsForModel(p.id, m)
}

// ---------- 新建节点 ----------

export function estimateHeight(kind: NodeKind, gen?: GenSettings) {
  if (kind === 'text') return 150
  return IMAGE_NODE_WIDTH / parseRatio(gen?.aspectRatio ?? '1:1')
}

export function makeNode(kind: NodeKind, position: { x: number; y: number }, gen?: GenSettings): AppNode {
  const id = nanoid(10)
  if (kind === 'text') {
    return { id, type: 'text', position, data: { text: '' } } satisfies TextNode
  }
  const data: ImageNodeData = {
    versions: [],
    current: 0,
    prompt: '',
    gen: gen ?? defaultGen(getCanvas().providers),
  }
  return { id, type: 'image', position, data } satisfies ImageNode
}

/** 加节点并只选中它（选中图片节点会自动弹出生成面板） */
export function addNodeSelected(node: AppNode, edges: { source: string; target: string }[] = []) {
  const s = getCanvas()
  s.breakHistory()
  s.setNodes((nodes) => [...nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...node, selected: true }])
  s.setFocusNode(node.id)
  if (edges.length) {
    s.setEdges((es) => [...es, ...edges.map((e) => ({ id: `e-${nanoid(8)}`, ...e }))])
  }
}

export function nodeWidth(n: AppNode) {
  return n.measured?.width ?? n.width ?? (n.type === 'text' ? TEXT_NODE_WIDTH : IMAGE_NODE_WIDTH)
}
export function nodeHeight(n: AppNode) {
  if (n.measured?.height) return n.measured.height
  if (n.height) return n.height
  // 刚建的节点还没量到尺寸时，按内容估算
  if (n.type === 'image') {
    const d = (n as ImageNode).data
    const v = d.versions[d.current]
    return v ? (IMAGE_NODE_WIDTH * v.height) / v.width : estimateHeight('image', d.gen)
  }
  return n.type === 'text' ? 98 : 200
}

/** 从 (x, y) 开始往下找一块不和现有节点重叠的位置 */
export function findFreeSpot(x: number, y: number, w: number, h: number) {
  const s = getCanvas()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const rects = s.nodes.map((n) => {
    const p = absolutePosition(n, byId)
    return { x: p.x, y: p.y, w: nodeWidth(n), h: nodeHeight(n) }
  })
  const M = 30 // 节点之间至少留出的间距（含上方标签）
  for (let i = 0; i < 100; i++) {
    const hit = rects.find((r) => x < r.x + r.w + M && x + w + M > r.x && y < r.y + r.h + M && y + h + M > r.y)
    if (!hit) break
    y = hit.y + hit.h + M + 10
  }
  return { x, y }
}

/** 「以此图继续生成」：在右侧新建一个图片节点，并把当前图连过去作为参考图 */
export function continueFrom(nodeId: string) {
  const s = getCanvas()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const src = byId.get(nodeId)
  if (!src || src.type !== 'image') return
  const pos = absolutePosition(src, byId)
  const gen = { ...(src as ImageNode).data.gen }
  const spot = findFreeSpot(pos.x + nodeWidth(src) + 120, pos.y, IMAGE_NODE_WIDTH, estimateHeight('image', gen))
  const node = makeNode('image', spot, gen)
  addNodeSelected(node, [{ source: nodeId, target: node.id }])
}

// ---------- 上传的图片 ----------

function uploadVersions(assets: AssetMeta[]) {
  const batchId = `upload-${nanoid(8)}`
  const now = Date.now()
  return assets.map((a) => ({ assetId: a.id, width: a.width, height: a.height, batchId, createdAt: now }))
}

function imageNodeWith(asset: AssetMeta, position: { x: number; y: number }): ImageNode {
  const node = makeNode('image', position) as ImageNode
  node.data = { ...node.data, versions: uploadVersions([asset]), current: 0 }
  return node
}

const ROW_GAP = 40

/** 上传的图片各建一个图片节点，以 center 为中心排成一行，并选中它们 */
export function createImageNodesFromAssets(
  assets: AssetMeta[],
  center: { x: number; y: number },
  /** true：位置被占了就往下找空位（粘贴、工具栏上传时用；拖入时放在松手的位置） */
  avoidOverlap = false,
) {
  if (!assets.length) return
  const W = IMAGE_NODE_WIDTH
  const heights = assets.map((a) => (W * a.height) / a.width)
  const total = assets.length * W + (assets.length - 1) * ROW_GAP
  const maxH = Math.max(...heights)
  let origin = { x: center.x - total / 2, y: center.y - maxH / 2 }
  if (avoidOverlap) origin = findFreeSpot(origin.x, origin.y, total, maxH)
  const nodes = assets.map((a, i) => imageNodeWith(a, { x: origin.x + i * (W + ROW_GAP), y: origin.y }))
  const s = getCanvas()
  s.breakHistory()
  s.setNodes((all) => [...all.map((n) => (n.selected ? { ...n, selected: false } : n)), ...nodes.map((n) => ({ ...n, selected: true }))])
}

/** 图片放进已有的图片节点：追加为新版本并切换过去 */
export function addVersionsToNode(nodeId: string, assets: AssetMeta[]) {
  if (!assets.length) return
  getCanvas().breakHistory()
  getCanvas().updateNodeData<ImageNode>(nodeId, (d) => ({
    versions: [...d.versions, ...uploadVersions(assets)],
    current: d.versions.length,
    error: undefined,
  }))
}

/** 生成面板里上传参考图：在目标节点左边建图片节点，并连到目标节点上 */
export function addUploadedRefs(targetId: string, assets: AssetMeta[]) {
  const s = getCanvas()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const target = byId.get(targetId)
  if (!target || !assets.length) return
  s.breakHistory()
  const pos = absolutePosition(target, byId)
  const W = IMAGE_NODE_WIDTH
  const created: ImageNode[] = []
  let y = pos.y
  for (const a of assets) {
    const h = (W * a.height) / a.width
    const spot = findFreeSpot(pos.x - W - 140, y, W, h)
    const node = imageNodeWith(a, spot)
    created.push(node)
    // 先放进节点列表，下一张找空位时会避开它
    s.setNodes((all) => [...all, node])
    y = spot.y + h + ROW_GAP
  }
  s.setEdges((es) => [...es, ...created.map((n) => ({ id: `e-${nanoid(8)}`, source: n.id, target: targetId }))])
}

/** 面板里拖动参考图调整顺序 */
export function setRefOrder(nodeId: string, order: string[]) {
  getCanvas().breakHistory()
  getCanvas().updateNodeData<ImageNode>(nodeId, { refOrder: order })
}

/** 断开某张参考图（删掉连线，节点保留） */
export function disconnectRef(sourceId: string, targetId: string) {
  getCanvas().breakHistory()
  getCanvas().setEdges((es) => es.filter((e) => !(e.source === sourceId && e.target === targetId)))
}

// ---------- 生成 ----------

function setError(nodeId: string, error: string) {
  getCanvas().patchNodeEverywhere<ImageNode>(nodeId, { task: undefined, error })
}

export async function generate(nodeId: string) {
  const s = getCanvas()
  const node = s.nodes.find((n) => n.id === nodeId) as ImageNode | undefined
  if (!node || node.type !== 'image' || node.data.task) return
  const { gen } = node.data
  const found = findModel(s.providers, gen.providerId, gen.modelId)
  if (!found) return setError(nodeId, '请先选择模型')
  const { model } = found

  const inputs = getInputs(nodeId, s.nodes, s.edges)
  const prompt = [...inputs.texts.map((t) => t.text.trim()), node.data.prompt.trim()].filter(Boolean).join('\n')
  const refAssetIds = inputs.images.map((i) => i.version.assetId)

  if (inputs.emptyImages.length) return setError(nodeId, '有连进来的图片节点还没有图片')
  if (!prompt && refAssetIds.length === 0) return setError(nodeId, '先写提示词，或连一个文本节点')
  if (refAssetIds.length && !model.modes.includes('i2i')) return setError(nodeId, `${model.label} 不支持参考图`)
  if (!refAssetIds.length && !model.modes.includes('t2i')) return setError(nodeId, `${model.label} 需要参考图`)
  if (refAssetIds.length > model.maxRefImages)
    return setError(nodeId, `${model.label} 最多 ${model.maxRefImages} 张参考图，现在连了 ${refAssetIds.length} 张`)

  s.patchNodeEverywhere<ImageNode>(nodeId, { task: { id: '', startedAt: Date.now(), count: gen.count }, error: undefined })

  const body: GenerateBody = {
    projectId: s.projectId!,
    nodeId,
    providerId: gen.providerId,
    modelId: gen.modelId,
    prompt,
    refAssetIds,
    aspectRatio: gen.aspectRatio,
    size: gen.size,
    count: gen.count,
    extra: gen.extra,
  }
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `请求失败 ${res.status}`)
    getCanvas().patchNodeEverywhere<ImageNode>(nodeId, (d) => ({ task: d.task && { ...d.task, id: json.taskId } }))
  } catch (e) {
    setError(nodeId, (e as Error).message)
  }
}

export async function cancelGenerate(nodeId: string) {
  const node = getCanvas().nodes.find((n) => n.id === nodeId) as ImageNode | undefined
  const taskId = node?.data.task?.id
  if (!taskId) return
  await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' }).catch(() => {})
}

export interface TaskPollResult {
  id: string
  status: 'running' | 'done' | 'error'
  results?: AssetMeta[]
  error?: string
}

/** 轮询拿到结果后写回节点：新图追加为新版本，并切到这批的第一张 */
export function applyTaskResult(t: TaskPollResult) {
  const s = getCanvas()
  // 节点可能因为撤销暂时不在画布上，也要在历史里找到它，结果才不会丢
  const hasTask = (n: AppNode) => n.type === 'image' && (n as ImageNode).data.task?.id === t.id
  const node = [s.nodes, ...s.past.map((h) => h.nodes), ...s.future.map((h) => h.nodes)]
    .map((list) => list.find(hasTask))
    .find(Boolean)
  if (!node) return
  if (t.status === 'done' && t.results?.length) {
    const now = Date.now()
    s.patchNodeEverywhere<ImageNode>(node.id, (d) => ({
      versions: [
        ...d.versions,
        ...t.results!.map((a) => ({ assetId: a.id, width: a.width, height: a.height, batchId: t.id, createdAt: now })),
      ],
      current: d.versions.length,
      task: undefined,
      error: undefined,
    }))
  } else {
    s.patchNodeEverywhere<ImageNode>(node.id, { task: undefined, error: t.error || '生成失败' })
  }
}

// ---------- 把节点里叠着的图平铺开 ----------

const FRAME_PAD = 20
const FRAME_TITLE = 48
const ITEM_GAP_X = 24
const ITEM_GAP_Y = 40 // 留出节点上方标签的位置

/** 把图片节点里叠着的所有图，在旁边排成一排独立的图片节点（放进一个分组） */
export function tileVersions(nodeId: string) {
  const s = getCanvas()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const src = byId.get(nodeId) as ImageNode | undefined
  if (!src || src.type !== 'image') return
  const batch = src.data.versions
  if (batch.length < 2) return

  const cols = batch.length // 一排放下
  const W = IMAGE_NODE_WIDTH
  const heights = batch.map((v) => (W * v.height) / v.width)
  const rows: number[] = []
  batch.forEach((_, i) => {
    const r = Math.floor(i / cols)
    rows[r] = Math.max(rows[r] ?? 0, heights[i])
  })

  const frameId = nanoid(10)
  const children: ImageNode[] = batch.map((v, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const y = FRAME_TITLE + FRAME_PAD + rows.slice(0, row).reduce((a, h) => a + h + ITEM_GAP_Y, 0)
    return {
      id: nanoid(10),
      type: 'image',
      parentId: frameId,
      position: { x: FRAME_PAD + col * (W + ITEM_GAP_X), y },
      data: {
        versions: [v],
        current: 0,
        prompt: src.data.prompt,
        gen: { ...src.data.gen },
      },
    }
  })
  const width = FRAME_PAD * 2 + cols * W + (cols - 1) * ITEM_GAP_X
  const height = FRAME_TITLE + FRAME_PAD * 2 + rows.reduce((a, h) => a + h, 0) + (rows.length - 1) * ITEM_GAP_Y

  const pos = absolutePosition(src, byId)
  const frame: FrameNode = {
    id: frameId,
    type: 'frame',
    position: findFreeSpot(pos.x + nodeWidth(src) + 100, pos.y - FRAME_TITLE - FRAME_PAD, width, height),
    width,
    height,
    data: { label: `平铺 · ${batch.length} 张` },
    selected: true,
  }
  // 分组节点必须排在子节点前面
  s.breakHistory()
  s.setNodes((nodes) => [...nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), frame, ...children])
}

// ---------- 分组 ----------

type Rect = { x: number; y: number; w: number; h: number }

function rectOf(n: AppNode, byId: Map<string, AppNode>): Rect {
  const p = absolutePosition(n, byId)
  return { x: p.x, y: p.y, w: nodeWidth(n), h: nodeHeight(n) }
}

const deselectAll = (nodes: AppNode[]) => nodes.map((n) => (n.selected ? { ...n, selected: false } : n))

/** 让分组框把里面的节点都框住（只放大，不缩小） */
function fitFrames(nodes: AppNode[], frameIds: Set<string>): AppNode[] {
  let result = nodes
  for (const fid of frameIds) {
    const frame = result.find((n) => n.id === fid)
    const kids = result.filter((n) => n.parentId === fid)
    if (!frame || !kids.length) continue
    const minX = Math.min(...kids.map((k) => k.position.x))
    const minY = Math.min(...kids.map((k) => k.position.y))
    const maxX = Math.max(...kids.map((k) => k.position.x + nodeWidth(k)))
    const maxY = Math.max(...kids.map((k) => k.position.y + nodeHeight(k)))
    const dx = Math.max(0, FRAME_PAD - minX)
    const dy = Math.max(0, FRAME_TITLE + FRAME_PAD - minY)
    const w = Math.max(nodeWidth(frame) + dx, maxX + dx + FRAME_PAD)
    const h = Math.max(nodeHeight(frame) + dy, maxY + dy + FRAME_PAD)
    if (!dx && !dy && w === nodeWidth(frame) && h === nodeHeight(frame)) continue
    result = result.map((n) => {
      if (n.id === fid) {
        return {
          ...n,
          position: { x: n.position.x - dx, y: n.position.y - dy },
          width: w,
          height: h,
          measured: { width: w, height: h },
        }
      }
      if (n.parentId === fid && (dx || dy)) return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
      return n
    })
  }
  return result
}

/** 拖动结束：拖出分组就解除，拖进分组就加入，并让分组框把节点框住 */
export function reparentAfterDrag(dragged: AppNode[]) {
  const s = getCanvas()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const draggedIds = new Set(dragged.map((d) => d.id))
  const frames = s.nodes.filter((n) => n.type === 'frame' && !n.parentId)
  const updates = new Map<string, { parentId?: string; position: { x: number; y: number } }>()
  const touched = new Set<string>()

  for (const d of dragged) {
    const n = byId.get(d.id)
    if (!n || n.type === 'frame') continue
    if (n.parentId && draggedIds.has(n.parentId)) continue // 跟着分组一起被拖动
    const r = rectOf(n, byId)
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const inside = frames.find((f) => {
      const fr = rectOf(f, byId)
      return cx > fr.x && cx < fr.x + fr.w && cy > fr.y && cy < fr.y + fr.h
    })
    if (inside && inside.id === n.parentId) {
      touched.add(inside.id)
      continue
    }
    if (!inside && !n.parentId) continue
    updates.set(
      n.id,
      inside
        ? { parentId: inside.id, position: { x: r.x - inside.position.x, y: r.y - inside.position.y } }
        : { position: { x: r.x, y: r.y } },
    )
    if (inside) touched.add(inside.id)
  }
  if (!updates.size && !touched.size) return

  s.setNodes((nodes) => {
    let next = nodes.map((n) => {
      const u = updates.get(n.id)
      if (!u) return n
      const { parentId: _p, extent: _e, ...rest } = n
      return (u.parentId ? { ...rest, parentId: u.parentId, position: u.position } : { ...rest, position: u.position }) as AppNode
    })
    // 子节点必须排在分组后面：新加入分组的节点挪到最后
    const joined = (n: AppNode) => !!updates.get(n.id)?.parentId
    if (next.some(joined)) next = [...next.filter((n) => !joined(n)), ...next.filter(joined)]
    return fitFrames(next, touched)
  })
}

/** ⌘G：把选中的节点打成一组 */
export function groupSelection() {
  const s = getCanvas()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const sel = s.nodes.filter((n) => n.selected && n.type !== 'frame' && !n.parentId)
  if (!sel.length) return s.showToast('先选中要打组的节点（已经在分组里的节点不能再打组）')
  const rects = sel.map((n) => rectOf(n, byId))
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  const frame: FrameNode = {
    id: nanoid(10),
    type: 'frame',
    position: { x: minX - FRAME_PAD, y: minY - FRAME_TITLE - FRAME_PAD },
    width: maxX - minX + FRAME_PAD * 2,
    height: maxY - minY + FRAME_TITLE + FRAME_PAD * 2,
    data: { label: '分组' },
    selected: true,
  }
  const ids = new Set(sel.map((n) => n.id))
  s.breakHistory()
  // 分组放在最前面：画在所有节点下面，也满足“父节点在子节点之前”
  s.setNodes((nodes) => [
    frame,
    ...nodes.map((n) =>
      ids.has(n.id)
        ? ({
            ...n,
            selected: false,
            parentId: frame.id,
            position: { x: n.position.x - frame.position.x, y: n.position.y - frame.position.y },
          } as AppNode)
        : n.selected
          ? { ...n, selected: false }
          : n,
    ),
  ])
}

/** 解组：去掉分组框，里面的节点留在原地 */
export function ungroupFrames(frameIds: string[]) {
  const s = getCanvas()
  const set = new Set(frameIds)
  if (!set.size) return
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  s.breakHistory()
  s.setNodes((nodes) =>
    nodes
      .filter((n) => !set.has(n.id))
      .map((n) => {
        if (!n.parentId || !set.has(n.parentId)) return n.selected ? { ...n, selected: false } : n
        const parent = byId.get(n.parentId)!
        const { parentId: _p, extent: _e, ...rest } = n
        return {
          ...rest,
          selected: true,
          position: { x: parent.position.x + n.position.x, y: parent.position.y + n.position.y },
        } as AppNode
      }),
  )
}

export function ungroupSelection() {
  const s = getCanvas()
  const frames = s.nodes.filter((n) => n.selected && n.type === 'frame').map((n) => n.id)
  if (!frames.length) return s.showToast('先选中一个分组')
  ungroupFrames(frames)
}

export function renameFrame(id: string, label: string) {
  const s = getCanvas()
  s.breakHistory()
  s.updateNodeData<FrameNode>(id, { label: label.trim() || '分组' })
}

// ---------- 选择、复制、粘贴、删除 ----------

export function selectAll() {
  const s = getCanvas()
  s.onNodesChange(s.nodes.map((n) => ({ type: 'select', id: n.id, selected: true })))
}

export function clearSelection() {
  const s = getCanvas()
  const changes = s.nodes.filter((n) => n.selected).map((n) => ({ type: 'select' as const, id: n.id, selected: false }))
  if (changes.length) s.onNodesChange(changes)
}

/** 选中的节点，加上选中分组里的子节点 */
function selectedWithChildren(nodes: AppNode[]) {
  const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
  for (const n of nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id)
  return ids
}

const CLIP_PREFIX = 'canvas-studio/nodes@1:'

export const isNodeClipboard = (text: string | undefined | null) => !!text?.startsWith(CLIP_PREFIX)

/** 把选中的节点和它们之间的连线写成一段文字，放进系统剪贴板，可以跨项目粘贴 */
export function serializeSelection(): string | null {
  const s = getCanvas()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const ids = selectedWithChildren(s.nodes)
  if (!ids.size) return null
  const nodes = s.nodes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const { selected: _s, dragging: _d, resizing: _r, ...rest } = n
      let out = rest as AppNode
      if (out.parentId && !ids.has(out.parentId)) {
        const { parentId: _p, extent: _e, ...r2 } = out
        out = { ...r2, position: absolutePosition(n, byId) } as AppNode
      }
      // 复制出来的节点不带“生成中”和报错状态
      if (out.type === 'image') out = { ...out, data: { ...out.data, task: undefined, error: undefined } }
      return out
    })
  const edges = s.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map(({ selected: _s, animated: _a, ...e }) => e)
  return CLIP_PREFIX + JSON.stringify({ nodes, edges })
}

/** 粘贴节点：at 是画布坐标（一般是鼠标位置）；不传就在原位置右下方错开一点 */
export function pasteSerialized(text: string, at?: { x: number; y: number }) {
  let parsed: { nodes?: AppNode[]; edges?: AppEdge[] }
  try {
    parsed = JSON.parse(text.slice(CLIP_PREFIX.length))
  } catch {
    return false
  }
  const src = parsed.nodes ?? []
  if (!src.length) return false
  const idMap = new Map(src.map((n) => [n.id, nanoid(10)]))
  const tops = src.filter((n) => !n.parentId)
  const minX = Math.min(...tops.map((n) => n.position.x))
  const minY = Math.min(...tops.map((n) => n.position.y))
  const maxX = Math.max(...tops.map((n) => n.position.x + nodeWidth(n)))
  const maxY = Math.max(...tops.map((n) => n.position.y + nodeHeight(n)))
  const offset = at ? { x: at.x - (minX + maxX) / 2, y: at.y - (minY + maxY) / 2 } : { x: 40, y: 40 }

  const nodes = src.map((n) => {
    const copy = { ...n, id: idMap.get(n.id)!, selected: !n.parentId } as AppNode
    if (n.parentId) copy.parentId = idMap.get(n.parentId)
    else copy.position = { x: n.position.x + offset.x, y: n.position.y + offset.y }
    if (copy.type === 'image' && copy.data.refOrder) {
      copy.data = { ...copy.data, refOrder: copy.data.refOrder.map((id) => idMap.get(id) ?? id) }
    }
    return copy
  })
  const edges = (parsed.edges ?? [])
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ ...e, id: `e-${nanoid(8)}`, source: idMap.get(e.source)!, target: idMap.get(e.target)! }))

  const s = getCanvas()
  s.breakHistory()
  s.setNodes((all) => [...deselectAll(all), ...nodes])
  if (edges.length) s.setEdges((es) => [...es, ...edges])
  return true
}

/** ⌘D：原地复制一份 */
export function duplicateSelection() {
  const text = serializeSelection()
  if (text) pasteSerialized(text)
}

/** 删除选中的节点（连同分组里的节点和相关连线） */
export function deleteSelection() {
  const s = getCanvas()
  const ids = selectedWithChildren(s.nodes)
  if (!ids.size) return
  s.breakHistory()
  s.setNodes((nodes) => nodes.filter((n) => !ids.has(n.id)))
  s.setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)))
}
