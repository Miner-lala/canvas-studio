import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 打包 App 时（npm run app:build）输出独立的服务端，App 里直接运行它
  output: process.env.CANVAS_STANDALONE ? 'standalone' : undefined,
  // App 里的页面缓存只放内存，不往 App 包里写文件（写了会破坏 App 的签名）
  experimental: process.env.CANVAS_STANDALONE ? { isrFlushToDisk: false } : undefined,
  serverExternalPackages: ['sharp'],
  devIndicators: false,
}

export default nextConfig
