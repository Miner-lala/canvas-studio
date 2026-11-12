import { NextResponse, type NextRequest } from 'next/server'

/**
 * 保护本地接口：只接受来自画布自己页面、或本机程序（比如 MCP）的请求。
 *
 * 浏览器里打开的其它网站，理论上可以偷偷向 http://127.0.0.1:端口 发请求（比如替你发起付费生成），
 * 这里把这类请求拦下：
 * - Host 必须是本机地址（防止 DNS 重绑定把别的域名指到本机）
 * - 浏览器发来的跨站请求（Sec-Fetch-Site 不是同源 / 直接访问）一律拒绝
 * - 带 Origin 的请求，来源必须和画布是同一个地址
 * 本机程序（MCP、curl）不带这些头，不受影响。
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

function hostname(host: string) {
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
}

export function proxy(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  if (!LOCAL_HOSTS.has(hostname(host))) return deny('只接受本机访问')

  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return deny('不接受其它网站发来的请求')

  const origin = req.headers.get('origin')
  if (origin && origin !== 'null') {
    try {
      if (new URL(origin).host !== host) return deny('不接受其它网站发来的请求')
    } catch {
      return deny('来源无效')
    }
  } else if (origin === 'null') {
    return deny('来源无效')
  }
  return NextResponse.next()
}

function deny(error: string) {
  return NextResponse.json({ error }, { status: 403 })
}

export const config = {
  matcher: '/api/:path*',
}
