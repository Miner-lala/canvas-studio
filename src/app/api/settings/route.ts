import { getSettings, toPublic, updateSettings, type SettingsPatch } from '@/server/settings'
import { jsonError } from '@/server/storage'

/** 返回设置（API Key 只返回首尾几位） */
export async function GET() {
  try {
    return Response.json(toPublic(await getSettings()))
  } catch (e) {
    return jsonError(e)
  }
}

export async function PUT(req: Request) {
  try {
    const patch = (await req.json()) as SettingsPatch
    return Response.json(toPublic(await updateSettings(patch)))
  } catch (e) {
    return jsonError(e)
  }
}
