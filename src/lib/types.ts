// 前后端共用的数据类型

/** 模型特有参数的描述，生成面板会据此自动渲染表单 */
export interface ParamSchema {
  key: string
  label: string
  type: 'select' | 'number' | 'boolean' | 'text'
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  default?: string | number | boolean
  /** 'bar'：单独做成底栏上的一个下拉框（适合输出格式这类常改的）；默认放进参数弹层 */
  placement?: 'bar' | 'panel'
}

export interface ModelSpec {
  id: string
  label: string
  /** t2i = 文生图，i2i = 图生图（带参考图） */
  modes: ('t2i' | 'i2i')[]
  maxRefImages: number
  aspectRatios: string[]
  sizes: string[]
  maxCount: number
  extraParams?: ParamSchema[]
}

/** 发给前端的模型列表（不含实现） */
export interface ProviderInfo {
  id: string
  name: string
  models: ModelSpec[]
}

export interface AssetMeta {
  id: string
  width: number
  height: number
  mime: string
}

/** 图片节点里的一张图。同一次生成的多张图 batchId 相同 */
export interface ImageVersion {
  assetId: string
  width: number
  height: number
  batchId: string
  createdAt: number
}

export interface GenSettings {
  providerId: string
  modelId: string
  aspectRatio: string
  size: string
  count: number
  extra: Record<string, unknown>
}

export interface GenerateBody {
  projectId: string
  nodeId: string
  providerId: string
  modelId: string
  prompt: string
  refAssetIds: string[]
  aspectRatio: string
  size: string
  count: number
  extra: Record<string, unknown>
}

export type TaskStatus = 'running' | 'done' | 'error'

export interface TaskRecord {
  id: string
  projectId: string
  nodeId: string
  status: TaskStatus
  request: GenerateBody
  providerTaskId?: string
  results?: AssetMeta[]
  error?: string
  createdAt: number
  updatedAt: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface ProjectDoc {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodes: unknown[]
  edges: unknown[]
  viewport?: Viewport
}

export interface ProjectSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  coverAssetId?: string
  nodeCount: number
}
