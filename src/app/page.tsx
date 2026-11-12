'use client'

import { ImageIcon, Loader2, Pencil, Plus, Settings, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import SettingsModal from '@/components/SettingsModal'
import { assetUrl } from '@/lib/asset-url'
import type { ProjectSummary } from '@/lib/types'

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export default function Home() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  const load = async () => {
    const res = await fetch('/api/projects')
    setProjects(await res.json())
  }
  useEffect(() => {
    void load()
  }, [])

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/projects', { method: 'POST', body: '{}' })
      const doc = await res.json()
      router.push(`/p/${doc.id}`)
    } finally {
      setCreating(false)
    }
  }

  const rename = async (id: string) => {
    setEditing(null)
    const name = draft.trim()
    if (!name) return
    setProjects((ps) => ps?.map((p) => (p.id === id ? { ...p, name } : p)) ?? null)
    await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  }

  const remove = async (p: ProjectSummary) => {
    if (!confirm(`删除项目「${p.name}」？\n画布会被删除，生成过的图片仍保留在 data/assets 文件夹里。`)) return
    setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null)
    await fetch(`/api/projects/${p.id}`, { method: 'DELETE' })
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">画布</h1>
          <p className="mt-1 text-sm text-muted">在无限画布上用节点生成图片</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(true)}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-line px-3.5 text-sm text-fg/85 hover:bg-panel-3 hover:text-fg"
          >
            <Settings size={16} />
            设置
          </button>
          <button
            onClick={create}
            disabled={creating}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-medium text-black hover:bg-accent-strong disabled:opacity-60"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            新建项目
          </button>
        </div>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {projects === null ? (
        <div className="flex justify-center py-20 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <button
          onClick={create}
          className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong py-24 text-muted hover:border-accent hover:text-fg"
        >
          <Plus size={28} strokeWidth={1.5} />
          <span className="text-sm">还没有项目，新建一个开始</span>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group overflow-hidden rounded-2xl border border-line bg-panel transition-colors hover:border-line-strong"
            >
              <Link href={`/p/${p.id}`} className="block aspect-[4/3] bg-panel-2">
                {p.coverAssetId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(p.coverAssetId, true)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted/60">
                    <ImageIcon size={32} strokeWidth={1.2} />
                  </div>
                )}
              </Link>
              <div className="flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  {editing === p.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => rename(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void rename(p.id)
                        if (e.key === 'Escape') setEditing(null)
                      }}
                      className="w-full rounded-md bg-panel-3 px-1.5 py-0.5 text-sm outline-none"
                    />
                  ) : (
                    <Link href={`/p/${p.id}`} className="block truncate text-sm">
                      {p.name}
                    </Link>
                  )}
                  <div className="mt-0.5 text-xs text-muted">
                    {timeAgo(p.updatedAt)} · {p.nodeCount} 个节点
                  </div>
                </div>
                <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    className="rounded-md p-1.5 text-muted hover:bg-panel-3 hover:text-fg"
                    title="重命名"
                    onClick={() => {
                      setDraft(p.name)
                      setEditing(p.id)
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="rounded-md p-1.5 text-muted hover:bg-panel-3 hover:text-danger"
                    title="删除"
                    onClick={() => remove(p)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
