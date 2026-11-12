/** 图片地址：thumb=true 时返回缩略图（画布上用），否则返回原图 */
export const assetUrl = (id: string, thumb = false) => `/api/assets/${id}${thumb ? '?thumb=1' : ''}`
