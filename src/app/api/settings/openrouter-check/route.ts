import { checkOpenRouterKey } from '@/server/providers/openrouter'
import { getSettings } from '@/server/settings'
import { jsonError } from '@/server/storage'

/** 用已保存的 Key 查询 OpenRouter 账户信息，确认 Key 能用 */
export async function POST() {
  try {
    const { apiKey } = (await getSettings()).openrouter
    if (!apiKey) return Response.json({ ok: false, error: '还没有保存 Key' })
    try {
      const info = await checkOpenRouterKey(apiKey)
      return Response.json({ ok: true, ...info })
    } catch (e) {
      return Response.json({ ok: false, error: (e as Error).message })
    }
  } catch (e) {
    return jsonError(e)
  }
}
