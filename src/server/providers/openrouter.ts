import type { ModelSpec, ParamSchema } from '@/lib/types'
import type { ImageOut, ImageProvider } from './types'

/**
 * OpenRouter 出图接口（同步）：POST https://openrouter.ai/api/v1/images
 *
 * 模型清单和每个模型支持的参数来自 https://openrouter.ai/api/v1/images/models （公开接口，不需要 Key），
 * 这里把它自动转换成生成面板用的 ModelSpec：比例、清晰度、张数、参考图上限、画质、背景、格式。
 */

const BASE = 'https://openrouter.ai/api/v1'
const CACHE_MS = 10 * 60 * 1000

type EnumParam = { type: 'enum'; values: string[] }
type RangeParam = { type: 'range'; min: number; max: number }
type BoolParam = { type: 'boolean' }
type SupportedParam = EnumParam | RangeParam | BoolParam

export interface OpenRouterImageModel {
  id: string
  name: string
  description?: string
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  supported_parameters?: Record<string, SupportedParam>
}

const g = globalThis as unknown as { __orModels?: { at: number; list: OpenRouterImageModel[] } }

/** 拉取 OpenRouter 的出图模型清单（缓存 10 分钟） */
export async function fetchOpenRouterModels(force = false): Promise<OpenRouterImageModel[]> {
  const cached = g.__orModels
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.list
  const res = await fetch(`${BASE}/images/models`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`获取 OpenRouter 模型列表失败：${res.status}`)
  const json = (await res.json()) as { data?: OpenRouterImageModel[] }
  const list = json.data ?? []
  g.__orModels = { at: Date.now(), list }
  return list
}

const enumOf = (p?: SupportedParam) => (p?.type === 'enum' ? p.values : undefined)
const rangeOf = (p?: SupportedParam) => (p?.type === 'range' ? p : undefined)

// 选项文字带上名词，底栏摘要里一眼能看懂（“自动画质 · 透明背景”）
const QUALITY_LABEL: Record<string, string> = {
  auto: '自动画质',
  low: '低画质',
  medium: '中画质',
  high: '高画质',
  xhigh: '超高画质',
  max: '极致画质',
}
const BACKGROUND_LABEL: Record<string, string> = { auto: '自动背景', transparent: '透明背景', opaque: '不透明背景' }

function selectParam(
  key: string,
  label: string,
  values: string[] | undefined,
  labels: Record<string, string> | ((v: string) => string),
  extra: Partial<ParamSchema> = {},
): ParamSchema | null {
  if (!values?.length) return null
  const toLabel = typeof labels === 'function' ? labels : (v: string) => labels[v] ?? v
  return {
    key,
    label,
    type: 'select',
    options: values.map((v) => ({ value: v, label: toLabel(v) })),
    default: values.includes('auto') ? 'auto' : values[0],
    ...extra,
  }
}

/** “自动”排在最前面；其余保持接口给的顺序 */
function autoFirst(list: string[]) {
  return list.includes('auto') ? ['auto', ...list.filter((v) => v !== 'auto')] : list
}

/** 把 OpenRouter 的模型描述转换成生成面板用的 ModelSpec */
export function toModelSpec(m: OpenRouterImageModel): ModelSpec {
  const sp = m.supported_parameters ?? {}
  const refs = rangeOf(sp.input_references)
  const n = rangeOf(sp.n)
  const nMax = Math.max(1, n?.max ?? 1)
  const maxRefImages = refs?.max ?? 0
  const needsRef = (refs?.min ?? 0) > 0

  const extraParams = [
    selectParam('quality', '画质', enumOf(sp.quality), QUALITY_LABEL),
    selectParam('background', '背景', enumOf(sp.background), BACKGROUND_LABEL),
    selectParam('output_format', '格式', enumOf(sp.output_format), (v) => v.toUpperCase(), {
      placement: 'bar',
      default: enumOf(sp.output_format)?.includes('png') ? 'png' : undefined,
    }),
    sp.seed ? ({ key: 'seed', label: '种子', type: 'number', min: 0, step: 1 } satisfies ParamSchema) : null,
  ].filter((p): p is ParamSchema => !!p)

  return {
    id: m.id,
    label: m.name.replace(/^[^:]+:\s*/, ''),
    modes: needsRef ? ['i2i'] : maxRefImages > 0 ? ['t2i', 'i2i'] : ['t2i'],
    maxRefImages,
    // 模型不支持指定比例/清晰度时用 auto 占位，请求里不传
    aspectRatios: autoFirst(enumOf(sp.aspect_ratio) ?? ['auto']),
    sizes: enumOf(sp.resolution) ?? ['auto'],
    // 一次只能出 1 张的模型，多张时会并行发多次请求
    maxCount: 10,
    extraParams,
  }
}

interface ImagesResponse {
  data?: { b64_json?: string; url?: string; media_type?: string }[]
  error?: { message?: string; code?: number }
}

export function createOpenRouterProvider(opts: {
  apiKey: string
  models: OpenRouterImageModel[]
}): ImageProvider {
  const byId = new Map(opts.models.map((m) => [m.id, m]))
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    models: opts.models.map(toModelSpec),
    async generate(req, { signal }) {
      const meta = byId.get(req.model)
      const sp = meta?.supported_parameters ?? {}
      const nMax = Math.max(1, rangeOf(sp.n)?.max ?? 1)

      const body: Record<string, unknown> = { model: req.model, prompt: req.prompt }
      if (sp.aspect_ratio && req.aspectRatio !== 'auto') body.aspect_ratio = req.aspectRatio
      else if (enumOf(sp.aspect_ratio)?.includes('auto')) body.aspect_ratio = 'auto'
      if (sp.resolution && req.size !== 'auto') body.resolution = req.size
      for (const key of ['quality', 'background', 'output_format'] as const) {
        const v = req.extra[key]
        if (sp[key] && typeof v === 'string' && v) body[key] = v
      }
      if (sp.seed && req.extra.seed !== undefined && req.extra.seed !== '') body.seed = Number(req.extra.seed)
      if (req.refImages.length) {
        body.input_references = req.refImages.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mime};base64,${img.base64}` },
        }))
      }

      // 张数超过模型单次上限时拆成多次请求并行发
      const batches: number[] = []
      for (let left = req.count; left > 0; left -= nMax) batches.push(Math.min(nMax, left))

      const call = async (n: number): Promise<ImageOut[]> => {
        const res = await fetch(`${BASE}/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(n > 1 ? { ...body, n } : body),
          signal,
        })
        const json = (await res.json().catch(() => null)) as ImagesResponse | null
        if (!res.ok || json?.error) {
          const msg = json?.error?.message || `HTTP ${res.status}`
          if (res.status === 401) throw new Error(`OpenRouter Key 无效或已过期（${msg}）`)
          // OpenRouter 会按“最贵的可能”给每个进行中的请求先预留余额，同时生成的多了，账户里明明有钱也会被拒
          if (res.status === 402 && /in-flight/i.test(msg))
            throw new Error(
              'OpenRouter 可用额度暂时不够：账户里有余额，但正在生成的图片占住了预留额度（刚取消的生成在 OpenRouter 那边可能还没结束）。等前面的生成完成后再试，或者调低画质、减少张数。',
            )
          if (res.status === 402) throw new Error(`OpenRouter 余额不足（${msg}）`)
          throw new Error(`OpenRouter：${msg}`)
        }
        return (json?.data ?? []).map((d) => ({ base64: d.b64_json, url: d.url }))
      }

      const results = await Promise.allSettled(batches.map(call))
      const images = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      if (!images.length) {
        const firstErr = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
        throw firstErr?.reason ?? new Error('OpenRouter 没有返回图片')
      }
      return { images }
    },
  }
}

/** 用 Key 查询账户信息，测试 Key 是否可用 */
export async function checkOpenRouterKey(apiKey: string) {
  const res = await fetch(`${BASE}/key`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  })
  const json = (await res.json().catch(() => null)) as {
    data?: { label?: string; usage?: number; limit?: number | null; limit_remaining?: number | null }
    error?: { message?: string }
  } | null
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`)
  return json?.data ?? {}
}
