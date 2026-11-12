'use client'

import { ChevronDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { parseRatio } from './graph'

/**
 * 底栏用的下拉框：点按钮弹出一个面板，点面板外面或按 Esc 关闭。
 * 默认向上弹出；上方空间不够时改为向下。
 */
export function Dropdown({
  trigger,
  children,
  width = 280,
  align = 'left',
  title,
  className = '',
}: {
  trigger: React.ReactNode
  children: (close: () => void) => React.ReactNode
  width?: number
  /** 弹层和按钮的哪一边对齐 */
  align?: 'left' | 'right'
  title?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // 打开时量一下高度，决定往上还是往下弹
  useLayoutEffect(() => {
    if (!open || !ref.current || !panelRef.current) return
    const t = ref.current.getBoundingClientRect()
    const h = panelRef.current.offsetHeight
    const spaceAbove = t.top
    const spaceBelow = window.innerHeight - t.bottom
    setUp(spaceAbove >= h + 12 || spaceAbove >= spaceBelow)
  }, [open])

  return (
    <div ref={ref} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        title={title}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors ${
          open ? 'bg-panel-3 text-fg' : 'text-fg/85 hover:bg-panel-3 hover:text-fg'
        }`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">{trigger}</span>
        <ChevronDown size={13} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          ref={panelRef}
          className={`absolute z-30 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-panel-2 shadow-2xl shadow-black/60 ${
            up ? 'bottom-full mb-2' : 'top-full mt-2'
          } ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** 选项按钮：选中时高亮 */
export function OptionButton({
  active,
  onClick,
  children,
  className = '',
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1 rounded-xl border text-xs transition-colors ${
        active
          ? 'border-accent/80 bg-accent/10 text-fg'
          : 'border-line text-fg/75 hover:border-line-strong hover:bg-panel-3 hover:text-fg'
      } ${className}`}
    >
      {children}
    </button>
  )
}

/** 按比例画一个小矩形，让比例一眼能看出来 */
export function RatioIcon({ ratio, size = 18 }: { ratio: string; size?: number }) {
  const max = size - 3
  if (ratio === 'auto') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" stroke="currentColor">
        <rect x={1.5} y={1.5} width={max} height={max} rx={3} strokeWidth={1.5} strokeDasharray="3 2.4" />
        <rect x={size / 2 - 1} y={size / 2 - 1} width={max / 2} height={max / 2} rx={1.5} strokeWidth={1.5} />
      </svg>
    )
  }
  const r = parseRatio(ratio)
  const w = r >= 1 ? max : Math.max(5, max * r)
  const h = r >= 1 ? Math.max(5, max / r) : max
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" stroke="currentColor">
      <rect x={(size - w) / 2} y={(size - h) / 2} width={w} height={h} rx={2.5} strokeWidth={1.6} />
    </svg>
  )
}
