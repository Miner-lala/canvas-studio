import type { NextRequest } from 'next/server'
import { getProject } from '@/server/projects'
import { askAppToOpen, isOpen } from '@/server/remote'
import { assertSafeId, jsonError } from '@/server/storage'

/** POST：在画布里打开这个项目。在 App 里运行时由 App 窗口打开；否则返回 app: false，由调用方用浏览器打开 */
export async function POST(_req: NextRequest, ctx: RouteContext<'/api/remote/[projectId]/open'>) {
  try {
    const projectId = assertSafeId((await ctx.params).projectId)
    await getProject(projectId) // 项目不存在时直接报错
    if (isOpen(projectId)) return Response.json({ app: false, open: true })
    return Response.json({ app: askAppToOpen(projectId), open: false })
  } catch (e) {
    return jsonError(e)
  }
}
