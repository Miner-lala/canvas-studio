import type { ModelSpec } from '@/lib/types'

/**
 * 接入一家新的图片 API，只需要实现这个接口，然后在 ./index.ts 里注册。
 *
 * - 同步接口（请求会一直等到出图）：实现 generate
 * - 异步接口（先拿任务号，再查询结果）：实现 submit + poll，轮询由框架负责
 */
export interface ImageProvider {
  id: string
  name: string
  models: ModelSpec[]

  generate?(req: GenerateRequest, ctx: ProviderContext): Promise<GenerateResult>

  submit?(req: GenerateRequest, ctx: ProviderContext): Promise<{ taskId: string }>
  poll?(taskId: string, ctx: ProviderContext): Promise<PollResult>
  /** 异步接口的轮询间隔，默认 2000ms */
  pollIntervalMs?: number
}

export interface ProviderContext {
  /** 用户点取消或超时时会触发，传给 fetch 即可 */
  signal: AbortSignal
}

export interface RefImage {
  mime: string
  /** 不带 data: 前缀的 base64 */
  base64: string
}

export interface GenerateRequest {
  model: string
  prompt: string
  /** 参考图，顺序和画布上的“图1、图2…”一致 */
  refImages: RefImage[]
  aspectRatio: string
  size: string
  count: number
  extra: Record<string, unknown>
}

/** 返回 base64 或 url 任意一种都行，框架会下载并保存到本地 */
export interface ImageOut {
  base64?: string
  url?: string
}

export interface GenerateResult {
  images: ImageOut[]
}

export type PollResult =
  | { status: 'running' }
  | { status: 'done'; images: ImageOut[] }
  | { status: 'error'; error: string }
