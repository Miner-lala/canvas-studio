import type { Connection } from '@xyflow/react'
import type { ImageVersion } from '@/lib/types'
import type { AppEdge, AppNode, ImageNode, TextNode } from './types'

/** 节点在画布上的绝对坐标（在分组里的节点坐标是相对分组的） */
export function absolutePosition(node: AppNode, byId: Map<string, AppNode>) {
  let { x, y } = node.position
  let parent = node.parentId ? byId.get(node.parentId) : undefined
  while (parent) {
    x += parent.position.x
    y += parent.position.y
    parent = parent.parentId ? byId.get(parent.parentId) : undefined
  }
  return { x, y }
}

export interface NodeInputs {
  texts: { id: string; text: string }[]
  images: { id: string; version: ImageVersion }[]
  /** 连了线但还没有图片的图片节点 */
  emptyImages: string[]
}

/** 收集连到某个图片节点上的输入：文本作为提示词，图片作为参考图。按上下、左右位置排序 */
export function getInputs(nodeId: string, nodes: AppNode[], edges: AppEdge[]): NodeInputs {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const sources = edges
    .filter((e) => e.target === nodeId)
    .map((e) => byId.get(e.source))
    .filter((n): n is AppNode => !!n)
    .map((n) => ({ n, p: absolutePosition(n, byId) }))
    .sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x)
    .map(({ n }) => n)

  const result: NodeInputs = { texts: [], images: [], emptyImages: [] }
  // 参考图在面板里拖动排过序的话，按那个顺序；新连进来的排在最后
  const order = (byId.get(nodeId) as ImageNode | undefined)?.data.refOrder
  const rank = (id: string) => {
    const i = order?.indexOf(id) ?? -1
    return i === -1 ? Infinity : i
  }
  for (const n of sources) {
    if (n.type === 'text') {
      result.texts.push({ id: n.id, text: (n as TextNode).data.text })
    } else if (n.type === 'image') {
      const d = (n as ImageNode).data
      const v = d.versions[d.current]
      if (v) result.images.push({ id: n.id, version: v })
      else result.emptyImages.push(n.id)
    }
  }
  // sort 是稳定排序：没排过序的保持按位置的先后
  if (order?.length) result.images.sort((a, b) => (rank(a.id) === rank(b.id) ? 0 : rank(a.id) < rank(b.id) ? -1 : 1))
  return result
}

/** 从 start 顺着连线往下游走，能不能走到 goal */
function reaches(start: string, goal: string, edges: AppEdge[]) {
  const stack = [start]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === goal) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const e of edges) if (e.source === cur) stack.push(e.target)
  }
  return false
}

/** 只允许：文本→图片、图片→图片；不能自连、重复连、连成环 */
export function isValidConnection(c: Connection | AppEdge, nodes: AppNode[], edges: AppEdge[]) {
  if (!c.source || !c.target || c.source === c.target) return false
  const source = nodes.find((n) => n.id === c.source)
  const target = nodes.find((n) => n.id === c.target)
  if (!source || !target) return false
  if (target.type !== 'image') return false
  if (source.type !== 'text' && source.type !== 'image') return false
  if (edges.some((e) => e.source === c.source && e.target === c.target)) return false
  if (reaches(c.target, c.source, edges)) return false
  return true
}

export function parseRatio(aspect: string) {
  const [w, h] = aspect.split(':').map(Number)
  return w > 0 && h > 0 ? w / h : 1
}
