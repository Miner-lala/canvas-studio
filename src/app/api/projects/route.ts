import { createProject, listProjects } from '@/server/projects'
import { jsonError } from '@/server/storage'

export async function GET() {
  try {
    return Response.json(await listProjects())
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string }
    return Response.json(await createProject(body.name))
  } catch (e) {
    return jsonError(e)
  }
}
