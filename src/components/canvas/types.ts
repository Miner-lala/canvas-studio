import type { Edge, Node } from '@xyflow/react'
import type { GenSettings, ImageVersion } from '@/lib/types'

export const IMAGE_NODE_WIDTH = 300
export const TEXT_NODE_WIDTH = 280

export interface NodeTask {
  /** 后端任务号；空字符串表示正在提交 */
  id: string
  startedAt: number
  count: number
}

export type TextNodeData = { text: string }

export type ImageNodeData = {
  versions: ImageVersion[]
  current: number
  /** 节点自己的提示词，会接在上游文本节点后面 */
  prompt: string
  gen: GenSettings
  task?: NodeTask
  error?: string
  /** 参考图顺序（上游图片节点 id）。没设置时按画布上的位置从上到下排 */
  refOrder?: string[]
}

export type FrameNodeData = { label: string }

export type TextNode = Node<TextNodeData, 'text'>
export type ImageNode = Node<ImageNodeData, 'image'>
export type FrameNode = Node<FrameNodeData, 'frame'>
export type AppNode = TextNode | ImageNode | FrameNode
export type AppEdge = Edge

export type NodeKind = 'text' | 'image'

export interface AddMenuState {
  /** 屏幕坐标，菜单显示的位置 */
  screen: { x: number; y: number }
  /** 画布坐标，新节点放置的位置 */
  flow: { x: number; y: number }
  options: NodeKind[]
  /** 从某个节点的输入端拉线到空白处时，新节点要连到它上面 */
  connectTo?: string
}
