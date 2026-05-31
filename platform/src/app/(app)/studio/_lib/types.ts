// studio/_lib/types.ts —— 运营内容工作台的共享类型契约。
//
// 这是 foundation 层，被各功能页（创作 / 发布 / 审核）与 _ui 组件共同引用。
// 命名与签名是「跨模块契约」，改动需同步所有调用方，务必谨慎。
//
// 说明：
// - ContentForm 是「面向运营的内容形态」（一篇文章 / 一条图文 / 一条视频），
//   它决定默认落到哪个平台（见 _lib/platforms.ts 的 formToPlatformDefault）。
//   注意它不是底层 platform 字段本身——一个 form 可对应多个手动平台。
// - StudioStatus 与 src/workflow/states.ts 的 Status 一一对应（同样 5 态），
//   这里单独声明一份是为了让 studio 前端不必从 workflow 纯逻辑层导入，
//   保持前端契约自包含；两者取值必须保持一致。

/** 面向运营的内容形态：文章（长文）/ 图文笔记 / 视频。 */
export type ContentForm = 'article' | 'imagetext' | 'video'

/**
 * 渠道稿协作状态（与 src/workflow/states.ts 的 Status 取值一致）：
 * 草稿 → 待审核 → 已批准 →（人工平台）待人工发布 → 已发布。
 */
export type StudioStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'ready_to_publish'
  | 'published'

/**
 * 列表卡片所需的渠道稿摘要（「我的内容」「审核队列」列表用）。
 * 只取展示必需的最小字段，避免把整份文档塞进列表。
 */
export interface StudioContentSummary {
  /** 渠道稿 id（channel-contents 一条记录）。 */
  id: string
  /** 列表标题（公众号取 wxTitle / 手动平台取 socialTitle / 兜底取选题名）。 */
  title: string
  /** 内容形态（由 platform + contentMode 反推）。 */
  form: ContentForm
  /** 底层平台 code（wechat / xiaohongshu / douyin / weixin_channels …）。 */
  platform: string
  /** 协作状态。 */
  status: StudioStatus
  /** 最近更新时间（ISO 字符串）。 */
  updatedAt: string
}
