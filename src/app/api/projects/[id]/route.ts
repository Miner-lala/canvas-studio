import type { NextRequest } from 'next/server'
import { deleteProject, getProject, saveProject } from '@/server/projects'
import { jsonError } from '@/server/storage'

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/projects/[id]'>) {
  try {
    const { id } = await ctx.params
    return Response.json(await getProject(id))
  } catch (e) {
    return jsonError(e)
  }
}

/** 保存画布（自动保存会调用），也可以只改名字 */
export async function PUT(req: NextRequest, ctx: RouteContext<'/api/projects/[id]'>) {
  try {
    const { id } = await ctx.params
    const body = await req.json()
    const doc = await saveProject(id, body)
    return Response.json({ updatedAt: doc.updatedAt, name: doc.name })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/projects/[id]'>) {
  try {
    const { id } = await ctx.params
    await deleteProject(id)
    return Response.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
