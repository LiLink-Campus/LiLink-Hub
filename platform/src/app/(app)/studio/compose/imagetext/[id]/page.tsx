'use client'

// studio/compose/imagetext/[id]/page.tsx —— 图文（小红书 / 视频号 / 抖音 笔记）创作页。
//
// 设计依据「创作 ▸ 发布 ▸ 审核」三步流程的第一步「创作」（StepHeader current='create'）：
//   运营在这里填 平台标题（socialTitle）+ 多图（socialImages，可拖拽 / 上下键排序）
//   + 正文文案（socialDescription）。话题（socialTags）留到「发布」步骤再填。
//   填好点「下一步：发布」跳 /studio/publish/[id]。
//
// 为什么整页 'use client'：
//   - 多图上传、拖拽排序、缩略图增删都是天然的浏览器交互；统一标 client 最简单。
//   - 数据读写全走 _lib/actions.ts 的 Server Actions（getContent / uploadMedia / updateContent，
//     文件级 'use server'，可从 client 直接 import 调用），无需额外 API 路由 / client 组件文件。
//   - params 在 Next 16 是 Promise，client 组件用 React 的 use() 解包（见 next docs page.md）。
//
// 【硬约束】本页在 (app) 路由组内，<html>/<body> 由 (app)/layout.tsx 提供——这里【绝不】
// 再渲染 <html>/<body>，只返回内容容器（否则嵌套 <html> 触发 hydration 错乱）。

import { use, useEffect, useRef, useState, useTransition, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'

import { getContent, updateContent, uploadMedia } from '../../../_lib/actions'
import { colors, fonts, radii, space, shadow } from '../../../_lib/theme'
import {
  Button,
  Card,
  Field,
  StepHeader,
  TextInput,
  Textarea,
  EmptyState,
} from '../../../_ui'

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

// ============================================================
// 页面
// ============================================================

export default function ImagetextComposePage({
  params,
}: {
  // Next 16：params 是 Promise，client 组件用 use() 解包（见 next docs page.md）。
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()

  // 加载态
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 表单态
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [images, setImages] = useState<ImageItem[]>([])

  // 保存 / 上传 / 错误反馈
  const [saving, startSaving] = useTransition()
  const [uploading, setUploading] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // 拖拽排序：记当前被拖起的下标
  const dragIndex = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ---------- 初次加载：取完整渠道稿 ----------
  // loading/loadError 已用初值（true/null）声明，effect 内不再同步重置（避免级联渲染）；
  // 真正的状态更新都在下面 then/catch/finally 的异步回调里发生。
  useEffect(() => {
    let alive = true
    getContent(id)
      .then((doc) => {
        if (!alive) return
        setTitle(readString(doc, 'socialTitle'))
        setDescription(readString(doc, 'socialDescription'))
        setImages(readImages(doc))
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
    }
  }, [id])

  // ---------- 保存（把当前表单写回渠道稿） ----------
  // 返回 Promise，便于「下一步」时先保存再跳转。
  function persist(next?: {
    title?: string
    description?: string
    images?: ImageItem[]
  }): Promise<void> {
    const payloadData = {
      socialTitle: next?.title ?? title,
      socialDescription: next?.description ?? description,
      // hasMany 关系：传 id 数组即可。
      socialImages: (next?.images ?? images).map((i) => i.id),
    }
    return new Promise<void>((resolve, reject) => {
      startSaving(() => {
        setActionError(null)
        updateContent(id, payloadData)
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
  }

  // ---------- 选图上传（可多选；逐个上传后追加到末尾并立即保存顺序） ----------
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

  // ---------- 排序 / 删除 ----------
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

  // ---------- 下一步：先保存，再跳发布 ----------
  function goNext() {
    persist()
      .then(() => router.push(`/studio/publish/${id}`))
      .catch(() => {
        /* persist 已设置 actionError，停在本页让运营看到错误 */
      })
  }

  // ============================================================
  // 渲染
  // ============================================================

  if (loading) {
    return (
      <div>
        <StepHeader current="create" />
        <p style={{ textAlign: 'center', color: colors.muted, padding: space.xl }}>内容加载中…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div>
        <StepHeader current="create" />
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
      </div>
    )
  }

  const busy = saving || uploading

  return (
    <div>
      <StepHeader current="create" />

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
          编辑图文
        </h1>
        <p style={{ margin: `${space.xs} 0 0`, fontSize: 14, color: colors.muted, lineHeight: 1.6 }}>
          填好标题、配图和文案就行。话题标签可以等到下一步「发布」时再补。
        </p>
      </div>

      <Card>
        {/* 标题 */}
        <Field label="标题" hint="一句话说清这条图文讲什么。发布时系统会按各平台字数自动提醒。">
          <TextInput
            value={title}
            placeholder="例如：3 招把校园社交玩明白"
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void persist()}
          />
        </Field>

        {/* 多图上传 + 排序 */}
        <Field
          label="配图"
          hint="可一次选多张。第一张通常是封面；拖动图片或用上下箭头调整顺序，顺序就是发布顺序。"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void handleFiles(e.target.files)}
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
                  gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
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
                    onRemove={() => removeImage(index)}
                    onMoveUp={() => moveImage(index, index - 1)}
                    onMoveDown={() => moveImage(index, index + 1)}
                    onDragStart={() => {
                      dragIndex.current = index
                    }}
                    onDropTo={() => {
                      if (dragIndex.current !== null) {
                        moveImage(dragIndex.current, index)
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

        {/* 正文 / 文案 */}
        <Field label="文案" hint="正文描述。发布时会自动拼上话题标签和 LiLink 链接，这里先写好正文就行。">
          <Textarea
            value={description}
            rows={6}
            placeholder="写点想说的：开头一句吸引人，中间讲清楚，结尾引导互动～"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => void persist()}
          />
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
            {saving ? '保存中…' : savedAt ? '已自动保存' : '修改后会自动保存'}
          </span>
          <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => void persist()} disabled={busy}>
              保存草稿
            </Button>
            <Button onClick={goNext} disabled={busy}>
              下一步：发布 ▸
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ============================================================
// ImageThumb —— 单张图片缩略图：预览 + 删除 + 上/下移 + 桌面端拖拽。
// 内联在本页（按任务约定：上传 / 排序组件可各目录各放一份，不外提共享文件）。
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
