import type { NextRequest } from 'next/server'
import { jsonError } from '@/server/storage'
import { cancelTask } from '@/server/tasks'

export async function POST(_req: NextRequest, ctx: RouteContext<'/api/tasks/[id]/cancel'>) {
  try {
    const { id } = await ctx.params
    return Response.json({ cancelled: cancelTask(id) })
  } catch (e) {
    return jsonError(e)
  }
}
