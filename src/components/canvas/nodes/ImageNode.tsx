'use client'

import { Handle, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  ImageIcon,
  LayoutGrid,
  Loader2,
  Maximize2,
  RotateCw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { assetUrl } from '@/lib/asset-url'
import { addVersionsToNode, cancelGenerate, continueFrom, generate, tileVersions } from '../actions'
import { pickImages, uploadFiles } from '../upload'
import GeneratePanel from '../GeneratePanel'
import { parseRatio } from '../graph'
import { useCanvasStore } from '../store'
import { IMAGE_NODE_WIDTH, type ImageNode as ImageNodeType } from '../types'

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{Math.max(0, Math.floor((now - since) / 1000))}s</>
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  href,
}: {
  icon: typeof Download
  label: string
  onClick?: () => void
  href?: string
}) {
  const cls =
    'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-fg/90 hover:bg-panel-3 hover:text-fg transition-colors'
  if (href)
    return (
      <a className={cls} href={href} download title={label}>
        <Icon size={14} />
        {label}
      </a>
    )
  return (
    <button className={cls} onClick={onClick} title={label}>
      <Icon size={14} />
      {label}
    </button>
  )
}

function ImageNode({ id, data, selected }: NodeProps<ImageNodeType>) {
  // 只有单独选中这一个节点时才弹出面板
  const soleSelected = useCanvasStore((s) => selected && s.nodes.filter((n) => n.selected).length === 1)
  const update = useCanvasStore((s) => s.updateNodeData)
  const setLightbox = useCanvasStore((s) => s.setLightbox)

  const ver = data.versions[data.current]
  const ratio = ver ? ver.width / ver.height : parseRatio(data.gen.aspectRatio)
  const running = !!data.task
  // 预览时可以在这个节点叠着的所有图之间左右切换
  const openPreview = () =>
    setLightbox({ assetIds: data.versions.map((v) => v.assetId), index: data.current, nodeId: id })
  const total = data.versions.length

  const go = (delta: number) =>
    update<ImageNodeType>(id, { current: (data.current + delta + total) % total })

  return (
    <>
      {soleSelected && ver && (
        <NodeToolbar position={Position.Top} offset={34}>
          <div className="nodrag flex items-center gap-0.5 rounded-xl border border-line bg-panel-2 p-1 shadow-xl shadow-black/40">
            <ToolButton icon={Maximize2} label="预览" onClick={openPreview} />
            <ToolButton icon={Download} label="下载" href={`${assetUrl(ver.assetId)}?download=1`} />
            <ToolButton icon={Sparkles} label="以此图继续" onClick={() => continueFrom(id)} />
            {total > 1 && (
              <ToolButton icon={LayoutGrid} label={`平铺 ${total} 张`} onClick={() => tileVersions(id)} />
            )}
          </div>
        </NodeToolbar>
      )}

      <div className="relative" style={{ width: IMAGE_NODE_WIDTH }}>
        <div className="absolute -top-6 left-1 flex items-center gap-1 text-xs text-muted">
          <ImageIcon size={12} />
          图片
          {total > 1 && (
            <span className="ml-1 font-mono text-[11px] text-muted/80">
              {data.current + 1}/{total}
            </span>
          )}
        </div>

        <div
          className={`relative overflow-hidden rounded-[14px] border bg-panel transition-colors ${
            selected ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line hover:border-line-strong'
          }`}
          style={{ aspectRatio: String(ratio) }}
        >
          {ver ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={assetUrl(ver.assetId, true)}
              alt=""
              draggable={false}
              onDoubleClick={openPreview}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            !running && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
                <ImageIcon size={26} strokeWidth={1.5} />
                <div className="text-xs">选中后在下方写提示词生成</div>
                <button
                  className="nodrag mt-1 flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-fg/80 hover:border-line-strong hover:bg-panel-3 hover:text-fg"
                  onClick={async (e) => {
                    e.stopPropagation()
                    const assets = await uploadFiles(await pickImages(false))
                    if (assets) addVersionsToNode(id, assets)
                  }}
                >
                  <Upload size={13} />
                  或上传一张图片
                </button>
              </div>
            )
          )}

          {running && (
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${
                ver ? 'bg-black/55 backdrop-blur-[2px]' : 'shimmer'
              }`}
            >
              <Loader2 size={22} className="animate-spin text-accent" />
              <div className="text-xs text-fg/90">
                生成中 {data.task!.count > 1 ? `${data.task!.count} 张 ` : ''}· <Elapsed since={data.task!.startedAt} />
              </div>
              {data.task!.id && (
                <button
                  className="nodrag mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-white/10 hover:text-fg"
                  onClick={() => cancelGenerate(id)}
                >
                  <X size={12} />
                  取消
                </button>
              )}
            </div>
          )}

          {!running && data.error && (
            <div className="absolute inset-x-0 bottom-0 flex items-start gap-2 bg-[#2a1416]/95 px-3 py-2.5 text-xs text-danger">
              <AlertCircle size={14} className="mt-px shrink-0" />
              <div className="nodrag min-w-0 flex-1 cursor-text select-text break-words leading-relaxed">
                {data.error}
              </div>
              <button
                className="nodrag flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-fg/80 hover:bg-white/10"
                onClick={() => generate(id)}
                title="重试"
              >
                <RotateCw size={12} />
                重试
              </button>
              <button
                className="nodrag shrink-0 rounded p-0.5 text-fg/60 hover:bg-white/10"
                onClick={() => update<ImageNodeType>(id, { error: undefined })}
                title="关闭"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {total > 1 && !running && !data.error && (
            <div className="nodrag absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center rounded-full bg-black/60 text-xs text-white backdrop-blur">
              <button className="rounded-full p-1.5 hover:bg-white/15" onClick={() => go(-1)} title="上一张">
                <ChevronLeft size={14} />
              </button>
              <span className="min-w-9 text-center font-mono text-[11px]">
                {data.current + 1}/{total}
              </span>
              <button className="rounded-full p-1.5 hover:bg-white/15" onClick={() => go(1)} title="下一张">
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        <Handle type="target" position={Position.Left} className="canvas-handle" />
        <Handle type="source" position={Position.Right} className="canvas-handle" />
      </div>

      {soleSelected && (
        <NodeToolbar position={Position.Bottom} offset={14}>
          <GeneratePanel nodeId={id} />
        </NodeToolbar>
      )}
    </>
  )
}

export default memo(ImageNode)
