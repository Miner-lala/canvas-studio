'use client'

import { NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { LayoutGrid, Ungroup } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { renameFrame, ungroupFrames } from '../actions'
import { useCanvasStore } from '../store'
import type { FrameNode as FrameNodeType } from '../types'

/**
 * 分组框：拖动它会带着里面的节点一起走。
 * 把节点拖进框里就加入分组，拖出框外就离开分组；双击标题可以改名。
 */
function FrameNode({ id, data, selected }: NodeProps<FrameNodeType>) {
  const soleSelected = useCanvasStore((s) => selected && s.nodes.filter((n) => n.selected).length === 1)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft.trim() !== data.label) renameFrame(id, draft)
  }

  return (
    <>
      {soleSelected && (
        <NodeToolbar position={Position.Top} align="start" offset={8}>
          <div className="nodrag flex items-center gap-0.5 rounded-xl border border-line bg-panel-2 p-1 shadow-xl shadow-black/40">
            <button
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-fg/90 hover:bg-panel-3 hover:text-fg"
              onClick={() => ungroupFrames([id])}
              title="解组（⇧⌘G）：去掉分组框，里面的节点留在原地"
            >
              <Ungroup size={14} />
              解组
            </button>
          </div>
        </NodeToolbar>
      )}
      <div
        className={`h-full w-full rounded-[18px] border border-dashed transition-colors ${
          selected ? 'border-accent bg-accent/[0.04]' : 'border-line-strong bg-white/[0.015]'
        }`}
      >
        <div className="flex h-10 items-center gap-1.5 px-4 text-xs text-muted">
          <LayoutGrid size={13} className="shrink-0" />
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') {
                  setDraft(data.label)
                  setEditing(false)
                }
              }}
              className="nodrag h-6 w-48 rounded bg-panel-3 px-1.5 text-xs text-fg outline-none"
            />
          ) : (
            <span
              className="cursor-text truncate rounded px-1 py-0.5 hover:bg-white/5 hover:text-fg"
              title="双击改名"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setDraft(data.label)
                setEditing(true)
              }}
            >
              {data.label}
            </span>
          )}
        </div>
      </div>
    </>
  )
}

export default memo(FrameNode)
