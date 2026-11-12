'use client'

import { Check, ExternalLink, KeyRound, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

interface PublicSettings {
  openrouter: { hasKey: boolean; keyHint?: string; enabledModels: string[] }
  hideMock: boolean
}

interface ORModel {
  id: string
  name: string
  description: string
  modes: ('t2i' | 'i2i')[]
  maxRefImages: number
  aspectRatios: number
  sizes: string[]
}

type CheckResult = { ok: true; usage?: number; limit?: number | null; limit_remaining?: number | null } | { ok: false; error: string }

async function putSettings(patch: unknown): Promise<PublicSettings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || '保存失败')
  return json
}

function money(n?: number | null) {
  return typeof n === 'number' ? `$${n.toFixed(2)}` : '不限'
}

/** 设置弹窗：OpenRouter Key、要显示的模型、是否隐藏 Mock 模型。关闭时调用 onClose(changed) */
export default function SettingsModal({ onClose }: { onClose: (changed: boolean) => void }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [models, setModels] = useState<ORModel[] | null>(null)
  const [modelsError, setModelsError] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [editingKey, setEditingKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [query, setQuery] = useState('')
  const [changed, setChanged] = useState(false)

  const loadModels = async (refresh = false) => {
    setModelsError('')
    try {
      const res = await fetch(`/api/settings/openrouter-models${refresh ? '?refresh=1' : ''}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setModels(json)
    } catch (e) {
      setModelsError((e as Error).message || '获取模型列表失败')
    }
  }

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then(setSettings)
    void loadModels()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(changed)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, changed])

  const apply = async (patch: unknown) => {
    setBusy(true)
    setError('')
    try {
      setSettings(await putSettings(patch))
      setChanged(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const saveKey = async () => {
    if (!keyInput.trim()) return
    await apply({ openrouter: { apiKey: keyInput.trim() } })
    setKeyInput('')
    setEditingKey(false)
    setCheck(null)
  }

  const runCheck = async () => {
    setChecking(true)
    setCheck(null)
    try {
      const res = await fetch('/api/settings/openrouter-check', { method: 'POST' })
      setCheck(await res.json())
    } catch (e) {
      setCheck({ ok: false, error: (e as Error).message })
    } finally {
      setChecking(false)
    }
  }

  const enabled = useMemo(() => new Set(settings?.openrouter.enabledModels ?? []), [settings])
  const toggleModel = (id: string) => {
    if (!settings) return
    const list = settings.openrouter.enabledModels
    const next = enabled.has(id) ? list.filter((m) => m !== id) : [...list, id]
    setSettings({ ...settings, openrouter: { ...settings.openrouter, enabledModels: next } })
    void apply({ openrouter: { enabledModels: next } })
  }

  const shownModels = useMemo(() => {
    if (!models) return []
    const q = query.trim().toLowerCase()
    const list = q ? models.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(q)) : models
    // 已勾选的排前面，其次 GPT（openai/）系列
    const rank = (m: ORModel) => (enabled.has(m.id) ? 0 : m.id.startsWith('openai/') ? 1 : 2)
    return [...list].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
  }, [models, query, enabled])

  const showKeyInput = !settings?.openrouter.hasKey || editingKey

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onPointerDown={(e) => e.target === e.currentTarget && onClose(changed)}
    >
      <div className="flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="text-[15px] font-medium">设置</div>
          <button className="rounded-lg p-1.5 text-muted hover:bg-panel-3 hover:text-fg" onClick={() => onClose(changed)}>
            <X size={17} />
          </button>
        </div>

        {!settings ? (
          <div className="flex justify-center py-16 text-muted">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {/* ---------- OpenRouter Key ---------- */}
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-medium">OpenRouter API Key</h3>
                <a
                  href="https://openrouter.ai/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-muted hover:text-accent"
                >
                  去 OpenRouter 创建 Key
                  <ExternalLink size={12} />
                </a>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-muted">
                只保存在这台电脑的数据文件夹里（settings.json），由本地后台服务调用 OpenRouter 时使用，不会显示在页面上。
              </p>

              {showKeyInput ? (
                <div className="flex gap-2">
                  <div className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 focus-within:border-accent">
                    <KeyRound size={15} className="shrink-0 text-muted" />
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk-or-v1-…"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void saveKey()}
                      className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted/60"
                    />
                  </div>
                  <button
                    onClick={saveKey}
                    disabled={!keyInput.trim() || busy}
                    className="h-10 rounded-xl bg-accent px-4 text-sm font-medium text-black hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-panel-3 disabled:text-muted"
                  >
                    保存
                  </button>
                  {editingKey && (
                    <button
                      onClick={() => {
                        setEditingKey(false)
                        setKeyInput('')
                      }}
                      className="h-10 rounded-xl px-3 text-sm text-muted hover:bg-panel-3 hover:text-fg"
                    >
                      取消
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 text-sm">
                    <Check size={15} className="text-accent" />
                    <span className="text-fg/90">已保存</span>
                    <span className="font-mono text-xs text-muted">{settings.openrouter.keyHint}</span>
                  </div>
                  <button
                    onClick={runCheck}
                    disabled={checking}
                    className="flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm hover:bg-panel-3"
                  >
                    {checking && <Loader2 size={14} className="animate-spin" />}
                    检查 Key
                  </button>
                  <button onClick={() => setEditingKey(true)} className="h-10 rounded-xl px-3 text-sm text-muted hover:bg-panel-3 hover:text-fg">
                    更换
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('删除已保存的 OpenRouter Key？')) {
                        setCheck(null)
                        void apply({ openrouter: { apiKey: null } })
                      }
                    }}
                    className="h-10 rounded-xl px-3 text-sm text-muted hover:bg-panel-3 hover:text-danger"
                  >
                    删除
                  </button>
                </div>
              )}
              {check && (
                <div className={`mt-2 text-xs ${check.ok ? 'text-accent' : 'text-danger'}`}>
                  {check.ok
                    ? `Key 可用 · 已用 ${money(check.usage)} · 额度 ${money(check.limit)}${
                        typeof check.limit_remaining === 'number' ? ` · 剩余 ${money(check.limit_remaining)}` : ''
                      }`
                    : `Key 不可用：${check.error}`}
                </div>
              )}
            </section>

            {/* ---------- 模型 ---------- */}
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  显示哪些模型 <span className="ml-1 text-xs font-normal text-muted">已选 {enabled.size} 个</span>
                </h3>
                <button
                  onClick={() => {
                    setModels(null)
                    void loadModels(true)
                  }}
                  className="flex items-center gap-1 text-xs text-muted hover:text-fg"
                >
                  <RefreshCw size={12} />
                  刷新列表
                </button>
              </div>
              <p className="mb-3 text-xs text-muted">勾选的模型会出现在生成面板的模型下拉框里。填了 Key 才会生效。</p>
              <div className="mb-2 flex h-9 items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 focus-within:border-accent">
                <Search size={14} className="text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索模型，比如 gpt、gemini、seedream"
                  className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted/60"
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto rounded-xl border border-line">
                {modelsError ? (
                  <div className="p-4 text-xs text-danger">{modelsError}</div>
                ) : !models ? (
                  <div className="flex justify-center py-8 text-muted">
                    <Loader2 size={18} className="animate-spin" />
                  </div>
                ) : shownModels.length === 0 ? (
                  <div className="p-4 text-xs text-muted">没有匹配的模型</div>
                ) : (
                  shownModels.map((m) => {
                    const on = enabled.has(m.id)
                    return (
                      <label
                        key={m.id}
                        className="flex cursor-pointer items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-panel-2"
                        title={m.description}
                      >
                        <input type="checkbox" checked={on} onChange={() => toggleModel(m.id)} className="mt-1 accent-[var(--color-accent)]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px]">{m.name}</div>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted">
                            <span className="font-mono">{m.id}</span>
                            <span>
                              {m.modes.includes('t2i') ? '文生图' : ''}
                              {m.modes.length === 2 ? ' · ' : ''}
                              {m.modes.includes('i2i') ? `图生图（≤${m.maxRefImages} 张参考）` : ''}
                            </span>
                            {m.sizes.length > 0 && <span>{m.sizes.join(' / ')}</span>}
                          </div>
                        </div>
                      </label>
                    )
                  })
                )}
              </div>
            </section>

            {/* ---------- 其他 ---------- */}
            <section>
              <h3 className="mb-2 text-sm font-medium">其他</h3>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={settings.hideMock}
                  onChange={(e) => void apply({ hideMock: e.target.checked })}
                  className="accent-[var(--color-accent)]"
                />
                隐藏 Mock 测试模型
                <span className="text-xs text-muted">（不调用外部接口、只画占位图的两个测试模型）</span>
              </label>
            </section>

            {error && <div className="text-xs text-danger">{error}</div>}
          </div>
        )}

        <div className="flex justify-end border-t border-line px-5 py-3">
          <button
            onClick={() => onClose(changed)}
            className="h-9 rounded-xl bg-panel-3 px-4 text-sm hover:bg-line-strong"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
