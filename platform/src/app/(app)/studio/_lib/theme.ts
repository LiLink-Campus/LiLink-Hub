// studio/_lib/theme.ts —— 「微光玫瑰」视觉令牌（工作台前端单一来源）。
//
// 色值取自 src/lib/wechat-theme.ts（公众号产物令牌的同一真源），这里重新导出成
// 工作台前端友好的语义名，避免各功能页散落硬编码 hex。改色优先改这里 / wechat-theme.ts。
//
// 字体：标题宋体（衬线），正文无衬线——与公众号产物一致，强化「所见即所发」的统一感。

import { ROSE, ROSE_HOVER, INK, INK_STRONG, MUTED, FILL, RULE, SANS, SERIF } from '@/lib/wechat-theme'

/** 微光玫瑰主题色板（语义名 → 字面 hex/rgba）。 */
export const colors = {
  /** 玫瑰强调：主按钮 / 链接 / 选中态 / 进度高亮。 */
  rose: ROSE, // #c2706c
  /** 玫瑰悬停（主按钮 hover）。 */
  roseHover: ROSE_HOVER, // #b3635f
  /** 正文墨灰（暖灰，非纯黑，护眼）。 */
  ink: INK, // #4a4340
  /** 深墨（标题 / 重点）。 */
  inkStrong: INK_STRONG, // #342d2b
  /** 次要文字（说明 / 占位 / 元信息）。 */
  muted: MUTED, // #8a7f7a
  /** 极淡玫瑰底（卡片悬浮 / 选中底 / 提示区）。 */
  fill: FILL, // #fdf6f5
  /** 分隔线 / 边框。 */
  rule: RULE, // #ece2e0
  /** 页面底色（比 fill 更中性的纸白；微光玫瑰留白）。 */
  page: '#fffaf9',
  /** 卡片 / 输入框白底。 */
  surface: '#ffffff',
  /** 反白文字（玫瑰按钮上的字）。 */
  onRose: '#ffffff',
} as const

/** 字体族常量（与公众号产物一致）。 */
export const fonts = {
  /** 正文无衬线。 */
  sans: SANS,
  /** 标题宋体衬线。 */
  serif: SERIF,
} as const

/** 圆角令牌（0 基础友好：大圆角更柔和）。 */
export const radii = {
  sm: '8px',
  md: '12px',
  lg: '16px',
  pill: '999px',
} as const

/** 间距令牌（移动优先，留白克制）。 */
export const space = {
  xs: '6px',
  sm: '10px',
  md: '16px',
  lg: '24px',
  xl: '32px',
} as const

/** 柔和投影（卡片 / 浮层）。 */
export const shadow = {
  card: '0 1px 3px rgba(52,45,43,0.06), 0 4px 16px rgba(194,112,108,0.06)',
  pop: '0 6px 24px rgba(52,45,43,0.12)',
} as const

export type ThemeColorKey = keyof typeof colors
