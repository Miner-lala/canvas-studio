import type { ProviderInfo } from '@/lib/types'
import { getSettings } from '../settings'
import { mockAsyncProvider, mockProvider } from './mock'
import { createOpenAICompatibleProvider } from './openai-compatible'
import { createOpenRouterProvider, fetchOpenRouterModels } from './openrouter'
import type { ImageProvider } from './types'

/**
 * 模型注册表。每次请求时根据设置（data/settings.json）和环境变量组装。
 *
 * 新接一家 API：
 *   1. 在本目录新建一个文件，实现 ImageProvider（参考 openrouter.ts 或 mock.ts）
 *   2. 在下面的 list 里加上它
 * 生成面板里的模型、比例、清晰度、张数和额外参数会自动出现。
 */
export async function getProviders(): Promise<ImageProvider[]> {
  const settings = await getSettings()
  const list: (ImageProvider | null)[] = []

  // OpenRouter：在设置里填了 Key 并勾选了模型才会出现
  const { apiKey, enabledModels } = settings.openrouter
  if (apiKey && enabledModels.length) {
    try {
      const all = await fetchOpenRouterModels()
      const order = new Map(enabledModels.map((id, i) => [id, i]))
      const models = all.filter((m) => order.has(m.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      if (models.length) list.push(createOpenRouterProvider({ apiKey, models }))
    } catch (e) {
      console.error('[openrouter]', (e as Error).message)
    }
  }

  // ↓ 在这里注册你自己的适配器
  list.push(createOpenAICompatibleProvider())

  if (!settings.hideMock && process.env.HIDE_MOCK !== '1') list.push(mockProvider, mockAsyncProvider)
  return list.filter((p): p is ImageProvider => !!p)
}

export async function getProvider(id: string): Promise<ImageProvider | undefined> {
  return (await getProviders()).find((p) => p.id === id)
}

export async function listProviderInfo(): Promise<ProviderInfo[]> {
  return (await getProviders()).map(({ id, name, models }) => ({ id, name, models }))
}
