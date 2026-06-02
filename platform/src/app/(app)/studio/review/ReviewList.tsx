'use client'

// studio/review/ReviewList.tsx —— 审核队列列表（client，持有队列状态）。
//
// 职责：
//   - 用服务端预取的 initialItems 初始化队列状态；
//   - 渲染每条 ReviewRow；
//   - 任一行操作成功后，会回传「刷新后的完整队列」，本组件就地替换 state（不整页刷新，
//     保住其它行已展开的发布包 / 未提交的打回原因输入）；
//   - 队列为空时显示 EmptyState 指引。
//
// 为什么状态放这里而不是各行自管：通过/打回/发布都会改变「整张队列」（条目可能离开队列），
// 所以由列表统一持有数组、各行只负责触发与展示，刷新后用新数组整体替换最稳妥。

import { useState, useTransition } from 'react'

import { EmptyState } from '../_ui/index'
import { space } from '../_lib/theme'
import type { ReviewItemDetail } from './_detail'
import { ReviewRow } from './ReviewRow'

export interface ReviewListProps {
  initialItems: ReviewItemDetail[]
}

export function ReviewList({ initialItems }: ReviewListProps) {
  const [items, setItems] = useState<ReviewItemDetail[]>(initialItems)
  // 全局过渡态：任一行正在提交时，避免并发操作互相打架（行内按钮各自也会禁用）。
  const [isPending, startTransition] = useTransition()

  // 行操作成功后回调：用服务端返回的最新队列整体替换。
  const replaceItems = (next: ReviewItemDetail[]) => {
    startTransition(() => setItems(next))
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="✓"
        title="暂无待审核的内容"
        hint="这是三步里的最后一步——你和同伴把内容提交审核后，会到这里等你「通过」并发布。现在队列是空的，去「工作台」创作并提交一篇试试。"
      />
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: space.md,
        // 队列刷新过渡时整体轻微降透明度，给「正在更新」的反馈。
        opacity: isPending ? 0.7 : 1,
        transition: 'opacity .15s ease',
      }}
    >
      {items.map((item) => (
        <ReviewRow key={item.id} item={item} onRefreshed={replaceItems} />
      ))}
    </div>
  )
}
