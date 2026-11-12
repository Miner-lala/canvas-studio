'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Type } from 'lucide-react'
import { memo, useLayoutEffect, useRef } from 'react'
import { useAutoFocus } from '../hooks'
import { useCanvasStore } from '../store'
import { TEXT_NODE_WIDTH, type TextNode as TextNodeType } from '../types'

function TextNode({ id, data, selected }: NodeProps<TextNodeType>) {
  const update = useCanvasStore((s) => s.updateNodeData)
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoFocus(id, ref)

  // 输入框随内容长高，超过上限后出现滚动条
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 96), 320)}px`
  }, [data.text])

  return (
    <div className="relative" style={{ width: TEXT_NODE_WIDTH }}>
      <div className="absolute -top-6 left-1 flex items-center gap-1 text-xs text-muted">
        <Type size={12} />
        文本
      </div>
      <div
        className={`rounded-[14px] border bg-panel transition-colors ${
          selected ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line hover:border-line-strong'
        }`}
      >
        <textarea
          ref={ref}
          value={data.text}
          onChange={(e) => update<TextNodeType>(id, { text: e.target.value })}
          placeholder="写一段提示词，连到图片节点上使用"
          spellCheck={false}
          className="nodrag nowheel block w-full resize-none bg-transparent px-3.5 py-3 text-[13px] leading-relaxed outline-none placeholder:text-muted/70"
        />
      </div>
      <Handle type="source" position={Position.Right} className="canvas-handle" />
    </div>
  )
}

export default memo(TextNode)
