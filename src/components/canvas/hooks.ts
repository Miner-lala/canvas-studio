'use client'

import { useEffect } from 'react'
import { applyTaskResult, type TaskPollResult } from './actions'
import { getCanvas, useCanvasStore } from './store'
import type { AppNode, ImageNode } from './types'

const POLL_MS = 1200
const SAVE_DELAY_MS = 700

/** 每隔一段时间查询画布上所有进行中的任务，完成后把图片写回节点 */
export function useTaskPoller() {
  useEffect(() => {
    let busy = false
    const tick = async () => {
      if (busy) return
      // 也看撤销历史里的节点：撤销掉的节点如果还在生成，结果要写回历史，重做时才能看到
      const s = getCanvas()
      const lists = [s.nodes, ...s.past.map((h) => h.nodes), ...s.future.map((h) => h.nodes)]
      const ids = [
        ...new Set(
          lists
            .flat()
            .filter((n): n is ImageNode => n.type === 'image')
            .map((n) => n.data.task?.id)
            .filter((id): id is string => !!id),
        ),
      ]
      if (!ids.length) return
      busy = true
      try {
        const res = await fetch(`/api/tasks?ids=${ids.join(',')}`)
        if (!res.ok) return
        const list = (await res.json()) as TaskPollResult[]
        for (const t of list) if (t.status !== 'running') applyTaskResult(t)
      } catch {
        // 网络抖动，下次再查
      } finally {
        busy = false
      }
    }
    const timer = setInterval(tick, POLL_MS)
    void tick()
    return () => clearInterval(timer)
  }, [])
}

/** 刚新建的节点：挂载后让输入框获得焦点，可以直接打字 */
export function useAutoFocus(nodeId: string, ref: React.RefObject<HTMLTextAreaElement | null>) {
  const shouldFocus = useCanvasStore((s) => s.focusNodeId === nodeId)
  useEffect(() => {
    if (!shouldFocus || !ref.current) return
    // 等 React Flow 把节点放到位再聚焦，避免浏览器滚动画布
    const t = setTimeout(() => {
      ref.current?.focus({ preventScroll: true })
      getCanvas().setFocusNode(null)
    }, 30)
    return () => clearTimeout(t)
  }, [shouldFocus, ref])
}

/** 去掉只在界面上有意义的字段 */
export function serializeNodes(nodes: AppNode[]) {
  return nodes.map((n) => {
    const { selected: _s, dragging: _d, resizing: _r, ...rest } = n
    return rest
  })
}

function payload() {
  const s = getCanvas()
  return JSON.stringify({ name: s.name, nodes: serializeNodes(s.nodes), edges: s.edges, viewport: s.viewport })
}

/** 有改动后 0.7 秒自动保存；同一时间只有一个保存请求 */
export function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let saving = false
    let again = false

    const save = async () => {
      timer = undefined
      if (saving) {
        again = true
        return
      }
      const s = getCanvas()
      if (!s.projectId) return
      saving = true
      s.setSaveState('saving')
      try {
        const res = await fetch(`/api/projects/${s.projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: payload(),
        })
        getCanvas().setSaveState(res.ok ? 'saved' : 'error')
      } catch {
        getCanvas().setSaveState('error')
      } finally {
        saving = false
        if (again) {
          again = false
          void save()
        }
      }
    }

    const unsub = useCanvasStore.subscribe((s, prev) => {
      if (s.dirty === prev.dirty || !s.projectId) return
      if (s.saveState !== 'saving') s.setSaveState('idle')
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, SAVE_DELAY_MS)
    })

    // 关页面前还有没保存的改动，用 keepalive 发出去
    const flush = () => {
      const s = getCanvas()
      if (!timer || !s.projectId) return
      clearTimeout(timer)
      timer = undefined
      void fetch(`/api/projects/${s.projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload(),
        keepalive: true,
      })
    }
    window.addEventListener('beforeunload', flush)

    // App 退出前会调用它：把还没保存的改动立刻存好，等保存完成再退出
    const w = window as unknown as { __canvasFlush?: () => Promise<void> }
    w.__canvasFlush = async () => {
      if (timer) {
        clearTimeout(timer)
        await save()
      }
      while (saving) await new Promise((r) => setTimeout(r, 50))
    }

    return () => {
      flush()
      unsub()
      window.removeEventListener('beforeunload', flush)
      delete w.__canvasFlush
    }
  }, [])
}
