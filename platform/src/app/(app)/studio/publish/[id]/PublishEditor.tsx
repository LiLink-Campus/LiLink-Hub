'use client'

// studio/publish/[id]/PublishEditor.tsx —— 发布配置页交互主体（客户端）。
//
// 设计依据 §7「发布步骤（平台与 meta 分离 + 长文扩展位）」、§11 视觉（微光玫瑰、0 门槛）。
// 由同目录 page.tsx（Server Component）直出初始数据 + 首屏预览后挂载，接管：
//   - 平台选择：长文用 LONGFORM_PLATFORMS（仅公众号可选，其余「敬请期待」灰显）；
//     图文/视频用 manualChannelsFor（小红书 / 视频号 / 抖音）。
//   - meta 表单（按形态动态）：
//       公众号 → 作者 / 摘要 / 封面 / 阅读原文 / 文末按钮(CTA)。
//       图文视频 → 平台标题 / 描述 / 话题标签 / 封面或素材（图文多图、视频文件 + 横竖封面）/ 形态。
//   - 字段改动调 updateContent(id, …) 保存（失焦保存 + 顶部「保存中/已保存」轻提示）；保存后刷新预览。
//   - 右侧预览：公众号塞 renderToInlineHtml 的全内联 HTML 进手机框；图文视频展示人工发布包。
//   - 底部「提交审核」：先做友好必填校验（公众号需封面；图文需≥1 图；视频需视频文件），
//     通过后 submitForReview(id) → 成功态提示「已提交，进入审核队列」并跳 /studio。
//
// 复用：UI 取 _ui；色值/字体取 _lib/theme；平台映射取 _lib/platforms；
//       写动作取 _lib/actions（updateContent / uploadMedia / submitForReview）；
//       预览刷新取同目录 ./actions（refreshWechatPreview / refreshSocialPackage）。
//
// 【硬约束】本组件在 (app)/studio 外壳内 —— 绝不渲染 <html>/<body> 或顶栏。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'

import {
  Button,
  Card,
  Field,
  StatusBadge,
  StepHeader,
  TextInput,
  Textarea,
} from '../../_ui'
import { colors, fonts, radii, space, shadow } from '../../_lib/theme'
import {
  LONGFORM_PLATFORMS,
  manualChannelsFor,
} from '../../_lib/platforms'
import type { ContentForm, StudioStatus } from '../../_lib/types'
import {
  submitForReview,
  updateContent,
  uploadMedia,
} from '../../_lib/actions'
import type { SocialPublishPackage } from '@/renderers/social-package'
import { refreshSocialPackage, refreshWechatPreview } from './actions'

// ============================================================
// 共享形状（与 page.tsx 一致）。
// ============================================================

/** 媒体引用的轻量形状（封面 / 图文图 / 视频 / 封面图）。 */
export interface MediaRef {
  id: string
  url: string
  alt: string
}

export interface InitialPublishData {
  id: string
  form: ContentForm
  status: StudioStatus
  platform: string
  contentMode: string | null
  postTitle: string

  // 公众号
  wxTitle: string
  wxAuthor: string
  wxDigest: string
  sourceUrl: string
  coverImage: MediaRef | null
  ctaUrl: string
  ctaText: string
  noCta: boolean

  // 图文 / 视频
  socialTitle: string
  socialDescription: string
  socialTags: string[]
  socialImages: MediaRef[]
  videoFile: MediaRef | null
  horizontalCover: MediaRef | null
  verticalCover: MediaRef | null
}

interface PublishEditorProps {
  initial: InitialPublishData
  initialPreviewHtml: string
  initialPreviewTitle: string
  initialPackage: SocialPublishPackage | null
  initialPackageError: string
}

// 保存状态指示。
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const FORM_LABEL: Record<ContentForm, string> = {
  article: '长文 · 公众号',
  imagetext: '图文笔记',
  video: '视频',
}

// ============================================================
// 主组件
// ============================================================

export function PublishEditor({
  initial,
  initialPreviewHtml,
  initialPreviewTitle,
  initialPackage,
  initialPackageError,
}: PublishEditorProps) {
  const router = useRouter()
  const { id, form } = initial

  // 只有草稿态可编辑 / 提交；其余状态进入只读查看（避免误改已送审/已发布的稿）。
  const editable = initial.status === 'draft'

  // ---------- 表单受控状态 ----------
  const [platform, setPlatform] = useState(initial.platform)

  // 公众号 meta
  const [wxAuthor, setWxAuthor] = useState(initial.wxAuthor)
  const [wxDigest, setWxDigest] = useState(initial.wxDigest)
  const [sourceUrl, setSourceUrl] = useState(initial.sourceUrl)
  const [coverImage, setCoverImage] = useState<MediaRef | null>(initial.coverImage)
  const [ctaUrl, setCtaUrl] = useState(initial.ctaUrl)
  const [ctaText, setCtaText] = useState(initial.ctaText)
  const [noCta, setNoCta] = useState(initial.noCta)

  // 图文 / 视频 meta
  const [socialTitle, setSocialTitle] = useState(initial.socialTitle)
  const [socialDescription, setSocialDescription] = useState(initial.socialDescription)
  const [tags, setTags] = useState<string[]>(initial.socialTags)
  const [socialImages, setSocialImages] = useState<MediaRef[]>(initial.socialImages)
  const [videoFile, setVideoFile] = useState<MediaRef | null>(initial.videoFile)
  const [horizontalCover, setHorizontalCover] = useState<MediaRef | null>(initial.horizontalCover)
  const [verticalCover, setVerticalCover] = useState<MediaRef | null>(initial.verticalCover)

  // ---------- 预览状态 ----------
  const [previewHtml, setPreviewHtml] = useState(initialPreviewHtml)
  const [previewTitle, setPreviewTitle] = useState(initialPreviewTitle)
  const [pkg, setPkg] = useState<SocialPublishPackage | null>(initialPackage)
  const [pkgError, setPkgError] = useState(initialPackageError)
  const [previewBusy, setPreviewBusy] = useState(false)

  // ---------- 保存 / 提交 / 错误 状态 ----------
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, startSubmit] = useTransition()

  // 「已保存」短暂提示后自动淡回 idle。
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  // ---------- 预览刷新 ----------
  const doRefreshPreview = useCallback(async () => {
    setPreviewBusy(true)
    try {
      if (form === 'article') {
        const res = await refreshWechatPreview(id)
        setPreviewHtml(res.html)
        setPreviewTitle(res.title)
      } else {
        const res = await refreshSocialPackage(id)
        if (res.ok) {
          setPkg(res.package)
          setPkgError('')
        } else {
          setPkgError(res.error)
        }
      }
    } catch {
      // 预览刷新失败不打断编辑；保留上一份预览。
    } finally {
      setPreviewBusy(false)
    }
  }, [form, id])

  // ---------- 统一保存：把一组字段写回，再刷新预览 ----------
  const save = useCallback(
    async (data: Record<string, unknown>) => {
      if (!editable) return
      setSaveState('saving')
      setSaveError('')
      try {
        await updateContent(id, data)
        setSaveState('saved')
        if (savedTimer.current) clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSaveState('idle'), 1600)
        // 保存成功后刷新预览（公众号 HTML / 发布包随 meta 变化）。
        void doRefreshPreview()
      } catch (err) {
        setSaveState('error')
        setSaveError(err instanceof Error ? err.message : '保存失败，请重试。')
      }
    },
    [editable, id, doRefreshPreview],
  )

  // ---------- 平台切换 ----------
  const onSelectPlatform = useCallback(
    (code: string) => {
      if (!editable || code === platform) return
      setPlatform(code)
      void save({ platform: code })
    },
    [editable, platform, save],
  )

  // ---------- 媒体上传助手：上传一个文件 → MediaRef ----------
  const uploadOne = useCallback(async (file: File): Promise<MediaRef> => {
    const fd = new FormData()
    fd.append('file', file)
    if (file.name) fd.append('alt', file.name.replace(/\.[^.]+$/, ''))
    const res = await uploadMedia(fd)
    return { id: res.id, url: res.url, alt: file.name ?? '' }
  }, [])

  // ---------- 校验（友好必填） ----------
  const validation = useMemo(() => {
    if (form === 'article') {
      if (!coverImage) return '公众号发布需要一张封面图：请先上传封面再提交。'
      return ''
    }
    if (form === 'imagetext') {
      if (socialImages.length === 0)
        return '图文至少需要 1 张图片：请在「图文图片」里上传后再提交。'
      return ''
    }
    // video
    if (!videoFile) return '视频发布需要先上传视频文件：请在「视频文件」里上传后再提交。'
    return ''
  }, [form, coverImage, socialImages.length, videoFile])

  // ---------- 提交审核 ----------
  const onSubmit = useCallback(() => {
    setSubmitError('')
    if (!editable) {
      setSubmitError('当前内容不在草稿状态，无法重复提交。')
      return
    }
    if (validation) {
      setSubmitError(validation)
      return
    }
    startSubmit(async () => {
      try {
        await submitForReview(id)
        setSubmitted(true)
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : '提交失败，请重试。')
      }
    })
  }, [editable, validation, id])

  // 提交成功：短暂展示「已提交」后跳工作台。
  useEffect(() => {
    if (!submitted) return
    const t = setTimeout(() => {
      router.push('/studio')
      router.refresh()
    }, 1300)
    return () => clearTimeout(t)
  }, [submitted, router])

  // ============================================================
  // 提交成功全屏态
  // ============================================================
  if (submitted) {
    return (
      <div>
        <StepHeader current="review" />
        <Card style={{ textAlign: 'center', padding: space.xl }}>
          <div style={{ fontSize: 44, lineHeight: 1, marginBottom: space.md }} aria-hidden>
            ✓
          </div>
          <h1
            style={{
              margin: `0 0 ${space.sm}`,
              fontFamily: fonts.serif,
              fontSize: 22,
              fontWeight: 700,
              color: colors.inkStrong,
            }}
          >
            已提交，进入审核队列
          </h1>
          <p style={{ margin: `0 0 ${space.lg}`, color: colors.muted, fontSize: 14.5, lineHeight: 1.7 }}>
            内容已送审，正在为你返回工作台……
          </p>
          <Button onClick={() => router.push('/studio')}>返回工作台</Button>
        </Card>
      </div>
    )
  }

  // ============================================================
  // 正常编辑态
  // ============================================================
  return (
    <div>
      <StepHeader current="publish" />

      {/* 标题区 */}
      <header style={{ marginBottom: space.lg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <h1
            style={{
              margin: 0,
              fontFamily: fonts.serif,
              fontSize: 26,
              fontWeight: 700,
              color: colors.inkStrong,
              lineHeight: 1.3,
            }}
          >
            发布配置
          </h1>
          <StatusBadge status={initial.status} />
        </div>
        <p style={{ margin: `${space.xs} 0 0`, fontSize: 14.5, color: colors.muted, lineHeight: 1.6 }}>
          {FORM_LABEL[form]} · {previewTitle || initial.postTitle} · 选好平台、补齐信息，右侧即时预览发布效果。
        </p>
        {!editable ? (
          <NoticeBar tone="info">
            当前内容状态为「{statusLabel(initial.status)}」，仅供查看；如需修改请先在审核队列打回到草稿。
          </NoticeBar>
        ) : null}
      </header>

      {/* 两栏：左表单 右预览（移动端自动堆叠） */}
      <div style={layoutGrid}>
        {/* ===== 左：表单 ===== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg, minWidth: 0 }}>
          {/* 平台选择 */}
          <Card>
            <SectionTitle>选择发布平台</SectionTitle>
            {form === 'article' ? (
              <LongformPlatformPicker value={platform} onPick={onSelectPlatform} disabled={!editable} />
            ) : (
              <ManualPlatformPicker
                form={form}
                value={platform}
                onPick={onSelectPlatform}
                disabled={!editable}
              />
            )}
          </Card>

          {/* meta 表单 */}
          {form === 'article' ? (
            <Card>
              <SectionTitle>公众号信息</SectionTitle>
              <Field label="作者" hint="显示在公众号文章标题下方，可留空。">
                <TextInput
                  value={wxAuthor}
                  disabled={!editable}
                  placeholder="如：LiLink 运营组"
                  onChange={(e) => setWxAuthor(e.target.value)}
                  onBlur={() => wxAuthor !== initial.wxAuthor && save({ wxAuthor })}
                />
              </Field>

              <Field label="摘要" hint="公众号推送时的摘要；留空则微信自动从正文截取。">
                <Textarea
                  value={wxDigest}
                  disabled={!editable}
                  rows={3}
                  placeholder="一两句话概括这篇文章……"
                  onChange={(e) => setWxDigest(e.target.value)}
                  onBlur={() => wxDigest !== initial.wxDigest && save({ wxDigest })}
                />
              </Field>

              <Field label="封面图 *" hint="公众号必填。建议比例 2.35:1，从本地上传。">
                <SingleImagePicker
                  value={coverImage}
                  disabled={!editable}
                  uploadOne={uploadOne}
                  onChange={(ref) => {
                    setCoverImage(ref)
                    void save({ coverImage: ref ? ref.id : null })
                  }}
                  emptyHint="上传封面图"
                />
              </Field>

              <Field label="阅读原文链接" hint="公众号「阅读原文」跳转地址。">
                <TextInput
                  value={sourceUrl}
                  disabled={!editable}
                  placeholder="https://lilink.top"
                  onChange={(e) => setSourceUrl(e.target.value)}
                  onBlur={() => sourceUrl !== initial.sourceUrl && save({ sourceUrl })}
                />
              </Field>

              <Field label="文末按钮" hint="文章结尾的引导胶囊按钮（视觉引导，不可点击）。">
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: space.sm,
                    marginBottom: space.sm,
                    fontSize: 15,
                    color: colors.ink,
                    cursor: editable ? 'pointer' : 'default',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={noCta}
                    disabled={!editable}
                    onChange={(e) => {
                      const v = e.target.checked
                      setNoCta(v)
                      void save({ renderConfig: { ctaUrl, ctaText, noCta: v } })
                    }}
                    style={{ width: 18, height: 18, accentColor: colors.rose }}
                  />
                  不加文末按钮
                </label>
                {!noCta ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
                    <TextInput
                      value={ctaText}
                      disabled={!editable}
                      placeholder="按钮文案，如：去 LiLink 看看 →"
                      onChange={(e) => setCtaText(e.target.value)}
                      onBlur={() =>
                        ctaText !== initial.ctaText && save({ renderConfig: { ctaUrl, ctaText, noCta } })
                      }
                    />
                    <TextInput
                      value={ctaUrl}
                      disabled={!editable}
                      placeholder="按钮链接，如：https://lilink.top"
                      onChange={(e) => setCtaUrl(e.target.value)}
                      onBlur={() =>
                        ctaUrl !== initial.ctaUrl && save({ renderConfig: { ctaUrl, ctaText, noCta } })
                      }
                    />
                  </div>
                ) : null}
              </Field>
            </Card>
          ) : (
            <Card>
              <SectionTitle>{form === 'video' ? '视频信息' : '图文信息'}</SectionTitle>

              <Field label="标题" hint={socialTitleHint(platform)}>
                <TextInput
                  value={socialTitle}
                  disabled={!editable}
                  placeholder="一句吸引人的标题……"
                  onChange={(e) => setSocialTitle(e.target.value)}
                  onBlur={() => socialTitle !== initial.socialTitle && save({ socialTitle })}
                />
              </Field>

              <Field label="正文 / 描述" hint="发布包会自动拼上话题标签与 LiLink 链接。">
                <Textarea
                  value={socialDescription}
                  disabled={!editable}
                  rows={5}
                  placeholder="写点什么吧……"
                  onChange={(e) => setSocialDescription(e.target.value)}
                  onBlur={() =>
                    socialDescription !== initial.socialDescription &&
                    save({ socialDescription })
                  }
                />
              </Field>

              <Field label="话题标签" hint="不用带 #，回车或点「添加」即可；系统会自动补 #LiLink #校园社交。">
                <TagsEditor
                  tags={tags}
                  disabled={!editable}
                  onChange={(next) => {
                    setTags(next)
                    void save({ socialTags: next.map((t) => ({ tag: t })) })
                  }}
                />
              </Field>

              {form === 'imagetext' ? (
                <Field label="图文图片 *" hint="至少 1 张；顺序即发布顺序，首图通常作封面。">
                  <MultiImagePicker
                    value={socialImages}
                    disabled={!editable}
                    uploadOne={uploadOne}
                    onChange={(next) => {
                      setSocialImages(next)
                      void save({ socialImages: next.map((m) => m.id) })
                    }}
                  />
                </Field>
              ) : (
                <>
                  <Field label="视频文件 *" hint="必填。上传后会列入发布包供人工上传到平台。">
                    <SingleMediaPicker
                      value={videoFile}
                      kind="video"
                      disabled={!editable}
                      uploadOne={uploadOne}
                      onChange={(ref) => {
                        setVideoFile(ref)
                        void save({ videoFile: ref ? ref.id : null })
                      }}
                      emptyHint="上传视频文件"
                    />
                  </Field>
                  <Field label="横封面" hint="视频号 / 抖音横版封面（可选）。">
                    <SingleImagePicker
                      value={horizontalCover}
                      disabled={!editable}
                      uploadOne={uploadOne}
                      onChange={(ref) => {
                        setHorizontalCover(ref)
                        void save({ horizontalCover: ref ? ref.id : null })
                      }}
                      emptyHint="上传横封面"
                    />
                  </Field>
                  <Field label="竖封面" hint="小红书 / 抖音竖版封面（可选，建议 3:4）。">
                    <SingleImagePicker
                      value={verticalCover}
                      disabled={!editable}
                      uploadOne={uploadOne}
                      onChange={(ref) => {
                        setVerticalCover(ref)
                        void save({ verticalCover: ref ? ref.id : null })
                      }}
                      emptyHint="上传竖封面"
                    />
                  </Field>
                </>
              )}
            </Card>
          )}
        </div>

        {/* ===== 右：预览 ===== */}
        <div style={{ minWidth: 0 }}>
          <div style={{ position: 'sticky', top: 76 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: space.sm,
              }}
            >
              <SectionTitle style={{ margin: 0 }}>
                {form === 'article' ? '公众号预览' : '人工发布包预览'}
              </SectionTitle>
              <span style={{ fontSize: 12.5, color: colors.muted, minHeight: 18 }}>
                {previewBusy ? '更新中…' : '随编辑实时更新'}
              </span>
            </div>

            {form === 'article' ? (
              <WechatPhonePreview title={previewTitle} html={previewHtml} />
            ) : (
              <SocialPackageView pkg={pkg} error={pkgError} />
            )}
          </div>
        </div>
      </div>

      {/* ===== 底部操作条：保存状态 + 提交审核 ===== */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          marginTop: space.xl,
          padding: `${space.md} 0`,
          background: `linear-gradient(to top, ${colors.page} 70%, rgba(255,250,249,0))`,
        }}
      >
        {submitError ? <NoticeBar tone="error">{submitError}</NoticeBar> : null}
        {saveState === 'error' && saveError ? <NoticeBar tone="error">{saveError}</NoticeBar> : null}
        {editable && validation && !submitError ? (
          <NoticeBar tone="info">{validation}</NoticeBar>
        ) : null}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.md,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13.5, color: colors.muted, minHeight: 20 }}>
            {saveState === 'saving'
              ? '保存中…'
              : saveState === 'saved'
                ? '已保存 ✓'
                : saveState === 'error'
                  ? '保存失败'
                  : editable
                    ? '改动会自动保存'
                    : ''}
          </span>

          <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => router.push('/studio')}>
              返回工作台
            </Button>
            <Button
              onClick={onSubmit}
              disabled={!editable || isSubmitting || saveState === 'saving' || Boolean(validation)}
            >
              {isSubmitting ? '提交中…' : '提交审核'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 布局 / 小工具
// ============================================================

// 两栏网格：≥860px 时左表单 + 右预览(约 380px)；窄屏堆叠。
// 用内联 grid（白名单外的 CSS 在 React 内联里安全，仅用于本工作台界面，不进公众号产物）。
const layoutGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 380px)',
  gap: space.lg,
  alignItems: 'start',
}

function statusLabel(s: StudioStatus): string {
  return (
    { draft: '草稿', in_review: '审核中', approved: '已通过', ready_to_publish: '待发布', published: '已发布' } as Record<
      StudioStatus,
      string
    >
  )[s]
}

function socialTitleHint(platform: string): string {
  if (platform === 'weixin_channels') return '视频号标题建议 16 字内，超出发布包会截断。'
  if (platform === 'xiaohongshu') return '小红书标题建议 20 字内，超出发布包会截断。'
  if (platform === 'douyin') return '抖音标题建议 30 字内，超出发布包会截断。'
  return '一句吸引人的标题。'
}

function SectionTitle({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <h2
      style={{
        margin: `0 0 ${space.md}`,
        fontFamily: fonts.serif,
        fontSize: 18,
        fontWeight: 700,
        color: colors.inkStrong,
        lineHeight: 1.4,
        ...style,
      }}
    >
      {children}
    </h2>
  )
}

function NoticeBar({ tone, children }: { tone: 'info' | 'error'; children: ReactNode }) {
  const isErr = tone === 'error'
  return (
    <div
      role={isErr ? 'alert' : 'status'}
      style={{
        margin: `${space.sm} 0`,
        padding: `10px ${space.md}`,
        borderRadius: radii.md,
        fontSize: 13.5,
        lineHeight: 1.6,
        color: isErr ? '#9a2f2f' : colors.ink,
        background: isErr ? '#fdeced' : colors.fill,
        border: `1px solid ${isErr ? '#f3c9c9' : colors.rule}`,
      }}
    >
      {children}
    </div>
  )
}

// ============================================================
// 平台选择
// ============================================================

function platformOptionStyle(selected: boolean, disabled: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    padding: `12px ${space.md}`,
    borderRadius: radii.md,
    border: `1.5px solid ${selected ? colors.rose : colors.rule}`,
    background: selected ? colors.fill : colors.surface,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    fontSize: 15,
    fontWeight: 600,
    color: selected ? colors.rose : colors.ink,
    boxSizing: 'border-box',
  }
}

function Radio({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        border: `2px solid ${selected ? colors.rose : colors.muted}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {selected ? (
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: colors.rose }} />
      ) : null}
    </span>
  )
}

function LongformPlatformPicker({
  value,
  onPick,
  disabled,
}: {
  value: string
  onPick: (code: string) => void
  disabled: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
      {LONGFORM_PLATFORMS.map((p) => {
        const selected = value === p.code
        const itemDisabled = disabled || !p.active
        return (
          <div
            key={p.code}
            role="button"
            tabIndex={p.active && !disabled ? 0 : -1}
            aria-disabled={itemDisabled}
            onClick={() => p.active && !disabled && onPick(p.code)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && p.active && !disabled) {
                e.preventDefault()
                onPick(p.code)
              }
            }}
            style={platformOptionStyle(selected, itemDisabled)}
          >
            <Radio selected={selected} />
            <span style={{ flex: 1 }}>{p.label}</span>
            {!p.active ? (
              <span style={{ fontSize: 12.5, fontWeight: 500, color: colors.muted }}>敬请期待</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ManualPlatformPicker({
  form,
  value,
  onPick,
  disabled,
}: {
  form: ContentForm
  value: string
  onPick: (code: string) => void
  disabled: boolean
}) {
  const options = manualChannelsFor(form)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
      {options.map((p) => {
        const selected = value === p.code
        return (
          <div
            key={p.code}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            onClick={() => !disabled && onPick(p.code)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
                e.preventDefault()
                onPick(p.code)
              }
            }}
            style={platformOptionStyle(selected, disabled)}
          >
            <Radio selected={selected} />
            <span style={{ flex: 1 }}>{p.label}</span>
          </div>
        )
      })}
      <p style={{ margin: `${space.xs} 0 0`, fontSize: 12.5, color: colors.muted, lineHeight: 1.6 }}>
        这些平台暂无开放发布接口，提交审核通过后会生成「人工发布包」，由运营手动发布。
      </p>
    </div>
  )
}

// ============================================================
// 媒体选择器（封面 / 视频 / 多图）
// ============================================================

const dropZoneStyle = (disabled: boolean): CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: space.xs,
  width: '100%',
  minHeight: 96,
  padding: space.md,
  borderRadius: radii.md,
  border: `1.5px dashed ${colors.rule}`,
  background: colors.fill,
  color: colors.muted,
  fontSize: 14,
  cursor: disabled ? 'not-allowed' : 'pointer',
  boxSizing: 'border-box',
  textAlign: 'center',
})

function useUploader(uploadOne: (f: File) => Promise<MediaRef>) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = useCallback(
    async (files: FileList | File[], onDone: (refs: MediaRef[]) => void) => {
      const list = Array.from(files)
      if (list.length === 0) return
      setBusy(true)
      setErr('')
      try {
        const refs: MediaRef[] = []
        for (const f of list) {
          refs.push(await uploadOne(f))
        }
        onDone(refs)
      } catch (e) {
        setErr(e instanceof Error ? e.message : '上传失败，请重试。')
      } finally {
        setBusy(false)
      }
    },
    [uploadOne],
  )
  return { busy, err, run }
}

function ThumbBox({ media, onRemove, disabled }: { media: MediaRef; onRemove?: () => void; disabled?: boolean }) {
  return (
    <div
      style={{
        position: 'relative',
        width: 96,
        height: 96,
        borderRadius: radii.md,
        overflow: 'hidden',
        border: `1px solid ${colors.rule}`,
        background: colors.fill,
        flexShrink: 0,
      }}
    >
      {media.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.url}
          alt={media.alt || ''}
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
            fontSize: 12,
            color: colors.muted,
            padding: 6,
            textAlign: 'center',
          }}
        >
          已选媒体
        </div>
      )}
      {onRemove && !disabled ? (
        <button
          type="button"
          aria-label="移除"
          onClick={onRemove}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(52,45,43,0.7)',
            color: '#fff',
            fontSize: 14,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}

function SingleImagePicker({
  value,
  onChange,
  uploadOne,
  disabled,
  emptyHint,
}: {
  value: MediaRef | null
  onChange: (ref: MediaRef | null) => void
  uploadOne: (f: File) => Promise<MediaRef>
  disabled: boolean
  emptyHint: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { busy, err, run } = useUploader(uploadOne)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space.md, flexWrap: 'wrap' }}>
        {value ? (
          <ThumbBox media={value} disabled={disabled} onRemove={() => onChange(null)} />
        ) : null}
        <div style={{ flex: 1, minWidth: 160 }}>
          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || busy}
            onClick={() => !disabled && !busy && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !disabled && !busy) {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            style={dropZoneStyle(disabled || busy)}
          >
            <span style={{ fontSize: 22 }} aria-hidden>
              {busy ? '⏳' : '＋'}
            </span>
            <span>{busy ? '上传中…' : value ? '点击替换' : emptyHint}</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            disabled={disabled || busy}
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = e.target.files
              if (files && files.length) run(files, (refs) => refs[0] && onChange(refs[0]))
              e.target.value = ''
            }}
          />
        </div>
      </div>
      {err ? <p style={{ margin: `${space.xs} 0 0`, fontSize: 12.5, color: '#9a2f2f' }}>{err}</p> : null}
    </div>
  )
}

function SingleMediaPicker({
  value,
  kind,
  onChange,
  uploadOne,
  disabled,
  emptyHint,
}: {
  value: MediaRef | null
  kind: 'video'
  onChange: (ref: MediaRef | null) => void
  uploadOne: (f: File) => Promise<MediaRef>
  disabled: boolean
  emptyHint: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { busy, err, run } = useUploader(uploadOne)
  const accept = kind === 'video' ? 'video/*' : 'image/*'

  return (
    <div>
      {value ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: space.sm,
            padding: `10px ${space.md}`,
            borderRadius: radii.md,
            border: `1px solid ${colors.rule}`,
            background: colors.surface,
            marginBottom: space.sm,
          }}
        >
          <span style={{ fontSize: 20 }} aria-hidden>
            🎬
          </span>
          <span
            style={{
              flex: 1,
              fontSize: 14,
              color: colors.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={value.alt || value.id}
          >
            {value.alt || `视频 #${value.id}`}
          </span>
          {!disabled ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              style={{
                appearance: 'none',
                border: 'none',
                background: 'transparent',
                color: colors.muted,
                fontSize: 13,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              移除
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || busy}
        onClick={() => !disabled && !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled && !busy) {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        style={dropZoneStyle(disabled || busy)}
      >
        <span style={{ fontSize: 22 }} aria-hidden>
          {busy ? '⏳' : '＋'}
        </span>
        <span>{busy ? '上传中…' : value ? '点击替换视频' : emptyHint}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled || busy}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files
          if (files && files.length) run(files, (refs) => refs[0] && onChange(refs[0]))
          e.target.value = ''
        }}
      />
      {err ? <p style={{ margin: `${space.xs} 0 0`, fontSize: 12.5, color: '#9a2f2f' }}>{err}</p> : null}
    </div>
  )
}

function MultiImagePicker({
  value,
  onChange,
  uploadOne,
  disabled,
}: {
  value: MediaRef[]
  onChange: (next: MediaRef[]) => void
  uploadOne: (f: File) => Promise<MediaRef>
  disabled: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { busy, err, run } = useUploader(uploadOne)

  const removeAt = (idx: number) => onChange(value.filter((_, i) => i !== idx))

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, marginBottom: value.length ? space.sm : 0 }}>
        {value.map((m, idx) => (
          <div key={`${m.id}-${idx}`} style={{ position: 'relative' }}>
            <ThumbBox media={m} disabled={disabled} onRemove={() => removeAt(idx)} />
            <span
              aria-hidden
              style={{
                position: 'absolute',
                bottom: 4,
                left: 4,
                padding: '1px 7px',
                borderRadius: radii.pill,
                background: 'rgba(52,45,43,0.7)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {idx + 1}
            </span>
          </div>
        ))}
      </div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || busy}
        onClick={() => !disabled && !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled && !busy) {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        style={dropZoneStyle(disabled || busy)}
      >
        <span style={{ fontSize: 22 }} aria-hidden>
          {busy ? '⏳' : '＋'}
        </span>
        <span>{busy ? '上传中…' : value.length ? '继续添加图片' : '上传图片（可多选）'}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={disabled || busy}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files
          if (files && files.length) run(files, (refs) => onChange([...value, ...refs]))
          e.target.value = ''
        }}
      />
      {err ? <p style={{ margin: `${space.xs} 0 0`, fontSize: 12.5, color: '#9a2f2f' }}>{err}</p> : null}
    </div>
  )
}

// ============================================================
// 话题标签编辑器
// ============================================================

function TagsEditor({
  tags,
  onChange,
  disabled,
}: {
  tags: string[]
  onChange: (next: string[]) => void
  disabled: boolean
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const v = draft.replace(/^#+/, '').trim()
    if (!v) return
    if (tags.some((t) => t.toLowerCase() === v.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...tags, v])
    setDraft('')
  }

  return (
    <div>
      {tags.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs, marginBottom: space.sm }}>
          {tags.map((t, idx) => (
            <span
              key={`${t}-${idx}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 6px 4px 12px',
                borderRadius: radii.pill,
                background: colors.fill,
                border: `1px solid ${colors.rule}`,
                color: colors.rose,
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              #{t}
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`移除话题 ${t}`}
                  onClick={() => onChange(tags.filter((_, i) => i !== idx))}
                  style={{
                    appearance: 'none',
                    border: 'none',
                    background: 'transparent',
                    color: colors.muted,
                    fontSize: 15,
                    lineHeight: 1,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {!disabled ? (
        <div style={{ display: 'flex', gap: space.sm }}>
          <TextInput
            value={draft}
            placeholder="输入话题后回车，如：校园生活"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            style={{ flex: 1 }}
          />
          <Button variant="ghost" onClick={add} style={{ minHeight: 'auto', padding: `0 ${space.md}` }}>
            添加
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// ============================================================
// 公众号手机预览（复用预览页的「手机屏」视觉 + renderToInlineHtml 产物）
// ============================================================

function WechatPhonePreview({ title, html }: { title: string; html: string }) {
  return (
    <div
      style={{
        background: '#ebeced',
        borderRadius: radii.lg,
        padding: space.md,
        border: `1px solid ${colors.rule}`,
        boxShadow: shadow.card,
      }}
    >
      <div
        style={{
          maxWidth: 360,
          margin: '0 auto',
          background: '#ffffff',
          borderRadius: radii.md,
          overflow: 'hidden',
          boxShadow: '0 1px 8px rgba(0,0,0,0.08)',
        }}
      >
        <div style={{ padding: '18px 16px 0' }}>
          <h1
            style={{
              fontSize: 21,
              lineHeight: 1.4,
              fontWeight: 700,
              color: '#1a1a1a',
              margin: '0 0 14px',
              fontFamily: fonts.serif,
            }}
          >
            {title}
          </h1>
        </div>
        <div style={{ padding: '0 16px 20px', maxHeight: 560, overflow: 'auto' }}>
          {html ? (
            // 这串就是发布会用的同一份全内联 HTML —— 预览=最终。
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <p style={{ color: colors.muted, fontSize: 14, lineHeight: 1.7, padding: `${space.lg} 0` }}>
              正文还是空的。回到创作页写点内容，这里会实时显示发布效果。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 人工发布包预览（图文 / 视频）
// ============================================================

function SocialPackageView({ pkg, error }: { pkg: SocialPublishPackage | null; error: string }) {
  if (error && !pkg) {
    return (
      <Card>
        <NoticeBar tone="info">
          {error || '暂时无法生成发布包预览，补齐平台与素材后会自动出现。'}
        </NoticeBar>
      </Card>
    )
  }
  if (!pkg) {
    return (
      <Card>
        <p style={{ margin: 0, color: colors.muted, fontSize: 14, lineHeight: 1.7 }}>
          选好平台、填好信息后，这里会生成可复制的「人工发布包」。
        </p>
      </Card>
    )
  }

  const errors = pkg.warnings.filter((w) => w.level === 'error')
  const warns = pkg.warnings.filter((w) => w.level === 'warning')

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.rose }}>{pkg.platformLabel}</span>
        <span style={{ fontSize: 12.5, color: colors.muted }}>
          {pkg.mode === 'video' ? '视频' : '图文/笔记'}
        </span>
      </div>

      {/* 告警 / 错误 */}
      {errors.map((w, i) => (
        <NoticeBar key={`e${i}`} tone="error">
          {w.message}
        </NoticeBar>
      ))}
      {warns.map((w, i) => (
        <NoticeBar key={`w${i}`} tone="info">
          {w.message}
        </NoticeBar>
      ))}

      <PkgRow label="标题">
        <CopyableText text={pkg.title || '（未填写）'} />
      </PkgRow>

      <PkgRow label="正文（含话题 / 链接）">
        <CopyableText text={pkg.caption || '（未填写）'} multiline />
      </PkgRow>

      {pkg.hashtags.length ? (
        <PkgRow label="话题标签">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs }}>
            {pkg.hashtags.map((h, i) => (
              <span
                key={`${h}-${i}`}
                style={{
                  padding: '3px 10px',
                  borderRadius: radii.pill,
                  background: colors.fill,
                  border: `1px solid ${colors.rule}`,
                  color: colors.rose,
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                {h}
              </span>
            ))}
          </div>
        </PkgRow>
      ) : null}

      <PkgRow label={`素材清单（${pkg.assets.length}）`}>
        {pkg.assets.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
            {pkg.assets.map((a, i) => (
              <div
                key={`${a.id ?? a.url ?? i}`}
                style={{ display: 'flex', alignItems: 'center', gap: space.sm, fontSize: 13, color: colors.ink }}
              >
                <span style={{ color: colors.muted, fontSize: 12, minWidth: 64 }}>{assetRoleLabel(a.role)}</span>
                <span
                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={a.url || a.filename || String(a.id ?? '')}
                >
                  {a.filename || a.url || `媒体 #${a.id ?? '?'}`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 13, color: colors.muted }}>暂无素材，请在左侧上传。</span>
        )}
      </PkgRow>

      <details style={{ marginTop: space.sm }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: colors.ink }}>
          人工发布步骤（{pkg.checklist.length} 步）
        </summary>
        <ol style={{ margin: `${space.sm} 0 0`, paddingLeft: 20, color: colors.ink, fontSize: 13, lineHeight: 1.8 }}>
          {pkg.checklist.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ol>
        {pkg.publishUrl ? (
          <p style={{ margin: `${space.sm} 0 0`, fontSize: 12.5, color: colors.muted, wordBreak: 'break-all' }}>
            发布入口：{pkg.publishUrl}
          </p>
        ) : null}
      </details>
    </Card>
  )
}

function assetRoleLabel(role: SocialPublishPackage['assets'][number]['role']): string {
  return (
    {
      image: '图片',
      video: '视频',
      horizontal_cover: '横封面',
      vertical_cover: '竖封面',
    } as Record<string, string>
  )[role] ?? role
}

function PkgRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: space.md }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: colors.muted, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function CopyableText({ text, multiline }: { text: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // 剪贴板不可用时静默（用户可手动选中复制）。
    }
  }
  return (
    <div
      style={{
        position: 'relative',
        padding: `10px 64px 10px ${space.md}`,
        borderRadius: radii.md,
        background: colors.fill,
        border: `1px solid ${colors.rule}`,
        fontSize: 13.5,
        lineHeight: 1.7,
        color: colors.ink,
        whiteSpace: multiline ? 'pre-wrap' : 'normal',
        wordBreak: 'break-word',
      }}
    >
      {text}
      <button
        type="button"
        onClick={onCopy}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          appearance: 'none',
          border: `1px solid ${colors.rule}`,
          background: colors.surface,
          color: colors.rose,
          borderRadius: radii.pill,
          fontSize: 12,
          fontWeight: 600,
          padding: '3px 10px',
          cursor: 'pointer',
        }}
      >
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}
