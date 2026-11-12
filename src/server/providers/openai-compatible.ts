import type { ModelSpec } from '@/lib/types'
import type { ImageOut, ImageProvider } from './types'

/**
 * 示例适配器：OpenAI 兼容的图片接口（同步）。
 * 未用真实 Key 测试过，主要作为“怎么接一家 API”的参考模板。
 *
 * 文生图：POST {BASE_URL}/images/generations   (JSON)
 * 图生图：POST {BASE_URL}/images/edits         (multipart，参考图放在 image[] 里)
 *
 * 在 .env.local 里配置：
 *   OPENAI_COMPAT_API_KEY=...
 *   OPENAI_COMPAT_BASE_URL=https://api.openai.com/v1   （可换成其他兼容服务）
 *   OPENAI_COMPAT_MODELS=gpt-image-1                     （逗号分隔）
 */

// 比例 → 接口要求的像素尺寸
const SIZE_BY_ASPECT: Record<string, string> = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
}

export function createOpenAICompatibleProvider(): ImageProvider | null {
  const apiKey = process.env.OPENAI_COMPAT_API_KEY
  if (!apiKey) return null
  const baseUrl = (process.env.OPENAI_COMPAT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const modelIds = (process.env.OPENAI_COMPAT_MODELS || 'gpt-image-1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const models: ModelSpec[] = modelIds.map((id) => ({
    id,
    label: id,
    modes: ['t2i', 'i2i'],
    maxRefImages: 10,
    aspectRatios: Object.keys(SIZE_BY_ASPECT),
    sizes: ['1K'],
    maxCount: 4,
    extraParams: [
      {
        key: 'quality',
        label: '质量',
        type: 'select',
        options: [
          { value: 'auto', label: '自动' },
          { value: 'low', label: '低' },
          { value: 'medium', label: '中' },
          { value: 'high', label: '高' },
        ],
        default: 'auto',
      },
    ],
  }))

  return {
    id: 'openai-compatible',
    name: 'OpenAI 兼容接口',
    models,
    async generate(req, { signal }) {
      const size = SIZE_BY_ASPECT[req.aspectRatio] ?? '1024x1024'
      const headers = { Authorization: `Bearer ${apiKey}` }
      let res: Response

      if (req.refImages.length === 0) {
        res = await fetch(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: req.model,
            prompt: req.prompt,
            n: req.count,
            size,
            quality: req.extra.quality ?? 'auto',
          }),
          signal,
        })
      } else {
        const form = new FormData()
        form.append('model', req.model)
        form.append('prompt', req.prompt)
        form.append('n', String(req.count))
        form.append('size', size)
        form.append('quality', String(req.extra.quality ?? 'auto'))
        req.refImages.forEach((img, i) => {
          const ext = img.mime.split('/')[1] ?? 'png'
          form.append('image[]', new Blob([Buffer.from(img.base64, 'base64')], { type: img.mime }), `ref${i + 1}.${ext}`)
        })
        res = await fetch(`${baseUrl}/images/edits`, { method: 'POST', headers, body: form, signal })
      }

      const json = (await res.json().catch(() => null)) as {
        data?: { b64_json?: string; url?: string }[]
        error?: { message?: string }
      } | null
      if (!res.ok) throw new Error(json?.error?.message || `接口返回 ${res.status}`)
      const images: ImageOut[] = (json?.data ?? []).map((d) => ({ base64: d.b64_json, url: d.url }))
      return { images }
    },
  }
}
