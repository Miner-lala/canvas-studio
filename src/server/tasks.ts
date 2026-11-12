import path from 'node:path'
import { nanoid } from 'nanoid'
import type { AssetMeta, GenerateBody, TaskRecord } from '@/lib/types'
import { readAssetBase64, saveImage } from './assets'
import { getProvider } from './providers'
import type { ImageOut } from './providers/types'
import { assertSafeId, HttpError, readJson, TASKS_DIR, writeJson } from './storage'

const TASK_TIMEOUT_MS = 10 * 60 * 1000

// 正在运行的任务（放在 globalThis 上，开发模式热更新时不会丢）
const g = globalThis as unknown as { __runningTasks?: Map<string, AbortController> }
const running = (g.__runningTasks ??= new Map())

const fileOf = (id: string) => path.join(TASKS_DIR, `${assertSafeId(id)}.json`)

async function update(task: TaskRecord, patch: Partial<TaskRecord>) {
  Object.assign(task, patch, { updatedAt: Date.now() })
  await writeJson(fileOf(task.id), task)
}

export async function getTask(id: string): Promise<TaskRecord | null> {
  const task = await readJson<TaskRecord>(fileOf(id))
  // 文件里是 running，但进程里没有它：说明服务重启过，任务已经中断
  if (task && task.status === 'running' && !running.has(id)) {
    await update(task, { status: 'error', error: '服务重启，任务中断了，请重试' })
  }
  return task
}

/** 当前正在生成的任务数（App 退出前用来提醒） */
export function runningTaskCount() {
  return running.size
}

export function cancelTask(id: string) {
  const ctrl = running.get(id)
  if (!ctrl) return false
  ctrl.abort(new Error('已取消'))
  return true
}

async function validate(body: GenerateBody) {
  const provider = await getProvider(body.providerId)
  if (!provider) throw new HttpError(400, `找不到模型提供方：${body.providerId}`)
  const model = provider.models.find((m) => m.id === body.modelId)
  if (!model) throw new HttpError(400, `找不到模型：${body.modelId}`)
  const refs = body.refAssetIds ?? []
  if (!body.prompt?.trim() && refs.length === 0) throw new HttpError(400, '请先写提示词')
  if (refs.length > 0 && !model.modes.includes('i2i')) throw new HttpError(400, `${model.label} 不支持参考图`)
  if (refs.length === 0 && !model.modes.includes('t2i')) throw new HttpError(400, `${model.label} 需要至少一张参考图`)
  if (refs.length > model.maxRefImages) throw new HttpError(400, `${model.label} 最多支持 ${model.maxRefImages} 张参考图`)
  const count = Math.max(1, Math.min(model.maxCount, Math.floor(body.count || 1)))
  return { provider, model, count }
}

export async function createTask(body: GenerateBody): Promise<TaskRecord> {
  const { count } = await validate(body)
  assertSafeId(body.projectId)
  const now = Date.now()
  const task: TaskRecord = {
    id: nanoid(12),
    projectId: body.projectId,
    nodeId: body.nodeId,
    status: 'running',
    request: { ...body, count, refAssetIds: body.refAssetIds ?? [], extra: body.extra ?? {} },
    createdAt: now,
    updatedAt: now,
  }
  const ctrl = new AbortController()
  running.set(task.id, ctrl)
  try {
    await writeJson(fileOf(task.id), task)
  } catch (e) {
    running.delete(task.id)
    throw e
  }
  // 不等待：接口立刻返回任务号，前端轮询进度
  void runTask(task, ctrl)
  return task
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(signal.reason)
    })
  })
}

async function saveImageOut(out: ImageOut, signal: AbortSignal): Promise<AssetMeta> {
  if (out.base64) {
    const b64 = out.base64.replace(/^data:[^;]+;base64,/, '')
    return saveImage(Buffer.from(b64, 'base64'))
  }
  if (out.url) {
    const res = await fetch(out.url, { signal })
    if (!res.ok) throw new Error(`下载生成结果失败：${res.status}`)
    return saveImage(Buffer.from(await res.arrayBuffer()))
  }
  throw new Error('接口返回的图片既没有 base64 也没有 url')
}

async function runTask(task: TaskRecord, ctrl: AbortController) {
  const timeout = setTimeout(() => ctrl.abort(new Error('生成超时（超过 10 分钟）')), TASK_TIMEOUT_MS)
  const signal = ctrl.signal
  try {
    const { provider } = await validate(task.request)
    const req = task.request
    const refImages = await Promise.all(req.refAssetIds.map((id) => readAssetBase64(id)))
    const genReq = {
      model: req.modelId,
      prompt: req.prompt,
      refImages,
      aspectRatio: req.aspectRatio,
      size: req.size,
      count: req.count,
      extra: req.extra,
    }

    let images: ImageOut[]
    if (provider.generate) {
      images = (await provider.generate(genReq, { signal })).images
    } else if (provider.submit && provider.poll) {
      const { taskId } = await provider.submit(genReq, { signal })
      await update(task, { providerTaskId: taskId })
      for (;;) {
        await sleep(provider.pollIntervalMs ?? 2000, signal)
        const r = await provider.poll(taskId, { signal })
        if (r.status === 'done') {
          images = r.images
          break
        }
        if (r.status === 'error') throw new Error(r.error)
      }
    } else {
      throw new Error(`${provider.name} 没有实现 generate 或 submit/poll`)
    }

    if (signal.aborted) throw signal.reason
    if (!images.length) throw new Error('接口没有返回图片')
    const results = await Promise.all(images.map((img) => saveImageOut(img, signal)))
    await update(task, { status: 'done', results })
  } catch (e) {
    const err = signal.aborted ? signal.reason : e
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[task ${task.id}]`, message)
    await update(task, { status: 'error', error: message })
  } finally {
    clearTimeout(timeout)
    running.delete(task.id)
  }
}
