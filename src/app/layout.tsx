import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '画布',
  description: '节点式无限画布，用来生成图片',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // 有些浏览器插件会在页面加载前往 <html>/<body> 上加属性（比如 mpa-version），
    // 和服务端渲染的不一致，React 会报 hydration 警告。这里告诉 React 忽略这两个标签上的属性差异。
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
