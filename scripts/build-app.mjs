// 打包成 macOS App：npm run app:build
// 产物：release/画布-darwin-<arch>/画布.app
//
// 步骤：
// 1. next build 输出独立服务端（.next/standalone，自带精简过的 node_modules）
// 2. 把服务端、静态文件、Electron 主进程组装到 build/app/
// 3. 用 @electron/packager 生成 .app，再做本机签名（ad-hoc），否则 Apple 芯片的 Mac 打不开
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { packager } from '@electron/packager'

const root = process.cwd()
const stage = path.join(root, 'build', 'app')
const out = path.join(root, 'release')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version
const arch = process.arch
const APP_NAME = '画布'

const step = (msg) => console.log(`\n▶ ${msg}`)
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true })

// ---------- 1. 构建 ----------
step('构建 Next.js 独立服务')
execSync('npx next build', { stdio: 'inherit', env: { ...process.env, CANVAS_STANDALONE: '1' } })

const standalone = path.join(root, '.next', 'standalone')
if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  throw new Error('没找到 .next/standalone/server.js，构建结果和预期不一样')
}

// ---------- 2. 组装 ----------
step('组装 App 目录 build/app')
fs.rmSync(stage, { recursive: true, force: true })
fs.mkdirSync(stage, { recursive: true })
const serverDir = path.join(stage, 'server')
copy(standalone, serverDir)
copy(path.join(root, '.next', 'static'), path.join(serverDir, '.next', 'static'))
if (fs.existsSync(path.join(root, 'public'))) copy(path.join(root, 'public'), path.join(serverDir, 'public'))
// standalone 会顺带复制一些项目文件（源码、README、开发数据等），只留运行需要的
const KEEP = new Set(['server.js', 'package.json', '.next', 'node_modules', 'public'])
for (const name of fs.readdirSync(serverDir)) {
  if (!KEEP.has(name)) fs.rmSync(path.join(serverDir, name), { recursive: true, force: true })
}

// sharp 的原生库（libvips）有时不会被自动带上，缺了就从项目里补
const imgSrc = path.join(root, 'node_modules', '@img')
const imgDst = path.join(serverDir, 'node_modules', '@img')
for (const name of fs.readdirSync(imgSrc)) {
  if (!name.includes(`darwin-${arch}`)) continue
  const dst = path.join(imgDst, name)
  if (!fs.existsSync(path.join(dst, 'package.json'))) {
    console.log(`  补上 @img/${name}`)
    fs.rmSync(dst, { recursive: true, force: true })
    copy(path.join(imgSrc, name), dst)
  }
}

fs.copyFileSync(path.join(root, 'electron', 'main.js'), path.join(stage, 'main.js'))
fs.writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify(
    { name: 'canvas-studio', productName: APP_NAME, version: pkg.version, private: true, main: 'main.js' },
    null,
    2,
  ),
)

// ---------- 3. 打包 ----------
step(`生成 .app（Electron ${electronVersion}，${arch}）`)
// npm 安装 Electron 时已经下载过同版本的压缩包，直接用缓存里的，不再重新下载
const zipName = `electron-v${electronVersion}-darwin-${arch}.zip`
const cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'electron')
const cachedZipDir = fs.existsSync(cacheRoot)
  ? fs
      .readdirSync(cacheRoot)
      .map((d) => path.join(cacheRoot, d))
      .find((d) => fs.existsSync(path.join(d, zipName)))
  : undefined

const [appDir] = await packager({
  dir: stage,
  out,
  overwrite: true,
  platform: 'darwin',
  arch,
  name: APP_NAME,
  executableName: 'CanvasStudio',
  appBundleId: 'local.canvasstudio.app',
  appVersion: pkg.version,
  appCategoryType: 'public.app-category.graphics-design',
  icon: path.join(root, 'electron', 'icon.icns'),
  electronVersion,
  electronZipDir: cachedZipDir,
  asar: false,
  prune: false,
  darwinDarkModeSupport: true,
})

const appPath = path.join(appDir, `${APP_NAME}.app`)
step('本机签名')
execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
execFileSync('codesign', ['--verify', '--deep', appPath], { stdio: 'inherit' })

const size = execSync(`du -sh "${appPath}"`).toString().split('\t')[0]
console.log(`\n✓ 打包完成：${path.relative(root, appPath)}（${size}）`)
