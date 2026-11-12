import { promises as fs } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import type { ProjectDoc, ProjectSummary, Viewport } from '@/lib/types'
import { assertSafeId, ensureDir, HttpError, PROJECTS_DIR, readJson, writeJson } from './storage'

function fileOf(id: string) {
  return path.join(PROJECTS_DIR, `${assertSafeId(id)}.json`)
}

interface StoredNode {
  type?: string
  data?: { versions?: { assetId: string }[]; current?: number }
}

function coverOf(doc: ProjectDoc): string | undefined {
  for (const n of doc.nodes as StoredNode[]) {
    const versions = n.type === 'image' ? n.data?.versions : undefined
    if (versions?.length) return versions[n.data?.current ?? 0]?.assetId ?? versions[0].assetId
  }
  return undefined
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await ensureDir(PROJECTS_DIR)
  const files = (await fs.readdir(PROJECTS_DIR)).filter((f) => f.endsWith('.json'))
  const docs = await Promise.all(files.map((f) => readJson<ProjectDoc>(path.join(PROJECTS_DIR, f))))
  return docs
    .filter((d): d is ProjectDoc => !!d)
    .map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      coverAssetId: coverOf(d),
      nodeCount: d.nodes.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getProject(id: string): Promise<ProjectDoc> {
  const doc = await readJson<ProjectDoc>(fileOf(id))
  if (!doc) throw new HttpError(404, '项目不存在')
  return doc
}

export async function createProject(name?: string): Promise<ProjectDoc> {
  const now = Date.now()
  const doc: ProjectDoc = {
    id: nanoid(10),
    name: name?.trim() || '未命名项目',
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
  }
  await writeJson(fileOf(doc.id), doc)
  return doc
}

// 同一个项目的写入排队执行，避免两次保存同时读改写
const g = globalThis as unknown as { __projectLocks?: Map<string, Promise<unknown>> }
const locks = (g.__projectLocks ??= new Map())

function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  locks.set(id, next)
  next.finally(() => {
    if (locks.get(id) === next) locks.delete(id)
  }).catch(() => {})
  return next
}

export function saveProject(
  id: string,
  patch: { name?: string; nodes?: unknown[]; edges?: unknown[]; viewport?: Viewport },
): Promise<ProjectDoc> {
  return withLock(id, () => doSave(id, patch))
}

async function doSave(
  id: string,
  patch: { name?: string; nodes?: unknown[]; edges?: unknown[]; viewport?: Viewport },
): Promise<ProjectDoc> {
  const doc = await getProject(id)
  if (typeof patch.name === 'string') doc.name = patch.name.trim() || doc.name
  if (Array.isArray(patch.nodes)) doc.nodes = patch.nodes
  if (Array.isArray(patch.edges)) doc.edges = patch.edges
  if (patch.viewport) doc.viewport = patch.viewport
  doc.updatedAt = Date.now()
  await writeJson(fileOf(id), doc)
  return doc
}

/** 只删项目文件；图片素材保留在 data/assets，避免误删 */
export async function deleteProject(id: string) {
  await fs.rm(fileOf(id), { force: true })
}
