import type { NextRequest } from 'next/server'
import { fetchOpenRouterModels, toModelSpec } from '@/server/providers/openrouter'
import { jsonError } from '@/server/storage'

/** OpenRouter 上所有能出图的模型，给设置页勾选用 */
export async function GET(req: NextRequest) {
  try {
    const list = await fetchOpenRouterModels(req.nextUrl.searchParams.get('refresh') === '1')
    return Response.json(
      list.map((m) => {
        const spec = toModelSpec(m)
        return {
          id: m.id,
          name: m.name,
          description: m.description ?? '',
          modes: spec.modes,
          maxRefImages: spec.maxRefImages,
          aspectRatios: spec.aspectRatios.length,
          sizes: spec.sizes.filter((s) => s !== 'auto'),
        }
      }),
    )
  } catch (e) {
    return jsonError(e)
  }
}
