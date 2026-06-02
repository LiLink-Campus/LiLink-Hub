// studio/review/page.tsx —— 审核队列页（Server Component，App Router）。
//
// 任务（功能页·审核队列）：
//   - 用 listReviewQueue() 跨运营列出 in_review / approved / ready_to_publish 各条；
//     每条展示 标题 / 形式 / 平台 / 状态 / 更新时间 + 预览：
//       · 长文 → 链到 /preview/channel-contents/[id]（新标签，所见即所发）；
//       · 图文/视频 → 展示发布包要点（标题/正文/话题/素材/校验提示）。
//   - 操作：
//       · in_review → 通过(approve) / 打回(reject，弹框填原因)；
//       · approved → 长文「发布到公众号草稿箱」(publish → published)；
//                    图文/视频「生成发布包」(publish → ready_to_publish) 并展示发布包；
//       · ready_to_publish → 展示发布包 + 「标记已发布」(markPublished → published)。
//   - 操作后刷新列表（本页的 review/actions.ts 里 revalidatePath + 重新拉详情）。
//
// 实现：本页在服务端把队列详情拉好（fetchReviewDetails，含每条完整文档要点），
// 交给 client 组件 ReviewList 渲染与交互；后续操作由 ReviewList 调用 review/actions.ts，
// 用返回的新列表就地替换（不整页刷新，保住其它行已展开/未提交的输入）。
//
// 【硬约束】本页在 (app) 路由组、且嵌在 studio/layout.tsx 内，<html>/<body> 已由
// (app)/layout.tsx 提供——这里【绝不】再渲染 <html>/<body>。鉴权由 studio/layout.tsx 的
// requireUser() 统一兜底，未登录会先被它跳到 /login。

import { StepHeader } from '../_ui/index'
import { colors, fonts, space } from '../_lib/theme'
import { fetchReviewDetails } from './actions'
import { ReviewList } from './ReviewList'

// 队列跨运营、随时在变，禁用静态化，每次进页面取最新。
export const dynamic = 'force-dynamic'

export default async function ReviewQueuePage() {
  const items = await fetchReviewDetails()

  return (
    <div>
      <StepHeader current="review" />

      {/* 页头：标题 + 一句话说明这页在干嘛（0 基础友好） */}
      <header style={{ marginBottom: space.lg }}>
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
          审核队列
        </h1>
        <p
          style={{
            margin: `${space.xs} 0 0`,
            fontSize: 14.5,
            lineHeight: 1.7,
            color: colors.muted,
            maxWidth: 560,
          }}
        >
          在 LiLink，你既是创作者也是审核者——你和同伴提交的稿件都汇总到这里，由你「通过」或「打回」；通过后长文一键建公众号草稿、图文 / 视频生成发布包，再人工确认已发。
        </p>
      </header>

      {/* 列表 + 交互（client）。空状态也在其内处理，方便操作后刷新到空时切换。 */}
      <ReviewList initialItems={items} />
    </div>
  )
}
