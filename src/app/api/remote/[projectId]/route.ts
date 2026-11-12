import type { NextRequest } from 'next/server'
import { isOpen, sendCommand } from '@/server/remote'
import { assertSafeId, HttpError, jsonError } from '@/server/storage'

/** GET：这个项目现在有没有在画布上打开 */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/remote/[projectId]'>) {
  try {
    const projectId = assertSafeId((await ctx.params).projectId)
    return Response.json({ open: isOpen(projectId) })
  } catch (e) {
    return jsonError(e)
  }
}

/** POST { type, args }：发一条指令给打开着的画布，等它执行完返回结果（MCP 用） */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/remote/[projectId]'>) {
  try {
    const projectId = assertSafeId((await ctx.params).projectId)
    const body = (await req.json()) as { type?: unknown; args?: unknown }
    if (typeof body.type !== 'string') throw new HttpError(400, '缺少指令类型')
    const result = await sendCommand(projectId, body.type, body.args ?? {})
    return Response.json({ result })
  } catch (e) {
    return jsonError(e)
  }
}
