import type { NextRequest } from 'next/server'
import { completeCommand, takeCommands } from '@/server/remote'
import { assertSafeId, jsonError } from '@/server/storage'

/** GET：画布页面来取待执行的指令 */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/remote/[projectId]/poll'>) {
  try {
    const projectId = assertSafeId((await ctx.params).projectId)
    return Response.json(takeCommands(projectId))
  } catch (e) {
    return jsonError(e)
  }
}

/** POST { id, ok, result, error }：画布页面交回执行结果 */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/remote/[projectId]/poll'>) {
  try {
    const projectId = assertSafeId((await ctx.params).projectId)
    const b = (await req.json()) as { id?: string; ok?: boolean; result?: unknown; error?: string }
    if (typeof b.id === 'string') completeCommand(projectId, b.id, !!b.ok, b.result, b.error)
    return Response.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
