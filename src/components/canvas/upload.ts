'use client'

import type { AssetMeta } from '@/lib/types'
import { getCanvas } from './store'

/** 打开系统文件选择框，只选图片 */
export function pickImages(multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = multiple
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

/** 从拖入或粘贴的文件里挑出图片 */
export function imageFiles(list: FileList | File[] | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(f.name))
}

/** 上传图片到本地，返回保存后的信息；失败时弹出提示并返回 null */
export async function uploadFiles(files: File[]): Promise<AssetMeta[] | null> {
  if (!files.length) return null
  const s = getCanvas()
  s.showToast(files.length > 1 ? `正在上传 ${files.length} 张图片…` : '正在上传图片…', 'info', 0)
  try {
    const form = new FormData()
    for (const f of files) form.append('file', f)
    const res = await fetch('/api/assets', { method: 'POST', body: form })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `上传失败 ${res.status}`)
    getCanvas().hideToast()
    return json as AssetMeta[]
  } catch (e) {
    getCanvas().showToast((e as Error).message, 'error')
    return null
  }
}
