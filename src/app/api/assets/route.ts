import type { AssetMeta } from '@/lib/types'
import { saveImage } from '@/server/assets'
import { HttpError, jsonError } from '@/server/storage'

const MAX_BYTES = 50 * 1024 * 1024

/** 上传图片（multipart，字段名 file，可多张）。返回每张图的 id 和宽高 */
export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const files = form.getAll('file').filter((f): f is File => f instanceof File)
    if (!files.length) throw new HttpError(400, '没有收到图片')
    const results: AssetMeta[] = []
    for (const f of files) {
      if (f.size > MAX_BYTES) throw new HttpError(413, `「${f.name}」超过 50MB`)
      try {
        results.push(await saveImage(Buffer.from(await f.arrayBuffer())))
      } catch (e) {
        if (e instanceof HttpError) throw new HttpError(e.status, `「${f.name}」${e.message}`)
        throw e
      }
    }
    return Response.json(results)
  } catch (e) {
    return jsonError(e)
  }
}
