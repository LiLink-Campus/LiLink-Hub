'use client'

// studio/create/page.tsx —— 选创作形式（创作入口）。
//
// 设计依据 §3「开始创作 → 选形式：📄长文 / 🖼图文 / 🎬视频（3 张卡片）」、§4「三种创作形式」、
// §13 里程碑 2。流程：
//   1) 三张大卡（长文 / 图文 / 视频）+ 一句说明，0 基础友好、移动优先。
//   2) 点某张卡 → 调 server action createDraft(form) 新建「未命名草稿」（自动建选题 + 渠道稿）。
//   3) 拿到返回的 { id } 后跳 /studio/compose/[form]/[id] 进创作页接着写。
//
// 【硬约束】本页在 (app) 路由组内，<html>/<body> 已由 (app)/layout.tsx 提供，外壳由
// studio/layout.tsx 提供——这里【绝不】再渲染 <html>/<body> 或顶栏。
//
// 为何 'use client'：建草稿要拿 createDraft 的返回 id 再 router.push（导航依赖返回值），
// 且要有「创建中…」忙态与失败提示——这天然是客户端交互（与 login 页同款 useRouter 模式）。
// createDraft 本身是 'use server'，在 client 里可直接 import 调用（Next server action）。

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { Card, EmptyState, StepHeader } from '../_ui'
import { createDraft } from '../_lib/actions'
import type { ContentForm } from '../_lib/types'
import { colors, fonts, radii, space } from '../_lib/theme'

// 三种创作形式的展示卡定义（顺序：长文 / 图文 / 视频，与设计 §2 表格一致）。
interface FormCardDef {
  form: ContentForm
  icon: string
  title: string
  // 一句话说明：告诉 0 基础运营这种形式发到哪、适合什么。
  desc: string
  // 默认落点的人话提示（与 platforms.ts 的默认映射一致）。
  channelHint: string
}

const FORM_CARDS: FormCardDef[] = [
  {
    form: 'article',
    icon: '📄',
    title: '长文',
    desc: '写一篇图文并茂的文章，所见即所得，一键发到公众号草稿箱。',
    channelHint: '默认发布到 · 微信公众号',
  },
  {
    form: 'imagetext',
    icon: '🖼',
    title: '图文',
    desc: '上传多张图配一段文案，生成发布包，去小红书 / 视频号 / 抖音发布。',
    channelHint: '默认发布到 · 小红书',
  },
  {
    form: 'video',
    icon: '🎬',
    title: '视频',
    desc: '上传一条视频配封面与文案，生成发布包，去抖音 / 视频号发布。',
    channelHint: '默认发布到 · 抖音',
  },
]

export default function CreatePage() {
  const router = useRouter()

  // 正在创建的形式（用于卡片忙态 + 防重复点击）；null 表示空闲。
  const [busyForm, setBusyForm] = useState<ContentForm | null>(null)
  const [error, setError] = useState('')

  async function handlePick(form: ContentForm) {
    if (busyForm) return // 已在创建，忽略重复点击
    setBusyForm(form)
    setError('')
    try {
      const { id } = await createDraft(form)
      // 建好草稿，进创作页接着写。
      // 注意：这里【不要】在 push 后面紧跟 router.refresh()——refresh 会刷新「当前」路由
      // （此刻仍是 /create），与尚未提交的 push 互相打断，导致软导航卡死/反复回弹并重复建草稿
      // （实测会循环创建 101/102/103…）。工作台是动态页（listMyContent 按请求读库），导航
      // 过去时本就会拿到最新草稿，无需 refresh。
      router.push(`/studio/compose/${form}/${id}`)
    } catch (err) {
      // createDraft 抛的是中文 message，直接展示。
      const message = err instanceof Error ? err.message : '创建草稿失败，请稍后再试。'
      setError(message)
      setBusyForm(null)
    }
    // 成功时不复位 busyForm：保持忙态直到路由跳走，避免闪烁/二次点击。
  }

  const anyBusy = busyForm !== null

  return (
    <div>
      {/* 顶部三步进度：选形式仍属「创作」步。 */}
      <StepHeader current="create" />

      {/* ===== 标题区 ===== */}
      <section style={{ marginBottom: space.lg }}>
        <Link
          href="/studio"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 14,
            color: colors.muted,
            textDecoration: 'none',
            marginBottom: space.sm,
          }}
        >
          ← 返回工作台
        </Link>
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
          想创作点什么？
        </h1>
        <p
          style={{
            margin: `${space.xs} 0 0`,
            fontSize: 14.5,
            color: colors.muted,
            lineHeight: 1.6,
          }}
        >
          选一种形式，我们会先帮你建好一份草稿，然后就能直接开写。形式之后也能在发布步骤里调整平台。
        </p>
      </section>

      {/* 失败提示（友好中文，不报错堆栈）。 */}
      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: space.lg,
            padding: `10px ${space.md}`,
            background: colors.fill,
            border: `1px solid ${colors.rose}`,
            borderRadius: radii.md,
            color: colors.rose,
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {error}
        </div>
      ) : null}

      {/* ===== 三张大卡 ===== */}
      <div
        style={{
          display: 'grid',
          // 移动优先：窄屏单列，宽屏自动排成多列。
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: space.md,
        }}
      >
        {FORM_CARDS.map((card) => {
          const isThisBusy = busyForm === card.form
          // 其它卡在创建进行时整体禁用（半透明 + 不可点），避免并发建多份草稿。
          const disabled = anyBusy && !isThisBusy
          return (
            <Card
              key={card.form}
              interactive={!anyBusy}
              onClick={anyBusy ? undefined : () => handlePick(card.form)}
              style={{
                opacity: disabled ? 0.5 : 1,
                cursor: anyBusy ? 'default' : 'pointer',
                minHeight: 196,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* 大图标 */}
              <div style={{ fontSize: 40, lineHeight: 1, marginBottom: space.sm }} aria-hidden>
                {card.icon}
              </div>
              <h2
                style={{
                  margin: `0 0 ${space.xs}`,
                  fontFamily: fonts.serif,
                  fontSize: 20,
                  fontWeight: 700,
                  color: colors.inkStrong,
                  lineHeight: 1.3,
                }}
              >
                {card.title}
              </h2>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: colors.ink,
                  flex: 1,
                }}
              >
                {card.desc}
              </p>
              {/* 底部：默认渠道提示 / 创建中态 */}
              <div
                style={{
                  marginTop: space.md,
                  paddingTop: space.sm,
                  borderTop: `1px solid ${colors.rule}`,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: isThisBusy ? colors.rose : colors.muted,
                  lineHeight: 1.5,
                }}
              >
                {isThisBusy ? '正在创建草稿…' : card.channelHint}
              </div>
            </Card>
          )
        })}
      </div>

      {/* 兜底引导（理论上 FORM_CARDS 必非空，仅作健壮性占位说明）。 */}
      {FORM_CARDS.length === 0 ? (
        <EmptyState title="暂无可用的创作形式" hint="请联系管理员开通创作能力。" />
      ) : null}
    </div>
  )
}
