import type { NextRequest } from 'next/server'
import { readAssetFile } from '@/server/assets'
import { jsonError } from '@/server/storage'

/** ?thumb=1 返回缩略图；?download=1 触发下载 */
export async function GET(req: NextRequest, ctx: RouteContext<'/api/assets/[id]'>) {
  try {
    const { id } = await ctx.params
    const thumb = req.nextUrl.searchParams.get('thumb') === '1'
    const download = req.nextUrl.searchParams.get('download') === '1'
    const { meta, data, mime } = await readAssetFile(id, thumb)
    const headers: Record<string, string> = {
      'Content-Type': mime,
      // 素材内容不会变，可以长期缓存
      'Cache-Control': 'public, max-age=31536000, immutable',
    }
    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${meta.file}"`
    }
    return new Response(new Uint8Array(data), { headers })
  } catch (e) {
    return jsonError(e)
  }
}
