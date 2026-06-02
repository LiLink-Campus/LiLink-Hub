'use client'

// studio/compose/imagetext/[id]/NoteEditor.tsx —— 小红书式图文笔记编辑器（容器）。
//
// 职责：组合「图组 + 标题 + 正文(NoteBody) + 右侧手机卡片(NotePreview)」，并负责加载 / 保存编排。
//   左列 = 图组（多图上传 / 拖拽 / 上下移 / 删除 / 首图封面角标）+ 标题（实时字数）+ 正文（# 联想/高亮）。
//   右列 = NotePreview，随标题 / 正文 / 图组实时更新。
//
// 数据流「正文为准」（对齐 spec §6）：
//   - 正文纯文本 = socialDescription（含 #话题、emoji、换行，唯一真源）。
//   - socialTags = parseTopics(正文) 镜像覆盖写（结构化镜像，供发布步骤 / worker 点选）。
//   - 向后兼容：加载旧稿时若 socialDescription 未包含某个已存在 socialTags 的话题，
//     把这些话题以「#话题」回填进初始正文末尾，使正文成为唯一真源；此后保存以正文为准。
//
// 平台通用：标题 / 正文 / 话题计数上限取 getPlatformSpec(doc.platform).limits；
//   未设上限（bodyMax/tagsMax 可选）时只显示已用数、不显示上限、不标红。
//
// 保存时机：标题 blur / 图组变更 立即保存；NoteBody.onChange 防抖 800ms 保存。
//   全部走 _lib/actions 的 Server Actions（getContent / updateContent / uploadMedia / listRecentSocialTags）。
//
// 为什么整组件 'use client'：多图上传 / 拖拽排序 / 富文本编辑 / 实时预览都是天然浏览器交互；
//   数据读写走文件级 'use server' 的 Server Actions，可从 client 直接 import 调用。
//
// 【硬约束】本组件在 (app) 路由组内，<html>/<body> 由 (app)/layout.tsx 提供——这里【绝不】
//   再渲染 <html>/<body>，只返回内容容器。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from 'react'
import { useRouter } from 'next/navigation'

import { getContent, listRecentSocialTags, updateContent, uploadMedia } from '../../../_lib/actions'
import { colors, fonts, radii, space, shadow } from '../../../_lib/theme'
import { Button, Card, Field, TextInput, EmptyState } from '../../../_ui'
import { getPlatformSpec, isPlatformCode, type PlatformSpec } from '@/platforms/registry'
import { PRESET_TOPICS, parseTopics } from '@/lib/topics'

import { NoteBody } from './NoteBody'
import { NotePreview } from './NotePreview'

// ============================================================
// 类型 & 小工具
// ============================================================

/** 一张已选图片（媒体库 id + 可预览 url）。 */
interface ImageItem {
  id: string
  url: string
}

/** 从 depth:2 的关系值里宽松地取出 { id, url }（兼容已 populate 的对象或裸 id）。 */
function toImageItem(value: unknown): ImageItem | null {
  if (!value) return null
  if (typeof value === 'string' || typeof value === 'number') {
    // 裸 id（极少见：关联媒体被删后只剩 id），无 url，仍占位以保留顺序。
    return { id: String(value), url: '' }
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj.id === undefined || obj.id === null) return null
    const url = typeof obj.url === 'string' ? obj.url : ''
    return { id: String(obj.id), url }
  }
  return null
}

/** 把 socialImages（hasMany 关系，depth:2）归一成 ImageItem[]。 */
function readImages(doc: Record<string, unknown>): ImageItem[] {
  const raw = doc.socialImages
  if (!Array.isArray(raw)) return []
  return raw.map(toImageItem).filter((x): x is ImageItem => x !== null)
}

function readString(doc: Record<string, unknown>, key: string): string {
  const v = doc[key]
  return typeof v === 'string' ? v : ''
}

/** 从 socialTags（array<{tag}> 或裸字符串数组）取出话题字符串（去#、trim）。 */
function readSocialTags(doc: Record<string, unknown>): string[] {
  const raw = doc.socialTags
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const t of raw) {
    const tag = typeof t === 'string' ? t : (t as Record<string, unknown> | null)?.tag
    const s = typeof tag === 'string' ? tag.trim().replace(/^#+/, '').trim() : ''
    if (s) out.push(s)
  }
  return out
}

/** 去重保序。 */
function dedupe(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of list) {
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/**
 * 向后兼容：把「已存在 socialTags、但正文里没出现」的话题回填进正文末尾（成为 #话题），
 * 让正文成为唯一真源。已在正文里的话题不重复追加。
 */
function mergeLegacyTags(body: string, tags: string[]): string {
  const inBody = new Set(parseTopics(body))
  const missing = dedupe(tags).filter((t) => !inBody.has(t))
  if (missing.length === 0) return body
  const suffix = missing.map((t) => `#${t}`).join(' ')
  // 正文非空时换行隔开，避免话题黏在正文末尾那行。
  return body.trim().length > 0 ? `${body}\n${suffix}` : suffix
}

// ============================================================
// 容器
// ============================================================

export function NoteEditor({ contentId }: { contentId: string }) {
  const router = useRouter()

  // 加载态
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 当前稿平台 spec（决定标题 / 正文 / 话题上限）；isPlatformCode 兜底未知平台。
  const [spec, setSpec] = useState<PlatformSpec | null>(null)

  // 表单态
  const [title, setTitle] = useState('')
  const [images, setImages] = useState<ImageItem[]>([])
  // 正文初值（含向后兼容回填的话题）——只在加载完成后用于挂载一次 NoteBody。
  const [initialBody, setInitialBody] = useState('')
  // 正文当前纯文本 + 解析话题（NoteBody.onChange 实时上报，驱动预览 / 计数 / 保存）。
  const [bodyText, setBodyText] = useState('')
  const [bodyTopics, setBodyTopics] = useState<string[]>([])

  // 联想候选（PRESET ∪ 历史，去重）。
  const [suggestions, setSuggestions] = useState<string[]>(PRESET_TOPICS)

  // 保存 / 上传 / 错误反馈
  const [saving, startSaving] = useTransition()
  const [uploading, setUploading] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // 拖拽排序：记当前被拖起的下标
  const dragIndex = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 正文防抖保存计时器。
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 最新表单值的 ref（保存时读取，避免 persist 因闭包拿到旧值 / 反复重建）。
  const latestRef = useRef({ title: '', images: [] as ImageItem[], bodyText: '', bodyTopics: [] as string[] })
  latestRef.current = { title, images, bodyText, bodyTopics }

  // ---------- 初次加载：取完整渠道稿 + 并行历史话题 ----------
  // loading/loadError 已用初值声明，effect 内不再同步重置（避免级联渲染）；
  // 状态更新都在异步回调里发生。NoteBody 在 loading 结束后才挂载，故 initialBody 此时已就绪。
  useEffect(() => {
    let alive = true
    Promise.all([getContent(contentId), listRecentSocialTags()])
      .then(([doc, history]) => {
        if (!alive) return
        const platform = readString(doc, 'platform')
        setSpec(isPlatformCode(platform) ? getPlatformSpec(platform) : null)

        setTitle(readString(doc, 'socialTitle'))
        setImages(readImages(doc))

        // 向后兼容：把旧稿 socialTags 里正文未含的话题回填进正文末尾。
        const rawBody = readString(doc, 'socialDescription')
        const legacyTags = readSocialTags(doc)
        const mergedBody = mergeLegacyTags(rawBody, legacyTags)
        setInitialBody(mergedBody)
        setBodyText(mergedBody)
        setBodyTopics(parseTopics(mergedBody))

        // 联想池 = 预设 ∪ 历史（去重）。
        setSuggestions(dedupe([...PRESET_TOPICS, ...history]))
      })
      .catch((err: unknown) => {
        if (!alive) return
        setLoadError(err instanceof Error ? err.message : '读取内容失败，请稍后重试。')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
    }
  }, [contentId])

  // ---------- 保存（把当前表单写回渠道稿；正文为准） ----------
  // 返回 Promise，便于「下一步」时先保存再跳转。next 缺省则取 latestRef 最新值。
  const persist = useCallback(
    (next?: { title?: string; images?: ImageItem[]; bodyText?: string; bodyTopics?: string[] }): Promise<void> => {
      const cur = latestRef.current
      const t = next?.title ?? cur.title
      const imgs = next?.images ?? cur.images
      const body = next?.bodyText ?? cur.bodyText
      const topics = next?.bodyTopics ?? cur.bodyTopics
      const payloadData = {
        socialTitle: t,
        // 正文为准：socialDescription 存完整正文；socialTags 从正文解析镜像覆盖写。
        socialDescription: body,
        socialTags: topics.map((tag) => ({ tag })),
        // hasMany 关系：传 id 数组即可。
        socialImages: imgs.map((i) => i.id),
      }
      return new Promise<void>((resolve, reject) => {
        startSaving(() => {
          setActionError(null)
          updateContent(contentId, payloadData)
            .then(() => {
              setSavedAt(Date.now())
              resolve()
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : '保存失败，请重试。'
              setActionError(msg)
              reject(new Error(msg))
            })
        })
      })
    },
    [contentId],
  )

  // ---------- 正文变更：更新预览 + 防抖 800ms 保存 ----------
  const handleBodyChange = useCallback(
    (text: string, topics: string[]) => {
      setBodyText(text)
      setBodyTopics(topics)
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
      bodyTimerRef.current = setTimeout(() => {
        void persist({ bodyText: text, bodyTopics: topics })
      }, 800)
    },
    [persist],
  )

  // ---------- 选图上传（可多选；逐个上传后追加到末尾并立即保存） ----------
  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    setActionError(null)
    const added: ImageItem[] = []
    try {
      for (const file of Array.from(fileList)) {
        const fd = new FormData()
        fd.append('file', file)
        const { id: mediaId, url } = await uploadMedia(fd)
        added.push({ id: mediaId, url })
      }
      const nextImages = [...images, ...added]
      setImages(nextImages)
      // 上传后立即保存，避免运营离开页面丢图。
      await persist({ images: nextImages })
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : '上传失败，请重试。')
    } finally {
      setUploading(false)
      // 清空 input，便于再次选同名文件也能触发 change。
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ---------- 排序 / 删除（变更后立即保存图组） ----------
  function moveImage(from: number, to: number) {
    if (to < 0 || to >= images.length || from === to) return
    const next = [...images]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setImages(next)
    void persist({ images: next })
  }

  function removeImage(index: number) {
    const next = images.filter((_, i) => i !== index)
    setImages(next)
    void persist({ images: next })
  }

  // ---------- 下一步：先把正文最新值刷盘，再跳发布 ----------
  function goNext() {
    // 取消未决的防抖，立即用最新值保存一次再跳。
    if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
    persist()
      .then(() => router.push(`/studio/publish/${contentId}`))
      .catch(() => {
        /* persist 已设置 actionError，停在本页让运营看到错误 */
      })
  }

  // ============================================================
  // 渲染
  // ============================================================

  if (loading) {
    return (
      <p style={{ textAlign: 'center', color: colors.muted, padding: space.xl }}>内容加载中…</p>
    )
  }

  if (loadError) {
    return (
      <EmptyState
        icon="⚠️"
        title="打不开这条图文"
        hint={loadError}
        action={
          <Button variant="ghost" onClick={() => router.push('/studio')}>
            返回工作台
          </Button>
        }
      />
    )
  }

  const busy = saving || uploading
  return (
    <NoteEditorView
      spec={spec}
      title={title}
      images={images}
      initialBody={initialBody}
      bodyText={bodyText}
      bodyTopics={bodyTopics}
      suggestions={suggestions}
      busy={busy}
      saving={saving}
      uploading={uploading}
      savedAt={savedAt}
      actionError={actionError}
      fileInputRef={fileInputRef}
      dragIndex={dragIndex}
      onTitleChange={setTitle}
      onTitleBlur={() => void persist()}
      onPickFiles={(fl) => void handleFiles(fl)}
      onBodyChange={handleBodyChange}
      onMoveImage={moveImage}
      onRemoveImage={removeImage}
      onSaveDraft={() => void persist()}
      onNext={goNext}
    />
  )
}

// ============================================================
// NoteEditorView —— 纯布局（左列编辑 + 右列预览），与加载/保存逻辑解耦便于阅读。
// ============================================================

function NoteEditorView({
  spec,
  title,
  images,
  initialBody,
  bodyText,
  bodyTopics,
  suggestions,
  busy,
  saving,
  uploading,
  savedAt,
  actionError,
  fileInputRef,
  dragIndex,
  onTitleChange,
  onTitleBlur,
  onPickFiles,
  onBodyChange,
  onMoveImage,
  onRemoveImage,
  onSaveDraft,
  onNext,
}: {
  spec: PlatformSpec | null
  title: string
  images: ImageItem[]
  initialBody: string
  bodyText: string
  bodyTopics: string[]
  suggestions: string[]
  busy: boolean
  saving: boolean
  uploading: boolean
  savedAt: number | null
  actionError: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  dragIndex: React.MutableRefObject<number | null>
  onTitleChange: (v: string) => void
  onTitleBlur: () => void
  onPickFiles: (fl: FileList | null) => void
  onBodyChange: (text: string, topics: string[]) => void
  onMoveImage: (from: number, to: number) => void
  onRemoveImage: (index: number) => void
  onSaveDraft: () => void
  onNext: () => void
}) {
  const titleMax = spec?.limits.titleMax
  const bodyMax = spec?.limits.bodyMax
  const tagsMax = spec?.limits.tagsMax

  const titleLen = [...title].length // 用展开按码点计数（中文 / emoji 友好）
  const bodyLen = [...bodyText].length
  const tagCount = bodyTopics.length

  const titleOver = typeof titleMax === 'number' && titleLen > titleMax
  const bodyOver = typeof bodyMax === 'number' && bodyLen > bodyMax
  const tagsOver = typeof tagsMax === 'number' && tagCount > tagsMax

  return (
    <div>
      <div style={{ marginBottom: space.lg }}>
        <h1
          style={{
            margin: 0,
            fontFamily: fonts.serif,
            fontSize: 24,
            fontWeight: 700,
            color: colors.inkStrong,
            lineHeight: 1.4,
          }}
        >
          编辑图文笔记
        </h1>
        <p style={{ margin: `${space.xs} 0 0`, fontSize: 14, color: colors.muted, lineHeight: 1.6 }}>
          像在小红书后台一样编辑：配好图、写标题，正文里用 <strong style={{ color: colors.rose }}>#</strong>{' '}
          加话题。右侧实时预览发布后的样子。
        </p>
      </div>

      {/* 左编辑 + 右预览：宽屏两列，窄屏单列（预览落到下方）。 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 360px)',
          gap: space.lg,
          alignItems: 'start',
        }}
      >
        {/* ---------- 左列：图组 + 标题 + 正文 ---------- */}
        <Card>
          {/* 标题 */}
          <Field
            label="标题"
            hint="一句话说清这条笔记讲什么。超出平台字数会标红提醒，但不会自动截断。"
          >
            <TextInput
              value={title}
              placeholder="例如：3 招把校园社交玩明白"
              onChange={(e) => onTitleChange(e.target.value)}
              onBlur={onTitleBlur}
              style={titleOver ? { borderColor: '#d9534f' } : undefined}
            />
            <CountHint used={titleLen} max={titleMax} over={titleOver} unit="字" />
          </Field>

          {/* 多图上传 + 排序 */}
          <Field
            label="配图"
            hint="可一次选多张。第一张是封面；拖动图片或用上下箭头调整顺序，顺序就是发布顺序。"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => onPickFiles(e.target.files)}
            />

            {images.length === 0 ? (
              <EmptyState
                icon="🖼️"
                title="还没有配图"
                hint="点下面的按钮从手机或电脑里选图片，支持一次选多张。"
                action={
                  <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    {uploading ? '上传中…' : '＋ 添加图片'}
                  </Button>
                }
              />
            ) : (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                    gap: space.sm,
                    marginBottom: space.md,
                  }}
                >
                  {images.map((img, index) => (
                    <ImageThumb
                      key={`${img.id}-${index}`}
                      img={img}
                      index={index}
                      total={images.length}
                      disabled={busy}
                      onRemove={() => onRemoveImage(index)}
                      onMoveUp={() => onMoveImage(index, index - 1)}
                      onMoveDown={() => onMoveImage(index, index + 1)}
                      onDragStart={() => {
                        dragIndex.current = index
                      }}
                      onDropTo={() => {
                        if (dragIndex.current !== null) {
                          onMoveImage(dragIndex.current, index)
                          dragIndex.current = null
                        }
                      }}
                    />
                  ))}
                </div>
                <Button variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? '上传中…' : '＋ 继续添加图片'}
                </Button>
              </>
            )}
          </Field>

          {/* 正文（小红书式：纯文本 + #话题高亮/联想） */}
          <Field
            label="正文"
            hint="正文里直接打 # 会弹话题联想，选中即变蓝。emoji 用系统输入法，换行即分段。"
          >
            <NoteBody initialText={initialBody} suggestions={suggestions} onChange={onBodyChange} />
            <div style={{ display: 'flex', gap: space.md, flexWrap: 'wrap', marginTop: space.xs }}>
              <CountHint used={bodyLen} max={bodyMax} over={bodyOver} unit="字" />
              <CountHint used={tagCount} max={tagsMax} over={tagsOver} unit="个话题" />
            </div>
          </Field>

          {/* 错误 / 保存提示 */}
          {actionError ? (
            <p
              role="alert"
              style={{
                margin: `0 0 ${space.md}`,
                padding: `${space.sm} ${space.md}`,
                fontSize: 13.5,
                lineHeight: 1.6,
                color: '#9a3b36',
                background: '#fdecea',
                border: `1px solid #f5c6c2`,
                borderRadius: radii.md,
              }}
            >
              {actionError}
            </p>
          ) : null}

          {/* 底部操作区 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space.md,
              flexWrap: 'wrap',
              paddingTop: space.md,
              borderTop: `1px solid ${colors.rule}`,
            }}
          >
            <span style={{ fontSize: 13, color: colors.muted, minHeight: 20 }}>
              {saving
                ? '保存中…'
                : actionError
                  ? '保存失败，请看上方提示'
                  : savedAt
                    ? '已自动保存'
                    : '修改后会自动保存'}
            </span>
            <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={onSaveDraft} disabled={busy}>
                保存草稿
              </Button>
              <Button onClick={onNext} disabled={busy}>
                下一步：发布 ▸
              </Button>
            </div>
          </div>
        </Card>

        {/* ---------- 右列：手机卡片预览（sticky 跟随滚动） ---------- */}
        <div style={{ position: 'sticky', top: space.md }}>
          <p
            style={{
              margin: `0 0 ${space.sm}`,
              fontSize: 13,
              fontWeight: 600,
              color: colors.muted,
              textAlign: 'center',
            }}
          >
            小红书预览
          </p>
          <NotePreview title={title} body={bodyText} images={images} />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// CountHint —— 「已用 / 上限」字数计数。未设上限时只显示已用数、不标红。
// ============================================================

function CountHint({
  used,
  max,
  over,
  unit,
}: {
  used: number
  max?: number
  over: boolean
  unit: string
}) {
  return (
    <span
      style={{
        fontSize: 12.5,
        lineHeight: 1.6,
        color: over ? '#d9534f' : colors.muted,
        fontWeight: over ? 600 : 400,
      }}
    >
      {typeof max === 'number' ? `${used}/${max}${unit}` : `${used}${unit}`}
    </span>
  )
}

// ============================================================
// ImageThumb —— 单张图片缩略图：预览 + 删除 + 上/下移 + 桌面端拖拽。
// 从旧 imagetext/page.tsx 移植（按任务约定：上传 / 排序组件可各目录各放一份，不外提共享文件）。
// ============================================================

function ImageThumb({
  img,
  index,
  total,
  disabled,
  onRemove,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDropTo,
}: {
  img: ImageItem
  index: number
  total: number
  disabled: boolean
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDragStart: () => void
  onDropTo: () => void
}) {
  const [over, setOver] = useState(false)

  const tileStyle: CSSProperties = {
    position: 'relative',
    aspectRatio: '1 / 1',
    borderRadius: radii.md,
    overflow: 'hidden',
    border: over ? `2px solid ${colors.rose}` : `1px solid ${colors.rule}`,
    background: colors.fill,
    boxShadow: shadow.card,
    cursor: 'grab',
  }

  const iconBtnStyle: CSSProperties = {
    appearance: 'none',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    fontSize: 13,
    lineHeight: 1,
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.92)',
    color: colors.inkStrong,
    boxShadow: shadow.card,
  }

  return (
    <div
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onDropTo()
      }}
      style={tileStyle}
      title="拖动可调整顺序"
    >
      {img.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img.url}
          alt={`配图 ${index + 1}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.muted,
            fontSize: 12,
            textAlign: 'center',
            padding: 8,
          }}
        >
          图片不可预览
        </div>
      )}

      {/* 序号角标（第 1 张提示「封面」） */}
      <span
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          padding: '2px 8px',
          borderRadius: radii.pill,
          fontSize: 11,
          fontWeight: 700,
          color: colors.onRose,
          background: index === 0 ? colors.rose : 'rgba(52,45,43,0.6)',
          lineHeight: 1.5,
        }}
      >
        {index === 0 ? '封面' : index + 1}
      </span>

      {/* 删除 */}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`删除第 ${index + 1} 张图片`}
        style={{ ...iconBtnStyle, position: 'absolute', top: 6, right: 6, color: '#9a3b36' }}
      >
        ✕
      </button>

      {/* 上 / 下移（移动端友好，无需拖拽也能排序） */}
      <div style={{ position: 'absolute', bottom: 6, right: 6, display: 'flex', gap: 4 }}>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={disabled || index === 0}
          aria-label="前移一位"
          style={{ ...iconBtnStyle, opacity: index === 0 ? 0.4 : 1 }}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={disabled || index === total - 1}
          aria-label="后移一位"
          style={{ ...iconBtnStyle, opacity: index === total - 1 ? 0.4 : 1 }}
        >
          ↓
        </button>
      </div>
    </div>
  )
}
