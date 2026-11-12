import { nanoid } from 'nanoid'
import { HttpError } from './storage'

/**
 * 远程控制通道：MCP 等外部工具发来的指令，交给已经打开这个项目的画布页面去执行。
 *
 * 为什么不直接改项目文件：画布开着时会自动保存，直接改文件会被页面上的内容覆盖。
 * 所以指令都由页面执行（和手动操作走同一套逻辑），页面每秒来取一次指令，执行完把结果交回来。
 */

export interface RemoteCommand {
  id: string
  type: string
  args: unknown
}

interface Pending {
  projectId: string
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface RemoteState {
  queues: Map<string, RemoteCommand[]>
  pending: Map<string, Pending>
  /** 每个项目最近一次被画布页面轮询的时间 */
  seen: Map<string, number>
}
const g = globalThis as unknown as { __remote?: RemoteState }
const state: RemoteState = (g.__remote ??= { queues: new Map(), pending: new Map(), seen: new Map() })

/** 页面每秒轮询一次，超过这个时间没来取，就当作项目没打开 */
const OPEN_WINDOW_MS = 4000

export function isOpen(projectId: string) {
  return Date.now() - (state.seen.get(projectId) ?? 0) < OPEN_WINDOW_MS
}

/** 外部工具发指令，等页面执行完返回结果 */
export function sendCommand(projectId: string, type: string, args: unknown, timeoutMs = 30000) {
  if (!isOpen(projectId)) throw new HttpError(409, '这个项目没有在画布上打开')
  const cmd: RemoteCommand = { id: nanoid(12), type, args }
  const queue = state.queues.get(projectId) ?? []
  queue.push(cmd)
  state.queues.set(projectId, queue)
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(cmd.id)
      const q = state.queues.get(projectId)
      if (q) state.queues.set(projectId, q.filter((c) => c.id !== cmd.id))
      reject(new HttpError(504, '画布没有及时响应（页面可能已关闭或卡住）'))
    }, timeoutMs)
    state.pending.set(cmd.id, { projectId, resolve, reject, timer })
  })
}

/** 页面来取指令（顺便记录“这个项目开着”） */
export function takeCommands(projectId: string): RemoteCommand[] {
  state.seen.set(projectId, Date.now())
  const queue = state.queues.get(projectId) ?? []
  state.queues.delete(projectId)
  return queue
}

/** 页面交回执行结果 */
export function completeCommand(projectId: string, id: string, ok: boolean, result: unknown, error?: string) {
  const p = state.pending.get(id)
  if (!p || p.projectId !== projectId) return
  clearTimeout(p.timer)
  state.pending.delete(id)
  if (ok) p.resolve(result)
  else p.reject(new HttpError(400, error || '执行失败'))
}

/**
 * 让打包后的 App 窗口打开某个项目：服务跑在 App 的子进程里，通过 parentPort 通知主进程。
 * 不是在 App 里运行（比如 npm run dev）时返回 false，由调用方自己用浏览器打开。
 */
export function askAppToOpen(projectId: string) {
  const port = (process as unknown as { parentPort?: { postMessage: (m: unknown) => void } }).parentPort
  if (!port) return false
  port.postMessage({ type: 'open-project', projectId })
  return true
}
