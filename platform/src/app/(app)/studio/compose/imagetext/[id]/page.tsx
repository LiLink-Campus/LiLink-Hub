'use client'

// studio/compose/imagetext/[id]/page.tsx —— 图文（小红书 / 视频号 / 抖音 笔记）创作页（薄壳）。
//
// 设计依据「创作 ▸ 发布 ▸ 审核」三步流程的第一步「创作」（StepHeader current='create'）。
// 本页极简：只负责
//   1. 用 React 的 use() 解包 Next 16 的 Promise params 取出渠道稿 id；
//   2. 渲染顶部三步进度 <StepHeader current="create" />；
//   3. 把编辑全权交给 <NoteEditor contentId={id} />——小红书式图文笔记编辑器（容器）。
//
// 所有编辑态（图组上传 / 排序 / 标题 / 正文 #话题联想 / 右侧手机卡片预览）、加载 / 保存编排、
// 顶部「编辑图文笔记」标题与说明，以及加载 / 错误兜底，都内聚在 NoteEditor 里；
// 旧版散在本页的表单态 / 上传 / 排序 / ImageThumb 已全部移进 NoteEditor，故这里不再保留。
//
// 为什么整页 'use client'：NoteEditor 是 client 组件（多图上传 / 拖拽 / 富文本编辑 / 实时预览
//   都是天然浏览器交互）；params 在 Next 16 是 Promise，client 组件用 React 的 use() 解包
//   （见 node_modules/next/dist/docs 的 page 指南）。
//
// 【硬约束】本页在 (app) 路由组内，<html>/<body> 由 (app)/layout.tsx 提供——这里【绝不】
//   再渲染 <html>/<body>，只返回内容容器（否则嵌套 <html> 触发 hydration 错乱）。

import { use } from 'react'

import { StepHeader } from '../../../_ui'
import { ComposeHintBar } from '../../../ComposeHintBar'

import { NoteEditor } from './NoteEditor'

export default function ImagetextComposePage({
  params,
}: {
  // Next 16：params 是 Promise，client 组件用 use() 解包（见 next docs page.md）。
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  return (
    <div>
      <StepHeader current="create" />
      <ComposeHintBar />
      <NoteEditor contentId={id} />
    </div>
  )
}
