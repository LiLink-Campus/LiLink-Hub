'use client'

// studio/compose/video/[id]/page.tsx —— 视频（抖音 / 视频号 / 小红书 视频）创作页。
//
// 设计依据「创作 ▸ 发布 ▸ 审核」三步流程的第一步「创作」（StepHeader current='create'）：
//   运营在这里填 平台标题（socialTitle）+ 视频文件（videoFile）
//   + 横封面 / 竖封面（horizontalCover / verticalCover）+ 文案（socialDescription）。
//   话题（socialTags）留到「发布」步骤再填。填好点「下一步：发布」跳 /studio/publish/[id]。
//
// 为什么整页 'use client'：
//   - 视频 / 封面上传与预览是天然的浏览器交互；统一标 client 最简单。
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
import { Button, Card, Field, StepHeader, TextInput, Textarea } from '../../../_ui'
import { ComposeHintBar } from '../../../ComposeHintBar'

// ============================================================
// 类型 & 小工具
// ============================================================

/** 一个已选媒体（媒体库 id + 可预览 url）。 */
interface MediaItem {
  id: string
  url: string
}

/** 从 depth:2 的单值关系里宽松地取出 { id, url }（兼容已 populate 的对象或裸 id 或空）。 */
function toMediaItem(value: unknown): MediaItem | null {
  if (!value) return null
  if (typeof value === 'string' || typeof value === 'number') {
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

function readString(doc: Record<string, unknown>, key: string): string {
  const v = doc[key]
  return typeof v === 'string' ? v : ''
}

// ============================================================
// 页面
// ============================================================

export default function VideoComposePage({
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
  const [video, setVideo] = useState<MediaItem | null>(null)
  const [horizontalCover, setHorizontalCover] = useState<MediaItem | null>(null)
  const [verticalCover, setVerticalCover] = useState<MediaItem | null>(null)

  // 保存 / 上传 / 错误反馈
  const [saving, startSaving] = useTransition()
  // 各上传槽位独立 loading（避免一个上传把所有按钮都禁掉）。
  const [uploadingSlot, setUploadingSlot] = useState<null | 'video' | 'horizontal' | 'vertical'>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // ---------- 初次加载 ----------
  // loading/loadError 已用初值（true/null）声明，effect 内不再同步重置（避免级联渲染）；
  // 真正的状态更新都在下面 then/catch/finally 的异步回调里发生。
  useEffect(() => {
    let alive = true
    getContent(id)
      .then((doc) => {
        if (!alive) return
        setTitle(readString(doc, 'socialTitle'))
        setDescription(readString(doc, 'socialDescription'))
        setVideo(toMediaItem(doc.videoFile))
        setHorizontalCover(toMediaItem(doc.horizontalCover))
        setVerticalCover(toMediaItem(doc.verticalCover))
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

  // ---------- 保存 ----------
  function persist(next?: {
    title?: string
    description?: string
    video?: MediaItem | null
    horizontalCover?: MediaItem | null
    verticalCover?: MediaItem | null
  }): Promise<void> {
    const v = next && 'video' in next ? next.video : video
    const hc = next && 'horizontalCover' in next ? next.horizontalCover : horizontalCover
    const vc = next && 'verticalCover' in next ? next.verticalCover : verticalCover
    const payloadData = {
      socialTitle: next?.title ?? title,
      socialDescription: next?.description ?? description,
      // 单值关系：传 id；清空传 null。
      videoFile: v ? v.id : null,
      horizontalCover: hc ? hc.id : null,
      verticalCover: vc ? vc.id : null,
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

  // ---------- 单文件上传到某个槽位 ----------
  async function uploadTo(slot: 'video' | 'horizontal' | 'vertical', file: File | null | undefined) {
    if (!file) return
    setUploadingSlot(slot)
    setActionError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { id: mediaId, url } = await uploadMedia(fd)
      const item: MediaItem = { id: mediaId, url }
      if (slot === 'video') {
        setVideo(item)
        await persist({ video: item })
      } else if (slot === 'horizontal') {
        setHorizontalCover(item)
        await persist({ horizontalCover: item })
      } else {
        setVerticalCover(item)
        await persist({ verticalCover: item })
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : '上传失败，请重试。')
    } finally {
      setUploadingSlot(null)
    }
  }

  function clearSlot(slot: 'video' | 'horizontal' | 'vertical') {
    if (slot === 'video') {
      setVideo(null)
      void persist({ video: null })
    } else if (slot === 'horizontal') {
      setHorizontalCover(null)
      void persist({ horizontalCover: null })
    } else {
      setVerticalCover(null)
      void persist({ verticalCover: null })
    }
  }

  // ---------- 下一步 ----------
  function goNext() {
    persist()
      .then(() => router.push(`/studio/publish/${id}`))
      .catch(() => {
        /* persist 已设置 actionError */
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
        <div
          style={{
            textAlign: 'center',
            padding: `${space.xl} ${space.lg}`,
            background: colors.fill,
            border: `1px dashed ${colors.rule}`,
            borderRadius: radii.lg,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: space.md }} aria-hidden>
            ⚠️
          </div>
          <h3 style={{ margin: `0 0 ${space.sm}`, fontFamily: fonts.serif, color: colors.inkStrong }}>
            打不开这条视频
          </h3>
          <p style={{ margin: `0 0 ${space.lg}`, color: colors.muted, lineHeight: 1.7 }}>{loadError}</p>
          <Button variant="ghost" onClick={() => router.push('/studio')}>
            返回工作台
          </Button>
        </div>
      </div>
    )
  }

  const busy = saving || uploadingSlot !== null

  return (
    <div>
      <StepHeader current="create" />
      <ComposeHintBar />

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
          编辑视频
        </h1>
        <p style={{ margin: `${space.xs} 0 0`, fontSize: 14, color: colors.muted, lineHeight: 1.6 }}>
          上传视频、配好封面、写好文案就行。话题标签可以等到下一步「发布」时再补。
        </p>
      </div>

      <Card>
        {/* 标题 */}
        <Field label="标题" hint="一句话说清这条视频讲什么。发布时系统会按各平台字数自动提醒。">
          <TextInput
            value={title}
            placeholder="例如：大学生必看的 3 个社交小技巧"
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void persist()}
          />
        </Field>

        {/* 视频文件 */}
        <Field label="视频文件" hint="选一个视频文件上传。建议时长和大小符合目标平台要求。">
          <MediaSlot
            kind="video"
            item={video}
            uploading={uploadingSlot === 'video'}
            disabled={busy}
            accept="video/*"
            emptyHint="点这里上传视频"
            onPick={(file) => void uploadTo('video', file)}
            onClear={() => clearSlot('video')}
          />
        </Field>

        {/* 横 / 竖封面 */}
        <Field
          label="封面"
          hint="横封面用于视频号 / 抖音横版位；竖封面用于小红书 / 抖音竖版。按需上传，至少准备一张。"
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: space.md,
            }}
          >
            <div>
              <p style={{ margin: `0 0 ${space.xs}`, fontSize: 13.5, fontWeight: 600, color: colors.ink }}>
                横封面 <span style={{ color: colors.muted, fontWeight: 400 }}>（16:9）</span>
              </p>
              <MediaSlot
                kind="image"
                item={horizontalCover}
                uploading={uploadingSlot === 'horizontal'}
                disabled={busy}
                accept="image/*"
                aspectRatio="16 / 9"
                emptyHint="上传横封面"
                onPick={(file) => void uploadTo('horizontal', file)}
                onClear={() => clearSlot('horizontal')}
              />
            </div>
            <div>
              <p style={{ margin: `0 0 ${space.xs}`, fontSize: 13.5, fontWeight: 600, color: colors.ink }}>
                竖封面 <span style={{ color: colors.muted, fontWeight: 400 }}>（3:4）</span>
              </p>
              <MediaSlot
                kind="image"
                item={verticalCover}
                uploading={uploadingSlot === 'vertical'}
                disabled={busy}
                accept="image/*"
                aspectRatio="3 / 4"
                emptyHint="上传竖封面"
                onPick={(file) => void uploadTo('vertical', file)}
                onClear={() => clearSlot('vertical')}
              />
            </div>
          </div>
        </Field>

        {/* 文案 */}
        <Field label="文案" hint="视频的描述文字。发布时会自动拼上话题标签和 LiLink 链接，这里先写好正文就行。">
          <Textarea
            value={description}
            rows={6}
            placeholder="写点想说的：开头一句吸引人，中间讲清楚，结尾引导互动～"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => void persist()}
          />
        </Field>

        {/* 错误提示 */}
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
// MediaSlot —— 单个媒体上传槽：空态显示上传按钮，有内容显示预览 + 重传 / 移除。
// 视频用 <video> 预览，图片用 <img>。内联在本页（按任务约定可各目录各放一份）。
// ============================================================

function MediaSlot({
  kind,
  item,
  uploading,
  disabled,
  accept,
  emptyHint,
  aspectRatio,
  onPick,
  onClear,
}: {
  kind: 'video' | 'image'
  item: MediaItem | null
  uploading: boolean
  disabled: boolean
  accept: string
  emptyHint: string
  aspectRatio?: string
  onPick: (file: File | null | undefined) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [hover, setHover] = useState(false)

  const frameStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    aspectRatio: aspectRatio ?? (kind === 'video' ? '16 / 9' : '1 / 1'),
    borderRadius: radii.md,
    overflow: 'hidden',
    border: hover ? `1px solid ${colors.rose}` : `1px dashed ${colors.rule}`,
    background: colors.fill,
    boxShadow: item ? shadow.card : 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  const overlayBtnStyle: CSSProperties = {
    appearance: 'none',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    padding: '4px 10px',
    borderRadius: radii.pill,
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fonts.sans,
    background: 'rgba(255,255,255,0.92)',
    color: colors.inkStrong,
    boxShadow: shadow.card,
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          onPick(e.target.files?.[0])
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
      <div
        style={frameStyle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          if (!disabled && !item) inputRef.current?.click()
        }}
        title={item ? undefined : emptyHint}
      >
        {uploading ? (
          <span style={{ color: colors.muted, fontSize: 13 }}>上传中…</span>
        ) : item ? (
          <>
            {kind === 'video' ? (
              item.url ? (
                <video
                  src={item.url}
                  controls
                  style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                />
              ) : (
                <span style={{ color: colors.muted, fontSize: 12, padding: 8, textAlign: 'center' }}>
                  视频已上传（暂不可预览）
                </span>
              )
            ) : item.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt="封面预览"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <span style={{ color: colors.muted, fontSize: 12, padding: 8, textAlign: 'center' }}>
                图片已上传（暂不可预览）
              </span>
            )}

            {/* 重传 / 移除浮层 */}
            <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 6 }}>
              <button
                type="button"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  inputRef.current?.click()
                }}
                style={overlayBtnStyle}
              >
                重新上传
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  onClear()
                }}
                style={{ ...overlayBtnStyle, color: '#9a3b36' }}
                aria-label="移除"
              >
                ✕
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', color: colors.muted, padding: space.md }}>
            <div style={{ fontSize: 28, marginBottom: 6 }} aria-hidden>
              {kind === 'video' ? '🎬' : '🖼️'}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: colors.rose }}>{emptyHint}</div>
          </div>
        )}
      </div>
    </div>
  )
}
