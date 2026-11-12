import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp, { type Metadata } from 'sharp'
import { nanoid } from 'nanoid'
import type { AssetMeta } from '@/lib/types'
import { ASSETS_DIR, assertSafeId, ensureDir, HttpError, readJson, writeJson } from './storage'

const THUMB_WIDTH = 768
const EXT_BY_FORMAT: Record<string, { ext: string; mime: string }> = {
  png: { ext: 'png', mime: 'image/png' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  webp: { ext: 'webp', mime: 'image/webp' },
  gif: { ext: 'gif', mime: 'image/gif' },
  avif: { ext: 'avif', mime: 'image/avif' },
}

interface StoredAsset extends AssetMeta {
  file: string
  createdAt: number
}

const metaFile = (id: string) => path.join(ASSETS_DIR, `${assertSafeId(id)}.json`)
const thumbFile = (id: string) => path.join(ASSETS_DIR, `${assertSafeId(id)}.thumb.webp`)

/** 保存一张图片：原图 + 768px 缩略图（画布上只加载缩略图） */
export async function saveImage(buffer: Buffer): Promise<AssetMeta> {
  await ensureDir(ASSETS_DIR)
  let info: Metadata | null = null
  try {
    // sharp 遇到不认识的格式可能同步抛错，也可能返回失败的 Promise，两种都要接住
    info = await sharp(buffer, { failOn: 'none' }).metadata()
  } catch {
    info = null
  }
  if (!info?.width || !info.height) {
    throw new HttpError(400, '不是支持的图片格式（支持 PNG、JPG、WebP、GIF、AVIF、SVG；iPhone 的 HEIC 请先转成 JPG）')
  }
  let fmt = info.format && EXT_BY_FORMAT[info.format]
  let data = buffer
  if (!fmt) {
    // 不常见的格式统一转成 PNG
    data = await sharp(buffer).png().toBuffer()
    fmt = EXT_BY_FORMAT.png
  }
  const id = nanoid(14)
  const file = `${id}.${fmt.ext}`
  // 考虑 EXIF 旋转后的真实宽高
  const rotated = (info.orientation ?? 1) >= 5
  const width = (rotated ? info.height : info.width) ?? 0
  const height = (rotated ? info.width : info.height) ?? 0

  await fs.writeFile(path.join(ASSETS_DIR, file), data)
  await sharp(data)
    .rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(thumbFile(id))

  const meta: StoredAsset = { id, width, height, mime: fmt.mime, file, createdAt: Date.now() }
  await writeJson(metaFile(id), meta)
  return { id, width, height, mime: fmt.mime }
}

export async function getAsset(id: string): Promise<StoredAsset> {
  const meta = await readJson<StoredAsset>(metaFile(id))
  if (!meta) throw new HttpError(404, '图片不存在')
  return meta
}

export async function readAssetFile(id: string, thumb: boolean) {
  const meta = await getAsset(id)
  if (thumb) {
    return { meta, data: await fs.readFile(thumbFile(id)), mime: 'image/webp' }
  }
  return { meta, data: await fs.readFile(path.join(ASSETS_DIR, meta.file)), mime: meta.mime }
}

/** 读成 base64，用来作为参考图发给模型接口 */
export async function readAssetBase64(id: string) {
  const { data, mime } = await readAssetFile(id, false)
  return { mime, base64: data.toString('base64') }
}
