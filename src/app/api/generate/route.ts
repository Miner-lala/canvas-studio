import type { GenerateBody } from '@/lib/types'
import { jsonError } from '@/server/storage'
import { createTask } from '@/server/tasks'

/** 创建生成任务，立刻返回任务号；结果通过 /api/tasks 查询 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GenerateBody
    const task = await createTask(body)
    return Response.json({ taskId: task.id })
  } catch (e) {
    return jsonError(e)
  }
}
