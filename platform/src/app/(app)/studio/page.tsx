// studio/page.tsx —— 工作台「我的内容」（Server Component）。
//
// 设计依据 §3「/studio：我的内容（按状态分组：草稿/审核中/已通过/已发布）+「开始创作 ✎」」
// 与 §13 里程碑 1。流程：
//   1) listMyContent() 拉当前运营名下全部渠道稿（已按 -updatedAt 倒序；未登录/出错安全返回 []）。
//   2) 按协作状态分组（草稿 / 审核中 / 待发布 / 已发布）。
//   3) 每条用卡片 + 状态徽标展示；点卡片按状态跳转：
//        - 草稿（draft）          → /studio/compose/[form]/[id]（回到创作页接着写）
//        - 其余（审核中/通过/待发布/已发布）→ /studio/publish/[id]（发布配置 / 只读查看）
//   4) 顶部醒目「开始创作 ✎」跳 /studio/create；整体无内容时给空状态指引。
//
// 【硬约束】本页在 (app) 路由组内，<html>/<body> 已由 (app)/layout.tsx 提供，
// 顶栏/外壳由 studio/layout.tsx 提供——这里【绝不】再渲染 <html>/<body> 或重复顶栏。
//
// 实现要点：本页是 Server Component（需服务端读会话 + 调 server action），不在此用 onClick。
// 卡片点击跳转用 next/link 的 <Link> 包裹 _ui 的 <Card>——既得到导航，又复用 Card 的
// 微光玫瑰悬浮态（_ui 整模块 'use client'，在 RSC 树里照常渲染）。不额外新建组件文件。

import Link from 'next/link'

import { Card, EmptyState, StatusBadge, StepHeader } from './_ui'
import { DeleteButton } from './DeleteButton'
import { WelcomeGuide } from './WelcomeGuide'
import { listMyContent } from './_lib/actions'
import type { ContentForm, StudioContentSummary, StudioStatus } from './_lib/types'
import { colors, fonts, radii, space, shadow } from './_lib/theme'

// 服务端组件读会话 cookie，必须每次动态渲染（与 layout 的 force-dynamic 一致）。
export const dynamic = 'force-dynamic'

// ---------- 分组定义 ----------
// 把 5 态收敛成 4 个面向运营更直观的分组：已通过(approved) 与 待发布(ready_to_publish)
// 合并成「待发布」——对运营而言都是「审过了、等着发」的下一步，放一起更省心。
type GroupKey = 'draft' | 'in_review' | 'to_publish' | 'published'

interface GroupDef {
  key: GroupKey
  title: string
  statuses: StudioStatus[]
  hint: string
}

const GROUPS: GroupDef[] = [
  { key: 'draft', title: '草稿', statuses: ['draft'], hint: '还在写、未提交审核的内容。' },
  { key: 'in_review', title: '审核中', statuses: ['in_review'], hint: '已提交、等待审核的内容。' },
  {
    key: 'to_publish',
    title: '待发布',
    statuses: ['approved', 'ready_to_publish'],
    hint: '审核通过、等待发布的内容。',
  },
  { key: 'published', title: '已发布', statuses: ['published'], hint: '已经发出去的内容。' },
]

// ---------- 展示辅助 ----------

const FORM_LABEL: Record<ContentForm, string> = {
  article: '长文',
  imagetext: '图文',
  video: '视频',
}

const FORM_ICON: Record<ContentForm, string> = {
  article: '📄',
  imagetext: '🖼',
  video: '🎬',
}

// 点卡片去哪：草稿回创作页接着写，其余去发布/查看页。
function hrefFor(item: StudioContentSummary): string {
  if (item.status === 'draft') {
    return `/studio/compose/${item.form}/${item.id}`
  }
  return `/studio/publish/${item.id}`
}

// 相对时间（简单友好，不引第三方库）。
function relativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  // 超过一个月直接给日期。
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 单张内容卡（Link 包 Card，得到导航 + 悬浮态）。
function ContentItemCard({ item }: { item: StudioContentSummary }) {
  return (
    <Card padding="md">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: space.md,
        }}
      >
        {/* 跳转区：只包标题 + 元信息（删除按钮在 Link 之外，避免 a 内嵌 button 非法结构 / 误触发跳转）。 */}
        <Link
          href={hrefFor(item)}
          style={{ textDecoration: 'none', color: 'inherit', display: 'block', minWidth: 0, flex: 1 }}
        >
          <div
            style={{
              fontFamily: fonts.serif,
              fontSize: 17,
              fontWeight: 700,
              color: colors.inkStrong,
              lineHeight: 1.4,
              // 标题最多两行，超出省略。
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          >
            {item.title}
          </div>
          <div
            style={{
              marginTop: space.xs,
              fontSize: 13,
              color: colors.muted,
              lineHeight: 1.6,
              display: 'flex',
              alignItems: 'center',
              gap: space.sm,
              flexWrap: 'wrap',
            }}
          >
            <span aria-hidden>{FORM_ICON[item.form]}</span>
            <span>{FORM_LABEL[item.form]}</span>
            <span aria-hidden style={{ color: colors.rule }}>
              ·
            </span>
            <span>{relativeTime(item.updatedAt)}</span>
          </div>
        </Link>

        {/* 右侧：状态徽标 + 删除（删除是独立客户端按钮，不随卡片跳转）。 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: space.sm,
            flexShrink: 0,
          }}
        >
          <StatusBadge status={item.status} />
          <DeleteButton id={item.id} title={item.title} />
        </div>
      </div>
    </Card>
  )
}

export default async function StudioHomePage() {
  // 当前运营名下全部渠道稿（已按更新时间倒序；未登录/出错返回 []，页面据空状态引导）。
  const items: StudioContentSummary[] = await listMyContent()

  // 按分组归位（保持各组内 -updatedAt 顺序，沿用 listMyContent 的排序）。
  const grouped = new Map<GroupKey, StudioContentSummary[]>()
  for (const g of GROUPS) grouped.set(g.key, [])
  for (const item of items) {
    const def = GROUPS.find((g) => g.statuses.includes(item.status))
    if (def) grouped.get(def.key)!.push(item)
  }

  const total = items.length

  return (
    <div>
      {/* 顶部三步进度：工作台属「创作」起点。 */}
      <StepHeader current="create" />

      {/* 一次性新手引导卡（可关闭、记 localStorage；未关闭时显示） */}
      <WelcomeGuide />

      {/* ===== 标题区 + 开始创作 ===== */}
      <section
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: space.md,
          flexWrap: 'wrap',
          marginBottom: space.lg,
        }}
      >
        <div>
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
            我的内容
          </h1>
          <p
            style={{
              margin: `${space.xs} 0 0`,
              fontSize: 14.5,
              color: colors.muted,
              lineHeight: 1.6,
            }}
          >
            {total > 0 ? `共 ${total} 篇 · 选一篇接着改，或开始新的创作` : '这里会列出你创作的全部内容'}
          </p>
        </div>

        {/* 开始创作 ✎ —— 醒目玫瑰主操作（Link 套主按钮样式，Server Component 不用 onClick）。 */}
        <Link
          href="/studio/create"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.xs,
            minHeight: 48,
            padding: `12px ${space.lg}`,
            fontFamily: fonts.sans,
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1.2,
            color: colors.onRose,
            background: colors.rose,
            border: '1px solid transparent',
            borderRadius: radii.pill,
            boxShadow: shadow.card,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          开始创作 ✎
        </Link>
      </section>

      {/* ===== 内容分组 / 空状态 ===== */}
      {total === 0 ? (
        <EmptyState
          icon="✎"
          title="还没有任何内容"
          hint="点「开始创作」选一种形式（长文 / 图文 / 视频）就能开写，改动自动存草稿；写好后去发布页选平台、补信息、提交审核，通过后长文一键发公众号草稿、图文 / 视频生成发布包。"
          action={
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: space.sm,
              }}
            >
              <Link
                href="/studio/create"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: space.xs,
                  minHeight: 48,
                  padding: `12px ${space.lg}`,
                  fontFamily: fonts.sans,
                  fontSize: 16,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  color: colors.onRose,
                  background: colors.rose,
                  border: '1px solid transparent',
                  borderRadius: radii.pill,
                  boxShadow: shadow.card,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                开始创作 ✎
              </Link>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: colors.muted,
                }}
              >
                不确定选哪种？长文 = 公众号文章，图文 = 小红书等，视频 = 抖音 / 视频号
              </p>
            </div>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.xl }}>
          {GROUPS.map((g) => {
            const groupItems = grouped.get(g.key) ?? []
            // 空分组直接跳过（草稿组也跳过——整页非空时无需空草稿占位，保持简洁）。
            if (groupItems.length === 0) return null
            return (
              <section key={g.key}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: space.sm,
                    marginBottom: space.md,
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      fontFamily: fonts.serif,
                      fontSize: 18,
                      fontWeight: 700,
                      color: colors.inkStrong,
                      lineHeight: 1.4,
                    }}
                  >
                    {g.title}
                  </h2>
                  <span style={{ fontSize: 13, color: colors.muted }}>{groupItems.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
                  {groupItems.map((item) => (
                    <ContentItemCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
