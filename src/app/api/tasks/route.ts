import type { NextRequest } from 'next/server'
import { jsonError } from '@/server/storage'
import { getTask, runningTaskCount } from '@/server/tasks'

/** GET /api/tasks?ids=a,b,c 批量查询任务状态；GET /api/tasks?running=1 返回正在生成的任务数 */
export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get('running')) return Response.json({ running: runningTaskCount() })
    const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 100)
    const tasks = await Promise.all(
      ids.map(async (id) => {
        const t = await getTask(id)
        if (!t) return { id, status: 'error' as const, error: '任务记录不存在' }
        return { id: t.id, status: t.status, results: t.results, error: t.error }
      }),
    )
    return Response.json(tasks)
  } catch (e) {
    return jsonError(e)
  }
}
