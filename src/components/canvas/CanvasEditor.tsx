'use client'

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type FinalConnectionState,
  type IsValidConnection,
  type OnConnectEnd,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Check, ChevronLeft, CloudOff, Keyboard, Loader2, Redo2, Settings, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SettingsModal from '@/components/SettingsModal'
import type { ProjectDoc, ProviderInfo } from '@/lib/types'
import {
  addNodeSelected,
  addUploadedRefs,
  addVersionsToNode,
  clearSelection,
  createImageNodesFromAssets,
  deleteSelection,
  duplicateSelection,
  estimateHeight,
  groupSelection,
  isNodeClipboard,
  makeNode,
  pasteSerialized,
  reparentAfterDrag,
  selectAll,
  serializeSelection,
  ungroupSelection,
} from './actions'
import { Dropdown } from './Dropdown'
import { imageFiles, uploadFiles } from './upload'
import { isValidConnection } from './graph'
import { useAutosave, useTaskPoller } from './hooks'
import { useRemoteControl } from './remote'
import FrameNode from './nodes/FrameNode'
import ImageNode from './nodes/ImageNode'
import TextNode from './nodes/TextNode'
import { AddNodeMenu, Lightbox, LeftToolbar, Toast } from './Overlays'
import { getCanvas, useCanvasStore } from './store'
import type { AppEdge, AppNode, ImageNode as ImageNodeType } from './types'

const nodeTypes = { text: TextNode, image: ImageNode, frame: FrameNode }

export default function CanvasEditor({ projectId }: { projectId: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const init = useCanvasStore((s) => s.init)
  const setProviders = useCanvasStore((s) => s.setProviders)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [pRes, provRes] = await Promise.all([fetch(`/api/projects/${projectId}`), fetch('/api/providers')])
        const doc = (await pRes.json()) as ProjectDoc & { error?: string }
        if (!pRes.ok) throw new Error(doc.error || '加载失败')
        const providers = (await provRes.json()) as ProviderInfo[]
        if (cancelled) return
        // 页面关闭时正在提交（还没拿到任务号）的任务无法恢复，清掉
        const nodes = (doc.nodes as AppNode[]).map((n) =>
          n.type === 'image' && n.data.task && !n.data.task.id
            ? ({ ...n, data: { ...n.data, task: undefined } } as AppNode)
            : n,
        )
        setProviders(providers)
        init({ projectId, name: doc.name, nodes, edges: doc.edges as AppEdge[], viewport: doc.viewport ?? null })
        setState('ready')
      } catch (e) {
        if (cancelled) return
        setError((e as Error).message)
        setState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, init, setProviders])

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <div className="text-danger">{error}</div>
        <Link href="/" className="text-sm text-muted hover:text-fg">
          返回项目列表
        </Link>
      </div>
    )
  }
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  )
}

function SaveIndicator() {
  const saveState = useCanvasStore((s) => s.saveState)
  if (saveState === 'saving' || saveState === 'idle')
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <Loader2 size={12} className="animate-spin" />
        保存中
      </span>
    )
  if (saveState === 'error')
    return (
      <span className="flex items-center gap-1.5 text-xs text-danger">
        <CloudOff size={13} />
        保存失败，会在下次改动时重试
      </span>
    )
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <Check size={13} />
      已保存
    </span>
  )
}

const SHORTCUTS: [string, string][] = [
  ['添加节点', '双击空白处 / 右键'],
  ['框选', '在空白处拖动'],
  ['多选', '⇧ 或 ⌘ + 点击'],
  ['平移画布', '双指滑动 / 空格 + 拖动'],
  ['缩放', '双指捏合 / ⌘ + 滚轮'],
  ['放大 / 缩小', '⌘ = / ⌘ -'],
  ['显示全部节点', '⌘ 0'],
  ['撤销 / 重做', '⌘ Z / ⇧ ⌘ Z'],
  ['复制 / 剪切 / 粘贴', '⌘ C / ⌘ X / ⌘ V'],
  ['原地复制一份', '⌘ D'],
  ['全选', '⌘ A'],
  ['打组 / 解组', '⌘ G / ⇧ ⌘ G'],
  ['删除', 'Delete / ⌫'],
  ['生成', '⌘ Enter（在提示词框里）'],
  ['取消选择', 'Esc'],
]

function ShortcutList() {
  return (
    <div className="p-3">
      <div className="mb-2 px-1 text-xs font-medium">快捷键</div>
      {SHORTCUTS.map(([label, keys]) => (
        <div key={label} className="flex items-center justify-between gap-3 rounded-md px-1 py-1 text-xs">
          <span className="text-fg/85">{label}</span>
          <span className="font-mono text-[11px] text-muted">{keys}</span>
        </div>
      ))}
      <div className="mt-2 px-1 text-[11px] leading-relaxed text-muted">
        复制的节点可以粘贴到别的项目里；截图或图片文件也可以直接 ⌘ V 粘贴。
      </div>
    </div>
  )
}

function TopBar() {
  const name = useCanvasStore((s) => s.name)
  const setName = useCanvasStore((s) => s.setName)
  const canUndo = useCanvasStore((s) => s.past.length > 0)
  const canRedo = useCanvasStore((s) => s.future.length > 0)
  const undo = useCanvasStore((s) => s.undo)
  const redo = useCanvasStore((s) => s.redo)
  const [showSettings, setShowSettings] = useState(false)
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3">
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-line bg-panel/90 p-1 pr-2 backdrop-blur">
        <Link
          href="/"
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:bg-panel-3 hover:text-fg"
          title="返回项目列表"
        >
          <ChevronLeft size={16} />
          项目
        </Link>
        <div className="h-4 w-px bg-line" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-48 rounded-lg bg-transparent px-2 text-sm outline-none hover:bg-panel-3 focus:bg-panel-3"
          spellCheck={false}
        />
        <SaveIndicator />
        <div className="ml-1 h-4 w-px bg-line" />
        <button
          onClick={undo}
          disabled={!canUndo}
          title="撤销（⌘Z）"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg/80 hover:bg-panel-3 hover:text-fg disabled:text-muted/40 disabled:hover:bg-transparent"
        >
          <Undo2 size={15} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          title="重做（⇧⌘Z）"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg/80 hover:bg-panel-3 hover:text-fg disabled:text-muted/40 disabled:hover:bg-transparent"
        >
          <Redo2 size={15} />
        </button>
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        <div className="rounded-xl border border-line bg-panel/90 p-px backdrop-blur">
          <Dropdown
            width={300}
            align="right"
            title="快捷键"
            trigger={
              <>
                <Keyboard size={14} />
                快捷键
              </>
            }
          >
            {() => <ShortcutList />}
          </Dropdown>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="flex h-[34px] items-center gap-1.5 rounded-xl border border-line bg-panel/90 px-3 text-xs text-fg/85 backdrop-blur hover:bg-panel-3 hover:text-fg"
          title="API Key 和模型设置"
        >
          <Settings size={14} />
          设置
        </button>
      </div>
      {showSettings && (
        <SettingsModal
          onClose={(changed) => {
            setShowSettings(false)
            if (changed) void refreshProviders()
          }}
        />
      )}
    </div>
  )
}

/** 设置改动后重新拉取模型列表 */
async function refreshProviders() {
  try {
    const res = await fetch('/api/providers')
    if (res.ok) getCanvas().setProviders(await res.json())
  } catch {
    // 下次打开页面会重新加载
  }
}

function Editor() {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStore((s) => s.onConnect)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const setMenu = useCanvasStore((s) => s.setMenu)
  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow()
  const [initialViewport] = useState(() => getCanvas().viewport)
  // 只在打开项目时适配一次视野；之后新加节点不再自动移动画布
  const [fitOnOpen] = useState(() => !getCanvas().viewport && getCanvas().nodes.length > 0)

  useAutosave()
  useTaskPoller()
  useRemoteControl()

  // ---------- 拖入图片文件 / 粘贴图片 ----------
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  const dragDepth = useRef(0)
  const [fileDrag, setFileDrag] = useState(false)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setFileDrag(false)
    const files = imageFiles(e.dataTransfer.files)
    if (!files.length) return getCanvas().showToast('只能拖入图片文件', 'error')
    // 拖到图片节点上：放进这个节点；拖到空白处：新建图片节点
    const nodeEl = (e.target as Element).closest('.react-flow__node') as HTMLElement | null
    const target = nodeEl?.dataset.id ? getCanvas().nodes.find((n) => n.id === nodeEl.dataset.id) : undefined
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const assets = await uploadFiles(files)
    if (!assets) return
    if (target?.type === 'image') addVersionsToNode(target.id, assets)
    else createImageNodesFromAssets(assets, flow)
  }

  // 复制的节点在内存里也存一份：系统没有触发复制/粘贴事件时（比如打包成 App 后没配菜单）用它兜底
  const memoryClip = useRef<string | null>(null)
  const clipEventSeen = useRef(false)
  const pasteAtPointer = (text: string) => {
    const p = lastPointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    pasteSerialized(text, screenToFlowPosition(p))
  }

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      clipEventSeen.current = true
      const el = e.target as HTMLElement | null
      const text = e.clipboardData?.getData('text/plain')
      if (isNodeClipboard(text) && !isEditable(el)) {
        e.preventDefault()
        pasteAtPointer(text!)
        return
      }
      const files = imageFiles(e.clipboardData?.files)
      if (!files.length) return
      // 在生成面板里粘贴图片：作为参考图
      const panelNodeId = el?.closest?.('[data-generate-panel]')?.getAttribute('data-generate-panel')
      if (!panelNodeId && el?.closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      const assets = await uploadFiles(files)
      if (!assets) return
      if (panelNodeId) return addUploadedRefs(panelNodeId, assets)
      // 选中了一个空的图片节点：放进它
      const selected = getCanvas().nodes.filter((n) => n.selected)
      const only = selected.length === 1 ? (selected[0] as ImageNodeType) : null
      if (only?.type === 'image' && !only.data.versions.length) return addVersionsToNode(only.id, assets)
      const p = lastPointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      createImageNodesFromAssets(assets, screenToFlowPosition(p), true)
    }
    // 复制 / 剪切选中的节点：写进系统剪贴板，可以跨项目粘贴
    const onCopy = (e: ClipboardEvent) => {
      clipEventSeen.current = true
      if (isEditable(e.target as HTMLElement) || window.getSelection()?.toString()) return
      const text = serializeSelection()
      if (!text) return
      memoryClip.current = text
      e.clipboardData?.setData('text/plain', text)
      e.preventDefault()
      if (e.type === 'cut') deleteSelection()
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCopy)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCopy)
    }
  }, [screenToFlowPosition])

  // ---------- 快捷键 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target as HTMLElement)) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const s = getCanvas()
      const run = (fn: () => void) => {
        e.preventDefault()
        fn()
      }
      // ⌘C / ⌘X / ⌘V 正常会触发系统的复制粘贴事件（上面处理）；没触发时在这里兜底
      if (mod && (k === 'c' || k === 'x' || k === 'v') && !window.getSelection()?.toString()) {
        clipEventSeen.current = false
        const copied = k === 'v' ? null : serializeSelection()
        if (copied) {
          memoryClip.current = copied
          navigator.clipboard?.writeText(copied).catch(() => {})
        }
        setTimeout(() => {
          if (clipEventSeen.current) return
          if (k === 'x' && copied) deleteSelection()
          if (k === 'v' && memoryClip.current) pasteAtPointer(memoryClip.current)
        }, 60)
        return
      }
      if (mod && k === 'z') return run(() => (e.shiftKey ? s.redo() : s.undo()))
      if (mod && k === 'y') return run(s.redo)
      if (mod && k === 'a') return run(selectAll)
      if (mod && k === 'd') return run(duplicateSelection)
      if (mod && k === 'g') return run(e.shiftKey ? ungroupSelection : groupSelection)
      if (mod && k === '0') return run(() => fitView({ padding: 0.2, duration: 300 }))
      if (mod && (k === '=' || k === '+')) return run(() => zoomIn({ duration: 200 }))
      if (mod && k === '-') return run(() => zoomOut({ duration: 200 }))
      if (e.key === 'Escape' && !s.menu && !s.lightbox) clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitView, zoomIn, zoomOut])

  // 正在生成的节点，它的输入连线显示流动动画
  const displayEdges = useMemo(() => {
    const running = new Set(
      nodes.filter((n) => n.type === 'image' && (n as ImageNodeType).data.task).map((n) => n.id),
    )
    return edges.map((e) => (running.has(e.target) !== !!e.animated ? { ...e, animated: running.has(e.target) } : e))
  }, [nodes, edges])

  const validate: IsValidConnection<AppEdge> = useCallback(
    (c) => isValidConnection(c, getCanvas().nodes, getCanvas().edges),
    [],
  )

  const openMenuAt = useCallback(
    (clientX: number, clientY: number, connectTo?: string) => {
      setMenu({
        screen: { x: clientX, y: clientY },
        flow: screenToFlowPosition({ x: clientX, y: clientY }),
        options: ['text', 'image'],
        connectTo,
      })
    },
    [screenToFlowPosition, setMenu],
  )

  // 从连接点拉线到空白处松手：从输出端拉 → 直接建一个图片节点；从输入端拉 → 弹菜单选上游类型
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, conn: FinalConnectionState) => {
      if (conn.isValid || !conn.fromNode || !conn.fromHandle) return
      const target = event.target as Element | null
      if (!target?.classList.contains('react-flow__pane')) return
      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      if (conn.fromHandle.type === 'source') {
        const flow = screenToFlowPosition({ x: point.clientX, y: point.clientY })
        const from = getCanvas().nodes.find((n) => n.id === conn.fromNode!.id)
        const gen = from?.type === 'image' ? { ...(from as ImageNodeType).data.gen } : undefined
        const node = makeNode('image', { x: flow.x, y: flow.y - estimateHeight('image', gen) / 2 }, gen)
        addNodeSelected(node, [{ source: conn.fromNode.id, target: node.id }])
      } else {
        openMenuAt(point.clientX, point.clientY, conn.fromNode.id)
      }
    },
    [screenToFlowPosition, openMenuAt],
  )

  return (
    <div
      className="relative h-screen w-screen"
      onPointerMove={(e) => {
        lastPointer.current = { x: e.clientX, y: e.clientY }
      }}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current += 1
        setFileDrag(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setFileDrag(false)
      }}
      onDrop={onDrop}
    >
      <ReactFlow<AppNode, AppEdge>
        nodes={nodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={validate}
        onNodeDragStart={() => getCanvas().breakHistory()}
        onNodeDragStop={(_e, _n, dragged) => {
          reparentAfterDrag(dragged)
          getCanvas().breakHistory()
        }}
        onSelectionDragStart={() => getCanvas().breakHistory()}
        onSelectionDragStop={(_e, dragged) => {
          reparentAfterDrag(dragged)
          getCanvas().breakHistory()
        }}
        selectionKeyCode={null}
        multiSelectionKeyCode={['Meta', 'Shift']}
        onMoveEnd={(_e, vp) => setViewport(vp)}
        onDoubleClick={(e) => {
          if ((e.target as Element).classList.contains('react-flow__pane')) openMenuAt(e.clientX, e.clientY)
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          openMenuAt(e.clientX, e.clientY)
        }}
        defaultViewport={initialViewport ?? undefined}
        fitView={fitOnOpen}
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        colorMode="dark"
        minZoom={0.1}
        maxZoom={3}
        zoomOnDoubleClick={false}
        panOnScroll
        selectionOnDrag
        panOnDrag={[1]}
        deleteKeyCode={['Backspace', 'Delete']}
        connectionRadius={36}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap position="bottom-right" pannable zoomable nodeBorderRadius={6} />
      </ReactFlow>

      <TopBar />
      <LeftToolbar />
      <AddNodeMenu />
      <Lightbox />
      <Toast />
      {fileDrag && (
        <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent/70 bg-accent/[0.04]">
          <div className="rounded-xl bg-panel-2/95 px-4 py-3 text-center shadow-xl">
            <div className="text-sm">松开即可添加图片</div>
            <div className="mt-1 text-xs text-muted">拖到空白处会新建图片节点，拖到图片节点上会放进那个节点</div>
          </div>
        </div>
      )}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
          <div className="text-sm">双击画布任意位置，添加第一个节点</div>
          <div className="text-xs text-muted/70">也可以用左侧工具栏</div>
        </div>
      )}
    </div>
  )
}

/** 焦点在输入框里时，快捷键交给输入框自己处理（比如文字的撤销、复制） */
function isEditable(el: HTMLElement | null) {
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"]')
}
