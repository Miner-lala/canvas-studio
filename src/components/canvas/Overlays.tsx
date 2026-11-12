'use client'

import { useReactFlow } from '@xyflow/react'
import { AlertCircle, ChevronLeft, ChevronRight, Download, ImageIcon, Loader2, Maximize, Type, Upload, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { assetUrl } from '@/lib/asset-url'
import { addNodeSelected, createImageNodesFromAssets, estimateHeight, findFreeSpot, makeNode } from './actions'
import { pickImages, uploadFiles } from './upload'
import { useCanvasStore } from './store'
import { IMAGE_NODE_WIDTH, TEXT_NODE_WIDTH, type NodeKind } from './types'

const KIND_META: Record<NodeKind, { label: string; desc: string; icon: typeof Type }> = {
  text: { label: '文本节点', desc: '写提示词', icon: Type },
  image: { label: '图片节点', desc: '文生图 / 图生图', icon: ImageIcon },
}

/** 新建节点：放在指定画布坐标，可选地连到某个图片节点上 */
export function createNodeAt(
  kind: NodeKind,
  flow: { x: number; y: number },
  connectTo?: string,
  center = true,
  avoidOverlap = false,
) {
  const w = kind === 'text' ? TEXT_NODE_WIDTH : IMAGE_NODE_WIDTH
  const h = estimateHeight(kind)
  // 从输入端拉出来的新节点放在左边，右侧连接点正好落在松手的位置
  const x = connectTo ? flow.x - w : center ? flow.x - w / 2 : flow.x
  const pos = avoidOverlap ? findFreeSpot(x, flow.y - h / 2, w, h) : { x, y: flow.y - h / 2 }
  const node = makeNode(kind, pos)
  addNodeSelected(node, connectTo ? [{ source: node.id, target: connectTo }] : [])
}

export function AddNodeMenu() {
  const menu = useCanvasStore((s) => s.menu)
  const setMenu = useCanvasStore((s) => s.setMenu)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, setMenu])

  if (!menu) return null
  return (
    <div
      ref={ref}
      className="fixed z-50 w-52 rounded-xl border border-line bg-panel-2 p-1 shadow-2xl shadow-black/50"
      style={{ left: menu.screen.x, top: menu.screen.y }}
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-muted">{menu.connectTo ? '新建并连到这个节点' : '添加节点'}</div>
      {menu.options.map((kind) => {
        const { label, desc, icon: Icon } = KIND_META[kind]
        return (
          <button
            key={kind}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-panel-3"
            onClick={() => {
              createNodeAt(kind, menu.flow, menu.connectTo, false)
              setMenu(null)
            }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-panel-3 text-fg/80">
              <Icon size={14} />
            </span>
            <span>
              <span className="block text-[13px]">{label}</span>
              <span className="block text-[11px] text-muted">{desc}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function LeftToolbar() {
  const { screenToFlowPosition, fitView } = useReactFlow()
  const addAtCenter = (kind: NodeKind) => {
    // 放在画布可见区域中央；那里有节点的话往下找空位
    const flow = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    createNodeAt(kind, flow, undefined, true, true)
  }
  const uploadAtCenter = async () => {
    const files = await pickImages()
    const assets = await uploadFiles(files)
    if (assets) createImageNodesFromAssets(assets, screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }), true)
  }
  const btn =
    'group relative flex h-10 w-10 items-center justify-center rounded-xl text-fg/80 hover:bg-panel-3 hover:text-fg transition-colors'
  const tip =
    'pointer-events-none absolute left-12 whitespace-nowrap rounded-md bg-panel-3 px-2 py-1 text-xs opacity-0 transition-opacity group-hover:opacity-100'
  return (
    <div className="absolute left-4 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border border-line bg-panel p-1.5 shadow-xl shadow-black/30">
      <button className={btn} onClick={() => addAtCenter('text')}>
        <Type size={18} />
        <span className={tip}>添加文本节点</span>
      </button>
      <button className={btn} onClick={() => addAtCenter('image')}>
        <ImageIcon size={18} />
        <span className={tip}>添加图片节点</span>
      </button>
      <button className={btn} onClick={uploadAtCenter}>
        <Upload size={18} />
        <span className={tip}>上传图片（也可以直接拖进画布或粘贴）</span>
      </button>
      <div className="mx-2 my-0.5 h-px bg-line" />
      <button className={btn} onClick={() => fitView({ padding: 0.2, duration: 300 })}>
        <Maximize size={17} />
        <span className={tip}>显示全部节点</span>
      </button>
    </div>
  )
}

/** 大图预览：节点里叠着多张图时，可以用左右箭头、键盘 ← → 或底部缩略图切换 */
export function Lightbox() {
  const lb = useCanvasStore((s) => s.lightbox)
  const setLightbox = useCanvasStore((s) => s.setLightbox)
  const stripRef = useRef<HTMLDivElement>(null)
  const total = lb?.assetIds.length ?? 0
  const index = lb ? Math.min(Math.max(lb.index, 0), total - 1) : 0
  const assetId = lb?.assetIds[index]

  const go = (delta: number) => {
    if (!lb || total < 2) return
    setLightbox({ ...lb, index: (index + delta + total) % total })
  }

  useEffect(() => {
    if (!lb) return
    // 用捕获阶段并拦下事件：方向键不能再传给画布（否则会移动选中的节点）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // 预先加载前后两张，切换时不用等
  useEffect(() => {
    if (!lb || total < 2) return
    for (const d of [-1, 1]) new Image().src = assetUrl(lb.assetIds[(index + d + total) % total])
    stripRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [lb, index, total])

  if (!lb || !assetId) return null
  const arrow =
    'absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20'
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={() => setLightbox(null)}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-5">
        <div className="w-40" />
        {total > 1 ? (
          <div className="rounded-full bg-white/10 px-3 py-1 font-mono text-sm text-white/90">
            {index + 1} / {total}
          </div>
        ) : (
          <div />
        )}
        <div className="flex w-40 justify-end gap-2">
          <a
            href={`${assetUrl(assetId)}?download=1`}
            download
            onClick={(e) => e.stopPropagation()}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm hover:bg-white/20"
          >
            <Download size={15} />
            下载原图
          </a>
          <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20" title="关闭（Esc）">
            <X size={17} />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-20 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={assetId}
          src={assetUrl(assetId)}
          alt=""
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
        {total > 1 && (
          <>
            <button
              className={`${arrow} left-5`}
              title="上一张（←）"
              onClick={(e) => {
                e.stopPropagation()
                go(-1)
              }}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              className={`${arrow} right-5`}
              title="下一张（→）"
              onClick={(e) => {
                e.stopPropagation()
                go(1)
              }}
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}
      </div>

      {total > 1 && (
        <div
          ref={stripRef}
          className="mx-auto mb-5 flex max-w-full shrink-0 gap-2 overflow-x-auto px-5 py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {lb.assetIds.map((id, i) => (
            <button
              key={`${id}-${i}`}
              data-current={i === index}
              onClick={() => setLightbox({ ...lb, index: i })}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 transition-opacity ${
                i === index ? 'border-accent opacity-100' : 'border-transparent opacity-50 hover:opacity-90'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrl(id, true)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 底部提示条：上传进度、出错信息 */
export function Toast() {
  const toast = useCanvasStore((s) => s.toast)
  const hide = useCanvasStore((s) => s.hideToast)
  if (!toast) return null
  const error = toast.kind === 'error'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className={`pointer-events-auto flex max-w-[560px] items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-2xl shadow-black/50 ${
          error ? 'border-danger/40 bg-[#2a1416] text-danger' : 'border-line bg-panel-2 text-fg/90'
        }`}
      >
        {error ? <AlertCircle size={15} className="shrink-0" /> : <Loader2 size={15} className="shrink-0 animate-spin text-accent" />}
        <span className="min-w-0 break-words">{toast.message}</span>
        {error && (
          <button className="ml-1 shrink-0 rounded p-0.5 text-fg/60 hover:bg-white/10" onClick={hide}>
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
