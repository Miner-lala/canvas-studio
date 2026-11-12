import { listProviderInfo } from '@/server/providers'
import { jsonError } from '@/server/storage'

export async function GET() {
  try {
    return Response.json(await listProviderInfo())
  } catch (e) {
    return jsonError(e)
  }
}
