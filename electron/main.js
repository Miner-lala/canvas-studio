// 画布 App 的主进程：
// 1. 在后台启动内置的本地服务（Next.js 独立服务，只监听 127.0.0.1，外部访问不到）
// 2. 打开一个窗口加载它
// 数据放在 ~/Library/Application Support/画布/data，日志在 ~/Library/Logs/画布/server.log
const { app, BrowserWindow, Menu, dialog, shell, utilityProcess } = require('electron')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const PREFERRED_PORT = 37210
const isMac = process.platform === 'darwin'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 只允许开一个 App 实例，避免两个服务同时写同一份数据
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const dataDir = path.join(app.getPath('userData'), 'data')
const logFile = path.join(app.getPath('logs'), 'server.log')
const stateFile = path.join(app.getPath('userData'), 'window-state.json')

let server = null
let baseUrl = null
let mainWindow = null
let quitting = false

// ---------------- 本地服务 ----------------

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
  })
}

function randomPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

async function startServer() {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  // 固定端口优先（页面地址不变），被占用时随便找一个空闲端口
  const port = (await isPortFree(PREFERRED_PORT)) ? PREFERRED_PORT : await randomPort()
  const log = fs.createWriteStream(logFile, { flags: 'a' })
  log.write(`\n---- ${new Date().toISOString()} 启动，端口 ${port} ----\n`)

  server = utilityProcess.fork(path.join(__dirname, 'server', 'server.js'), [], {
    serviceName: '画布本地服务',
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      CANVAS_DATA_DIR: dataDir,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  })
  server.stdout?.pipe(log, { end: false })
  server.stderr?.pipe(log, { end: false })
  server.on('exit', (code) => {
    log.write(`---- 服务退出，code ${code} ----\n`)
    server = null
    if (!quitting) {
      dialog.showErrorBox('画布的本地服务意外停止了', `请重新打开画布。\n\n日志：${logFile}`)
      app.quit()
    }
  })

  baseUrl = `http://127.0.0.1:${port}`
  // 等服务能响应了再加载页面
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (!server) throw new Error('本地服务启动失败')
    try {
      const res = await fetch(`${baseUrl}/api/projects`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return
    } catch {}
    await sleep(150)
  }
  throw new Error('本地服务启动超时')
}

// ---------------- 窗口 ----------------

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {
    return {}
  }
}

function saveWindowState(win) {
  try {
    const state = { ...win.getNormalBounds(), maximized: win.isMaximized() }
    fs.writeFileSync(stateFile, JSON.stringify(state))
  } catch {}
}

const LOADING_PAGE =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;
justify-content:center;background:#0e0e11;color:#8d8d99;font:13px -apple-system,BlinkMacSystemFont,sans-serif;
-webkit-app-region:drag">正在启动…</body></html>`)

function isAppUrl(url) {
  return !!baseUrl && (url === baseUrl || url.startsWith(`${baseUrl}/`))
}

function createWindow() {
  const state = loadWindowState()
  const win = new BrowserWindow({
    width: state.width ?? 1440,
    height: state.height ?? 900,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    title: '画布',
    backgroundColor: '#0e0e11',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  })
  if (state.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  // 页面里的外部链接（比如“去 OpenRouter 创建 Key”）用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isAppUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return
    e.preventDefault()
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })

  win.on('close', () => saveWindowState(win))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.loadURL(baseUrl ?? LOADING_PAGE)
  mainWindow = win
  return win
}

// ---------------- 菜单 ----------------
// 编辑菜单不能省：⌘C / ⌘V / ⌘Z 这些快捷键在 macOS 上要靠它才会传给页面

function buildMenu() {
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: '关于画布' },
              { type: 'separator' },
              { label: '在访达中显示数据文件夹', click: () => shell.openPath(dataDir) },
              { label: '查看运行日志', click: () => shell.showItemInFolder(logFile) },
              { type: 'separator' },
              { role: 'hide', label: '隐藏画布' },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '全部显示' },
              { type: 'separator' },
              { role: 'quit', label: '退出画布' },
            ],
          },
        ]
      : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { role: 'togglefullscreen', label: '进入 / 退出全屏' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '窗口',
      role: 'window',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------- 退出 ----------------

async function runningTasks() {
  if (!baseUrl || !server) return 0
  try {
    const res = await fetch(`${baseUrl}/api/tasks?running=1`, { signal: AbortSignal.timeout(2000) })
    return (await res.json()).running ?? 0
  } catch {
    return 0
  }
}

/** 让每个窗口把还没保存的改动立刻存好 */
async function flushWindows() {
  const jobs = BrowserWindow.getAllWindows().map((w) =>
    w.webContents
      .executeJavaScript('window.__canvasFlush ? window.__canvasFlush() : null', true)
      .catch(() => {}),
  )
  await Promise.race([Promise.all(jobs), sleep(5000)])
}

app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  ;(async () => {
    const n = await runningTasks()
    if (n > 0) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        message: `还有 ${n} 个生成任务没完成`,
        detail: '现在退出会中断生成，这次生成的图片拿不到。',
        buttons: ['先不退出', '仍然退出'],
        defaultId: 0,
        cancelId: 0,
      })
      if (response === 0) return
    }
    quitting = true
    await flushWindows()
    app.quit()
  })()
})

app.on('will-quit', () => {
  server?.kill()
})

// ---------------- 启动 ----------------

app.on('second-instance', () => {
  const win = mainWindow ?? createWindow()
  if (win.isMinimized()) win.restore()
  win.focus()
})

// macOS 习惯：关掉窗口 App 还在，点 Dock 图标重新打开
app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
app.on('activate', () => {
  if (!mainWindow && baseUrl) createWindow()
})

app.whenReady().then(async () => {
  buildMenu()
  const win = createWindow()
  try {
    await startServer()
    if (!win.isDestroyed()) win.loadURL(baseUrl)
  } catch (err) {
    dialog.showErrorBox('画布启动失败', `${err.message}\n\n日志：${logFile}`)
    quitting = true
    app.quit()
  }
})
