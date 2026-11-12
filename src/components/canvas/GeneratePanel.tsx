'use client'

import { ArrowUp, Check, ImageIcon, Loader2, Plus, Sparkles, Type, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { assetUrl } from '@/lib/asset-url'
import type { GenSettings, ModelSpec, ParamSchema, ProviderInfo } from '@/lib/types'
import { addUploadedRefs, disconnectRef, findModel, generate, setRefOrder, settingsForModel } from './actions'
import { pickImages, uploadFiles } from './upload'
import { Dropdown, OptionButton, RatioIcon } from './Dropdown'
import { getInputs } from './graph'
import { useAutoFocus } from './hooks'
import { useCanvasStore } from './store'
import type { ImageNode } from './types'

const ratioLabel = (a: string) => (a === 'auto' ? '自动' : a)

const COUNT_PRESETS = [1, 2, 4]

/** 张数：1 / 2 / 4 三个常用选项，加一个可以自己输入的“自定义” */
function CountPicker({ max, value, onChange }: { max: number; value: number; onChange: (n: number) => void }) {
  const presets = COUNT_PRESETS.filter((n) => n <= max)
  const isCustom = !presets.includes(value)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const showInput = editing || isCustom

  const commit = (text: string) => {
    setDraft(text)
    const n = Math.floor(Number(text))
    if (n >= 1) onChange(Math.min(n, max))
  }

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {presets.map((n) => (
          <OptionButton
            key={n}
            active={!showInput && value === n}
            onClick={() => {
              setEditing(false)
              onChange(n)
            }}
            className="h-9"
          >
            {n} 张
          </OptionButton>
        ))}
        {showInput ? (
          <label className="flex h-9 items-center justify-center gap-1 rounded-xl border border-accent/80 bg-accent/10 text-xs">
            <input
              type="number"
              min={1}
              max={max}
              autoFocus={editing}
              value={draft}
              placeholder="张数"
              onChange={(e) => commit(e.target.value)}
              onBlur={() => {
                setEditing(false)
                setDraft(String(value))
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="w-9 bg-transparent text-center outline-none [appearance:textfield] placeholder:text-muted/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            张
          </label>
        ) : (
          <OptionButton
            active={false}
            onClick={() => {
              setDraft('')
              setEditing(true)
            }}
            className="h-9"
          >
            自定义
          </OptionButton>
        )}
      </div>
      {showInput && <div className="mt-1.5 text-[11px] text-muted">输入 1–{max} 之间的数字</div>}
    </div>
  )
}

function modelCaps(m: ModelSpec) {
  const parts: string[] = []
  if (m.modes.includes('t2i')) parts.push('文生图')
  if (m.modes.includes('i2i')) parts.push(`图生图（最多 ${m.maxRefImages} 张参考）`)
  if (m.maxCount > 1) parts.push(`一次最多 ${m.maxCount} 张`)
  return parts.join(' · ')
}

/** 参数当前值的显示文字，用在底栏摘要里 */
function paramValueLabel(p: ParamSchema, v: unknown): string | undefined {
  const val = v ?? p.default
  if (p.type === 'select') return p.options?.find((o) => o.value === String(val))?.label
  if (p.type === 'boolean') return val ? p.label : undefined
  return val !== undefined && val !== '' ? `${p.label} ${val}` : undefined
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-fg/90">{title}</div>
      {children}
    </div>
  )
}

function ParamControl({ p, value, onChange }: { p: ParamSchema; value: unknown; onChange: (v: unknown) => void }) {
  if (p.type === 'select') {
    const current = String(value ?? p.default ?? '')
    return (
      <div className="grid grid-cols-3 gap-2">
        {p.options?.map((o) => (
          <OptionButton key={o.value} active={current === o.value} onClick={() => onChange(o.value)} className="h-9">
            {o.label}
          </OptionButton>
        ))}
      </div>
    )
  }
  if (p.type === 'boolean') {
    const on = Boolean(value ?? p.default)
    return (
      <div className="grid grid-cols-3 gap-2">
        <OptionButton active={!on} onClick={() => onChange(false)} className="h-9">
          关闭
        </OptionButton>
        <OptionButton active={on} onClick={() => onChange(true)} className="h-9">
          开启
        </OptionButton>
      </div>
    )
  }
  return (
    <input
      type={p.type === 'number' ? 'number' : 'text'}
      value={value === undefined || value === null ? '' : String(value)}
      min={p.min}
      max={p.max}
      step={p.step}
      placeholder={p.type === 'number' ? '留空表示随机' : ''}
      onChange={(e) =>
        onChange(p.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)
      }
      className="h-9 w-full rounded-xl border border-line bg-transparent px-3 text-xs outline-none placeholder:text-muted/60 focus:border-accent"
    />
  )
}

/** 比例、清晰度、张数和模型参数放在同一个弹层里，点选后不关闭，可以连续选 */
function SettingsPanel({
  model,
  gen,
  setGen,
}: {
  model: ModelSpec
  gen: GenSettings
  setGen: (patch: Partial<GenSettings>) => void
}) {
  const panelParams = (model.extraParams ?? []).filter((p) => p.placement !== 'bar' || p.type !== 'select')
  return (
    <div className="space-y-4 p-4">
      <Section title="比例">
        <div className="grid grid-cols-5 gap-2">
          {model.aspectRatios.map((a) => (
            <OptionButton
              key={a}
              active={gen.aspectRatio === a}
              onClick={() => setGen({ aspectRatio: a })}
              className="h-14 flex-col !gap-1"
            >
              <RatioIcon ratio={a} />
              <span>{ratioLabel(a)}</span>
            </OptionButton>
          ))}
        </div>
      </Section>
      {model.sizes.length > 1 && (
        <Section title="清晰度">
          <div className="grid grid-cols-3 gap-2">
            {model.sizes.map((s) => (
              <OptionButton key={s} active={gen.size === s} onClick={() => setGen({ size: s })} className="h-9">
                {s}
              </OptionButton>
            ))}
          </div>
        </Section>
      )}
      {model.maxCount > 1 && (
        <Section title="生成数量">
          <CountPicker max={model.maxCount} value={gen.count} onChange={(n) => setGen({ count: n })} />
        </Section>
      )}
      {panelParams.map((p) => (
        <Section key={p.key} title={p.label}>
          <ParamControl p={p} value={gen.extra[p.key]} onChange={(v) => setGen({ extra: { ...gen.extra, [p.key]: v } })} />
        </Section>
      ))}
    </div>
  )
}

function ModelList({
  providers,
  gen,
  onPick,
}: {
  providers: ProviderInfo[]
  gen: GenSettings
  onPick: (providerId: string, model: ModelSpec) => void
}) {
  return (
    <div className="p-1.5">
      {providers.map((p) => (
        <div key={p.id}>
          <div className="px-2.5 pb-1 pt-2 text-[11px] text-muted">{p.name}</div>
          {p.models.map((m) => {
            const active = p.id === gen.providerId && m.id === gen.modelId
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(p.id, m)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${
                  active ? 'bg-panel-3' : 'hover:bg-panel-3'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{m.label}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted">{modelCaps(m)}</div>
                </div>
                {active && <Check size={14} className="shrink-0 text-accent" />}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** 选中图片节点时出现在节点下方的生成面板 */
export default function GeneratePanel({ nodeId }: { nodeId: string }) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId)) as ImageNode | undefined
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const providers = useCanvasStore((s) => s.providers)
  const update = useCanvasStore((s) => s.updateNodeData)
  const taRef = useRef<HTMLTextAreaElement>(null)
  useAutoFocus(nodeId, taRef)
  // 参考图拖动排序：正在拖的、正悬停在上面的
  const [dragRef, setDragRef] = useState<string | null>(null)
  const [overRef, setOverRef] = useState<string | null>(null)

  const inputs = useMemo(() => getInputs(nodeId, nodes, edges), [nodeId, nodes, edges])
  const prompt = node?.data.prompt ?? ''

  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 64), 220)}px`
  }, [prompt])

  if (!node) return null
  const { gen } = node.data
  const found = findModel(providers, gen.providerId, gen.modelId)
  const model = found?.model
  const running = !!node.data.task

  const setGen = (patch: Partial<GenSettings>) => update<ImageNode>(nodeId, { gen: { ...gen, ...patch } })
  const setExtra = (key: string, v: unknown) => setGen({ extra: { ...gen.extra, [key]: v } })

  // 提前提示问题，生成时 actions.generate 还会再检查一遍
  let warning = ''
  if (!found && providers.length) warning = '当前模型已不可用，请重新选择'
  else if (model && inputs.images.length > model.maxRefImages)
    warning = `${model.label} 最多 ${model.maxRefImages} 张参考图`
  else if (model && inputs.images.length && !model.modes.includes('i2i')) warning = `${model.label} 不支持参考图`
  else if (inputs.emptyImages.length) warning = '有连进来的图片节点还没有图片'

  const hasInputs = inputs.texts.length > 0 || inputs.images.length > 0
  const canUseRefs = !model || model.modes.includes('i2i')
  const canGenerate = !running && !!model && !warning

  const barParams = (model?.extraParams ?? []).filter((p) => p.placement === 'bar' && p.type === 'select')
  const panelParams = (model?.extraParams ?? []).filter((p) => !barParams.includes(p))
  const summary = model
    ? [
        ratioLabel(gen.aspectRatio),
        model.sizes.length > 1 ? gen.size : null,
        model.maxCount > 1 ? `${gen.count} 张` : null,
        ...panelParams.map((p) => paramValueLabel(p, gen.extra[p.key])),
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <div
      data-generate-panel={nodeId}
      className="nodrag nopan nowheel w-[540px] rounded-2xl border border-line bg-panel p-3 shadow-2xl shadow-black/50"
      onKeyDown={(e) => e.stopPropagation()}
    >
      {(hasInputs || canUseRefs) && (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          {canUseRefs && (
            <button
              type="button"
              onClick={async () => {
                const assets = await uploadFiles(await pickImages())
                if (assets) addUploadedRefs(nodeId, assets)
              }}
              title="上传参考图（也可以在输入框里直接粘贴图片）"
              className="flex h-9 items-center gap-1 rounded-md border border-dashed border-line-strong px-2.5 text-[11px] text-muted hover:border-accent hover:text-fg"
            >
              <Plus size={12} />
              参考图
            </button>
          )}
          {inputs.texts.map((t) => (
            <span
              key={t.id}
              className="flex max-w-[220px] items-center gap-1 rounded-md bg-panel-3 px-2 py-1 text-[11px] text-fg/80"
              title={t.text}
            >
              <Type size={11} className="shrink-0 text-muted" />
              <span className="truncate">{t.text.trim() || '（空文本）'}</span>
            </span>
          ))}
          {inputs.images.map((img, i) => (
            <span
              key={img.id}
              draggable
              onDragStart={(e) => {
                setDragRef(img.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', img.id)
              }}
              onDragEnd={() => {
                setDragRef(null)
                setOverRef(null)
              }}
              onDragOver={(e) => {
                if (!dragRef) return
                e.preventDefault()
                setOverRef(img.id)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (dragRef && dragRef !== img.id) {
                  const ids = inputs.images.map((x) => x.id).filter((id) => id !== dragRef)
                  ids.splice(ids.indexOf(img.id) + (inputs.images.findIndex((x) => x.id === dragRef) < i ? 1 : 0), 0, dragRef)
                  setRefOrder(nodeId, ids)
                }
                setDragRef(null)
                setOverRef(null)
              }}
              className={`group relative cursor-grab overflow-hidden rounded-md border active:cursor-grabbing ${
                overRef === img.id && dragRef !== img.id ? 'border-accent' : 'border-line'
              } ${dragRef === img.id ? 'opacity-40' : ''}`}
              title={`参考图 ${i + 1}，拖动可以调整顺序`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrl(img.version.assetId, true)} alt="" draggable={false} className="h-9 w-9 object-cover" />
              <span className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 text-[10px] leading-4 text-white">
                图{i + 1}
              </span>
              <button
                type="button"
                title="断开这张参考图"
                onClick={() => disconnectRef(img.id, nodeId)}
                className="absolute right-0 top-0 hidden rounded-bl bg-black/75 p-0.5 text-white hover:bg-danger group-hover:block"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {inputs.images.length > 1 && <span className="text-[11px] text-muted/70">拖动调整顺序</span>}
        </div>
      )}

      <textarea
        ref={taRef}
        value={prompt}
        onChange={(e) => update<ImageNode>(nodeId, { prompt: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            if (canGenerate) void generate(nodeId)
          }
        }}
        placeholder={
          inputs.texts.length
            ? '补充描述（会接在上游文本后面），⌘ + Enter 生成'
            : inputs.images.length
              ? '描述要怎么改这张参考图，⌘ + Enter 生成'
              : '描述你想生成的画面，⌘ + Enter 生成'
        }
        spellCheck={false}
        className="block w-full resize-none bg-transparent px-1 text-[13px] leading-relaxed outline-none placeholder:text-muted/70"
      />

      <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
        <Dropdown
          width={300}
          title="模型"
          className="max-w-[190px] shrink-0"
          trigger={
            <>
              <Sparkles size={14} className="shrink-0 text-accent" />
              <span className="truncate">{model?.label ?? '选择模型'}</span>
            </>
          }
        >
          {(close) => (
            <ModelList
              providers={providers}
              gen={gen}
              onPick={(pid, m) => {
                update<ImageNode>(nodeId, { gen: settingsForModel(pid, m, gen) })
                close()
              }}
            />
          )}
        </Dropdown>

        {barParams.map((p) => (
          <Dropdown
            key={p.key}
            width={180}
            title={p.label}
            className="shrink-0"
            trigger={<span className="truncate">{paramValueLabel(p, gen.extra[p.key]) ?? p.label}</span>}
          >
            {(close) => (
              <div className="p-1.5">
                <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-muted">{p.label}</div>
                {p.options?.map((o) => {
                  const active = String(gen.extra[p.key] ?? p.default) === o.value
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        setExtra(p.key, o.value)
                        close()
                      }}
                      className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] ${
                        active ? 'bg-panel-3' : 'hover:bg-panel-3'
                      }`}
                    >
                      <span className="flex-1">{o.label}</span>
                      {active && <Check size={14} className="text-accent" />}
                    </button>
                  )
                })}
              </div>
            )}
          </Dropdown>
        ))}

        {model && (
          <>
            <div className="mx-0.5 h-4 w-px shrink-0 bg-line" />
            <Dropdown
              width={420}
              align="right"
              title="比例、清晰度、张数等参数"
              className="flex-1"
              trigger={
                <>
                  <span className="shrink-0 text-muted">
                    <RatioIcon ratio={gen.aspectRatio} size={16} />
                  </span>
                  <span className="truncate">{summary}</span>
                </>
              }
            >
              {() => <SettingsPanel model={model} gen={gen} setGen={setGen} />}
            </Dropdown>
          </>
        )}
        {!model && <div className="flex-1" />}

        {inputs.images.length > 0 && !warning && (
          <span className="flex shrink-0 items-center gap-1 px-1 text-[11px] text-muted">
            <ImageIcon size={11} />
            图生图
          </span>
        )}
        <button
          onClick={() => generate(nodeId)}
          disabled={!canGenerate}
          title="生成（⌘ + Enter）"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-medium text-black transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-panel-3 disabled:text-muted"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
          {running ? '生成中' : '生成'}
        </button>
      </div>

      {warning && <div className="mt-2 px-1 text-[11px] text-danger">{warning}</div>}
      {!providers.length && (
        <div className="mt-2 px-1 text-[11px] text-danger">没有可用的模型，请在 src/server/providers 里注册</div>
      )}
    </div>
  )
}
