import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 所有本地数据都在一个文件夹里，备份时复制这个文件夹即可。
 * 开发时是项目根目录的 data/；打包成 App 后由 App 通过 CANVAS_DATA_DIR 指定（~/Library/Application Support/画布/data）。
 */
export const DATA_DIR =
  process.env.CANVAS_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data')
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects')
export const ASSETS_DIR = path.join(DATA_DIR, 'assets')
export const TASKS_DIR = path.join(DATA_DIR, 'tasks')

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** 防止路径穿越：id 只允许字母数字和 _- */
export function assertSafeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new HttpError(400, '非法 id')
  return id
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

/** 先写临时文件再改名，避免写到一半崩溃导致文件损坏 */
export async function writeJson(file: string, data: unknown) {
  await ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data))
  await fs.rename(tmp, file)
}

export function jsonError(e: unknown) {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message }, { status: e.status })
  }
  console.error(e)
  return Response.json({ error: e instanceof Error ? e.message : '服务器错误' }, { status: 500 })
}
