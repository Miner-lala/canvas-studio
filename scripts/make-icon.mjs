// 生成 App 图标：electron/icon.png（1024px）和 electron/icon.icns
// 用法：node scripts/make-icon.mjs（只在想换图标时运行一次）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const outDir = path.join(process.cwd(), 'electron')

// 1024 画布，图标主体是 824 的圆角方块（macOS 图标规范的留白）
const dots = []
for (let y = 128; y < 924; y += 52) for (let x = 128; x < 924; x += 52) dots.push(`<circle cx="${x}" cy="${y}" r="3.2"/>`)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#26262d"/>
      <stop offset="1" stop-color="#101013"/>
    </linearGradient>
    <linearGradient id="img" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5eead4"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
    <clipPath id="squircle"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
    <clipPath id="imgclip"><rect x="548" y="392" width="270" height="330" rx="34"/></clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>

  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>
  <g clip-path="url(#squircle)" fill="#ffffff" fill-opacity="0.07">${dots.join('')}</g>
  <rect x="100.5" y="100.5" width="823" height="823" rx="186" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="3"/>

  <!-- 连线：文本节点 → 图片节点 -->
  <path d="M 478 392 C 540 392, 500 557, 548 557" fill="none" stroke="#2dd4bf" stroke-width="16" stroke-linecap="round"/>

  <!-- 文本节点 -->
  <g filter="url(#shadow)">
    <rect x="206" y="300" width="272" height="184" rx="30" fill="#2a2a31" stroke="#43434d" stroke-width="4"/>
  </g>
  <rect x="242" y="346" width="168" height="18" rx="9" fill="#8d8d99"/>
  <rect x="242" y="383" width="200" height="18" rx="9" fill="#8d8d99" fill-opacity="0.7"/>
  <rect x="242" y="420" width="120" height="18" rx="9" fill="#8d8d99" fill-opacity="0.5"/>

  <!-- 图片节点 -->
  <g filter="url(#shadow)">
    <rect x="548" y="392" width="270" height="330" rx="34" fill="url(#img)"/>
  </g>
  <g clip-path="url(#imgclip)">
    <circle cx="742" cy="478" r="34" fill="#f0fdfa" fill-opacity="0.9"/>
    <path d="M 548 722 L 548 640 L 636 548 L 718 630 L 760 592 L 818 650 L 818 722 Z" fill="#134e4a" fill-opacity="0.75"/>
  </g>

  <!-- 连接点 -->
  <circle cx="478" cy="392" r="20" fill="#101013" stroke="#2dd4bf" stroke-width="8"/>
  <circle cx="548" cy="557" r="20" fill="#101013" stroke="#2dd4bf" stroke-width="8"/>
</svg>`

fs.mkdirSync(outDir, { recursive: true })
const png = await sharp(Buffer.from(svg)).png().toBuffer()
fs.writeFileSync(path.join(outDir, 'icon.png'), png)

// 用 macOS 自带的 iconutil 生成 .icns
const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-icon-')) + '/icon.iconset'
fs.mkdirSync(iconset)
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = size * scale
    const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`
    await sharp(png).resize(px, px).png().toFile(path.join(iconset, name))
  }
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(outDir, 'icon.icns')])
fs.rmSync(path.dirname(iconset), { recursive: true, force: true })
console.log('图标已生成：electron/icon.png、electron/icon.icns')
