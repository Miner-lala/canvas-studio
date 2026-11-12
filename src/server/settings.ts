import path from 'node:path'
import { DATA_DIR, readJson, writeJson } from './storage'

/**
 * 应用设置，保存在 data/settings.json（只在你自己电脑上）。
 * API Key 只在服务端读取，接口返回给浏览器时只给末尾几位。
 */
export interface Settings {
  openrouter: {
    apiKey?: string
    /** 在生成面板里显示哪些 OpenRouter 模型 */
    enabledModels: string[]
  }
  hideMock: boolean
}

export interface PublicSettings {
  openrouter: {
    hasKey: boolean
    keyHint?: string
    enabledModels: string[]
  }
  hideMock: boolean
}

export interface SettingsPatch {
  openrouter?: {
    /** 字符串 = 设置新 Key；null = 删除 Key；不传 = 不改 */
    apiKey?: string | null
    enabledModels?: string[]
  }
  hideMock?: boolean
}

/** 默认勾选的 OpenRouter 模型：GPT 出图系列 */
export const DEFAULT_OPENROUTER_MODELS = ['openai/gpt-image-2', 'openai/gpt-image-1', 'openai/gpt-image-1-mini']

const FILE = path.join(DATA_DIR, 'settings.json')

function defaults(): Settings {
  return { openrouter: { enabledModels: DEFAULT_OPENROUTER_MODELS }, hideMock: false }
}

export async function getSettings(): Promise<Settings> {
  const s = await readJson<Partial<Settings>>(FILE)
  const d = defaults()
  return {
    openrouter: { ...d.openrouter, ...s?.openrouter },
    hideMock: s?.hideMock ?? d.hideMock,
  }
}

export function toPublic(s: Settings): PublicSettings {
  const key = s.openrouter.apiKey
  return {
    openrouter: {
      hasKey: !!key,
      keyHint: key ? `${key.slice(0, 6)}…${key.slice(-4)}` : undefined,
      enabledModels: s.openrouter.enabledModels,
    },
    hideMock: s.hideMock,
  }
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const s = await getSettings()
  if (patch.openrouter) {
    const { apiKey, enabledModels } = patch.openrouter
    if (apiKey === null) delete s.openrouter.apiKey
    else if (typeof apiKey === 'string' && apiKey.trim()) s.openrouter.apiKey = apiKey.trim()
    if (Array.isArray(enabledModels)) {
      s.openrouter.enabledModels = [...new Set(enabledModels.filter((m) => typeof m === 'string'))]
    }
  }
  if (typeof patch.hideMock === 'boolean') s.hideMock = patch.hideMock
  await writeJson(FILE, s)
  return s
}
