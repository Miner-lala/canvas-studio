'use client'

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { create } from 'zustand'
import type { ProviderInfo, Viewport } from '@/lib/types'
import type { AddMenuState, AppEdge, AppNode } from './types'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** 撤销历史里的一步：当时的节点和连线 */
export interface Snapshot {
  nodes: AppNode[]
  edges: AppEdge[]
}

type DataPatch<T extends AppNode> = Partial<T['data']> | ((data: T['data']) => Partial<T['data']>)

interface CanvasState {
  projectId: string | null
  name: string
  nodes: AppNode[]
  edges: AppEdge[]
  viewport: Viewport | null
  providers: ProviderInfo[]
  saveState: SaveState
  /** 每次有需要保存的改动就加一，自动保存监听它 */
  dirty: number
  menu: AddMenuState | null
  /** 大图预览：可以左右切换的一组图；nodeId 是打开预览的图片节点 */
  lightbox: { assetIds: string[]; index: number; nodeId?: string } | null
  /** 刚新建的节点，挂载后让它的输入框自动获得焦点 */
  focusNodeId: string | null
  toast: { id: number; message: string; kind: 'info' | 'error' } | null
  /** 撤销 / 重做历史 */
  past: Snapshot[]
  future: Snapshot[]

  /** 显示底部提示条；duration 为 0 时一直显示，直到下一条提示或 hideToast */
  showToast(message: string, kind?: 'info' | 'error', duration?: number): void
  hideToast(): void

  init(p: { projectId: string; name: string; nodes: AppNode[]; edges: AppEdge[]; viewport: Viewport | null }): void
  setProviders(p: ProviderInfo[]): void
  setName(name: string): void
  setViewport(v: Viewport): void
  setSaveState(s: SaveState): void
  setMenu(m: AddMenuState | null): void
  setLightbox(v: { assetIds: string[]; index: number; nodeId?: string } | null): void
  setFocusNode(id: string | null): void
  markDirty(): void

  onNodesChange(changes: NodeChange<AppNode>[]): void
  onEdgesChange(changes: EdgeChange<AppEdge>[]): void
  onConnect(c: Connection): void
  setNodes(fn: (nodes: AppNode[]) => AppNode[]): void
  setEdges(fn: (edges: AppEdge[]) => AppEdge[]): void
  /** 用户改节点内容（会进撤销历史） */
  updateNodeData<T extends AppNode>(id: string, patch: DataPatch<T>): void
  /**
   * 生成任务带来的变化（开始生成、出图、报错）：不进撤销历史，
   * 并且同步写进历史里的每一步，这样撤销别的操作时不会把生成结果弄丢。
   */
  patchNodeEverywhere<T extends AppNode>(id: string, patch: DataPatch<T>): void
  undo(): void
  redo(): void
  /** 结束当前这一步，下一次改动单独成为一步撤销 */
  breakHistory(): void
}

// 只是选中、测量尺寸这类变化不需要保存，也不进撤销历史
const isPersistent = (c: { type: string }) => c.type !== 'select' && c.type !== 'dimensions'

const HISTORY_LIMIT = 100
/** 连续改动（拖动、打字）间隔小于这个时间，算作同一步撤销 */
const BURST_MS = 600
let lastChangeAt = 0

/** 一组连续改动开始时，把改动前的状态记进历史 */
function checkpoint(s: CanvasState): Partial<CanvasState> {
  const now = Date.now()
  const startNew = now - lastChangeAt > BURST_MS
  lastChangeAt = now
  if (!startNew) return {}
  return { past: [...s.past, { nodes: s.nodes, edges: s.edges }].slice(-HISTORY_LIMIT), future: [] }
}

function applyPatch<T extends AppNode>(nodes: AppNode[], id: string, patch: DataPatch<T>): AppNode[] {
  let hit = false
  const next = nodes.map((n) => {
    if (n.id !== id) return n
    hit = true
    const p = typeof patch === 'function' ? patch(n.data as never) : patch
    return { ...n, data: { ...n.data, ...p } } as AppNode
  })
  return hit ? next : nodes
}

const deselect = (nodes: AppNode[]) => nodes.map((n) => (n.selected ? { ...n, selected: false } : n))

export const useCanvasStore = create<CanvasState>((set, get) => ({
  projectId: null,
  name: '',
  nodes: [],
  edges: [],
  viewport: null,
  providers: [],
  saveState: 'idle',
  dirty: 0,
  menu: null,
  lightbox: null,
  focusNodeId: null,
  toast: null,
  past: [],
  future: [],

  init: ({ projectId, name, nodes, edges, viewport }) => {
    lastChangeAt = 0
    set({
      projectId,
      name,
      nodes,
      edges,
      viewport,
      saveState: 'saved',
      dirty: 0,
      menu: null,
      lightbox: null,
      focusNodeId: null,
      past: [],
      future: [],
    })
  },
  setProviders: (providers) => set({ providers }),
  setName: (name) => set((s) => ({ name, dirty: s.dirty + 1 })),
  setViewport: (viewport) => set((s) => ({ viewport, dirty: s.dirty + 1 })),
  setSaveState: (saveState) => set({ saveState }),
  setMenu: (menu) => set({ menu }),
  setLightbox: (lightbox) => set({ lightbox }),
  setFocusNode: (focusNodeId) => set({ focusNodeId }),
  showToast: (message, kind = 'info', duration = 4000) => {
    const id = Date.now() + Math.random()
    set({ toast: { id, message, kind } })
    if (duration > 0) {
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null })
      }, duration)
    }
  },
  hideToast: () => set({ toast: null }),
  markDirty: () => set((s) => ({ dirty: s.dirty + 1 })),

  onNodesChange: (changes) =>
    set((s) => {
      const persistent = changes.some(isPersistent)
      return {
        ...(persistent ? checkpoint(s) : {}),
        nodes: applyNodeChanges(changes, s.nodes),
        dirty: persistent ? s.dirty + 1 : s.dirty,
      }
    }),
  onEdgesChange: (changes) =>
    set((s) => {
      const persistent = changes.some(isPersistent)
      return {
        ...(persistent ? checkpoint(s) : {}),
        edges: applyEdgeChanges(changes, s.edges),
        dirty: persistent ? s.dirty + 1 : s.dirty,
      }
    }),
  onConnect: (c) =>
    set((s) => {
      lastChangeAt = 0 // 连线总是单独一步
      return { ...checkpoint(s), edges: addEdge(c, s.edges), dirty: s.dirty + 1 }
    }),
  setNodes: (fn) => set((s) => ({ ...checkpoint(s), nodes: fn(s.nodes), dirty: s.dirty + 1 })),
  setEdges: (fn) => set((s) => ({ ...checkpoint(s), edges: fn(s.edges), dirty: s.dirty + 1 })),
  updateNodeData: (id, patch) =>
    set((s) => ({ ...checkpoint(s), nodes: applyPatch(s.nodes, id, patch), dirty: s.dirty + 1 })),
  patchNodeEverywhere: (id, patch) =>
    set((s) => {
      const fix = (h: Snapshot) => {
        const nodes = applyPatch(h.nodes, id, patch)
        return nodes === h.nodes ? h : { ...h, nodes }
      }
      return {
        nodes: applyPatch(s.nodes, id, patch),
        past: s.past.map(fix),
        future: s.future.map(fix),
        dirty: s.dirty + 1,
      }
    }),
  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1]
      if (!prev) return {}
      lastChangeAt = 0
      return {
        past: s.past.slice(0, -1),
        future: [{ nodes: s.nodes, edges: s.edges }, ...s.future].slice(0, HISTORY_LIMIT),
        nodes: deselect(prev.nodes),
        edges: prev.edges,
        dirty: s.dirty + 1,
      }
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0]
      if (!next) return {}
      lastChangeAt = 0
      return {
        past: [...s.past, { nodes: s.nodes, edges: s.edges }].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        nodes: deselect(next.nodes),
        edges: next.edges,
        dirty: s.dirty + 1,
      }
    }),
  breakHistory: () => {
    lastChangeAt = 0
  },
}))

export const getCanvas = () => useCanvasStore.getState()

// 开发模式下挂到 window 上，方便在浏览器控制台里调试
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as { __canvasStore?: typeof useCanvasStore }).__canvasStore = useCanvasStore
}
