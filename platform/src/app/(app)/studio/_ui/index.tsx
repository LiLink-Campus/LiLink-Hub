'use client'

// studio/_ui/index.tsx —— 运营内容工作台「微光玫瑰」UI 套件（契约 E）。
//
// 这是 foundation 层的展示组件库，被创作 / 发布 / 审核各功能页共同引用。
// 组件命名与 props 形状是「跨模块契约」，改动需同步所有调用方，务必谨慎。
//
// 设计取向（0 基础 0 门槛）：大圆角、玫瑰主按钮、清晰留白、移动优先、中文文案。
// 所有色值 / 字体 / 圆角 / 间距 / 投影一律取自 _lib/theme.ts（单一真源），不在此散落硬编码 hex。
//
// 为什么整模块 'use client'：
//   - Button 需要 onClick + hover/active 交互态；TextInput/Textarea 需要 focus 态、
//     受控/非受控输入；这些天然是客户端行为。把套件统一标 client 最简单，也不影响
//     在 Server Component（如 studio/layout.tsx）里把它们当普通组件组合渲染——
//     RSC 允许在服务端树里渲染 client 组件。
//   - 纯静态组件（Card / Field / EmptyState / StatusBadge / StepHeader）即便在 client
//     模块里也无副作用，照常 SSR。

import {
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'

import { colors, fonts, radii, space, shadow } from '../_lib/theme'
import type { StudioStatus } from '../_lib/types'

// ============================================================
// Button —— 玫瑰主按钮 / 幽灵次按钮。大圆角、清晰留白、可按下反馈。
// ============================================================

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary：玫瑰实心主操作；ghost：描边次操作。默认 primary。 */
  variant?: 'primary' | 'ghost'
  /** 占满整行（移动端大按钮常用）。 */
  block?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  block = false,
  children,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false)
  const [active, setActive] = useState(false)

  const base: CSSProperties = {
    display: block ? 'block' : 'inline-flex',
    width: block ? '100%' : undefined,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    boxSizing: 'border-box',
    // 大按钮：足够大的点击区，0 基础友好。
    minHeight: 48,
    padding: `12px ${space.lg}`,
    fontFamily: fonts.sans,
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1.2,
    borderRadius: radii.pill,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background-color .15s ease, border-color .15s ease, transform .05s ease, box-shadow .15s ease',
    transform: active && !disabled ? 'translateY(1px)' : 'none',
    textAlign: 'center',
    userSelect: 'none',
  }

  const variantStyle: CSSProperties =
    variant === 'primary'
      ? {
          background: disabled ? colors.rose : hover ? colors.roseHover : colors.rose,
          color: colors.onRose,
          border: '1px solid transparent',
          boxShadow: disabled ? 'none' : shadow.card,
        }
      : {
          background: hover && !disabled ? colors.fill : colors.surface,
          color: colors.rose,
          border: `1px solid ${colors.rule}`,
          boxShadow: 'none',
        }

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setActive(false)
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{ ...base, ...variantStyle, ...style }}
      {...rest}
    >
      {children}
    </button>
  )
}

// ============================================================
// Card —— 白底大圆角卡片，柔和投影。可选点击态（hover 抬升）。
// ============================================================

export interface CardProps {
  children: ReactNode
  /** 可点击（hover 抬升 + 指针），用于列表项 / 选择卡。 */
  interactive?: boolean
  onClick?: () => void
  style?: CSSProperties
  /** 内边距档位，默认 lg。 */
  padding?: keyof typeof space
}

export function Card({ children, interactive = false, onClick, style, padding = 'lg' }: CardProps) {
  const [hover, setHover] = useState(false)

  const cardStyle: CSSProperties = {
    background: colors.surface,
    border: `1px solid ${interactive && hover ? colors.rose : colors.rule}`,
    borderRadius: radii.lg,
    padding: space[padding],
    boxShadow: interactive && hover ? shadow.pop : shadow.card,
    transition: 'box-shadow .15s ease, transform .12s ease, border-color .15s ease',
    transform: interactive && hover ? 'translateY(-2px)' : 'none',
    cursor: interactive ? 'pointer' : 'default',
    boxSizing: 'border-box',
    ...style,
  }

  return (
    <div
      onClick={onClick}
      onMouseEnter={interactive ? () => setHover(true) : undefined}
      onMouseLeave={interactive ? () => setHover(false) : undefined}
      style={cardStyle}
    >
      {children}
    </div>
  )
}

// ============================================================
// StatusBadge —— 协作状态徽标（草稿/审核中/已通过/待发布/已发布）。
// ============================================================

const STATUS_META: Record<StudioStatus, { label: string; fg: string; bg: string }> = {
  draft: { label: '草稿', fg: colors.muted, bg: colors.rule },
  in_review: { label: '审核中', fg: '#9a6a12', bg: '#fdf3df' },
  approved: { label: '已通过', fg: '#2f7d4f', bg: '#e6f4ec' },
  ready_to_publish: { label: '待发布', fg: colors.rose, bg: colors.fill },
  published: { label: '已发布', fg: '#ffffff', bg: colors.rose },
}

export interface StatusBadgeProps {
  status: StudioStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const meta = STATUS_META[status] ?? STATUS_META.draft
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 12px',
        borderRadius: radii.pill,
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.6,
        fontFamily: fonts.sans,
        color: meta.fg,
        background: meta.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  )
}

// ============================================================
// Field —— 表单字段包裹：标签 + 可选说明 + 控件。统一上下节奏。
// ============================================================

export interface FieldProps {
  label: string
  /** 字段下的灰色说明 / 提示（0 基础友好，告诉运营这格填什么）。 */
  hint?: string
  /** 标右侧的「必填」红点等可由调用方放进 label，此处保留简单。 */
  children: ReactNode
  style?: CSSProperties
}

export function Field({ label, hint, children, style }: FieldProps) {
  return (
    <div style={{ marginBottom: space.lg, ...style }}>
      <label
        style={{
          display: 'block',
          marginBottom: space.xs,
          fontSize: 15,
          fontWeight: 600,
          color: colors.inkStrong,
          fontFamily: fonts.sans,
          lineHeight: 1.5,
        }}
      >
        {label}
      </label>
      {hint ? (
        <p
          style={{
            margin: `0 0 ${space.sm}`,
            fontSize: 13,
            lineHeight: 1.6,
            color: colors.muted,
            fontFamily: fonts.sans,
          }}
        >
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  )
}

// ============================================================
// TextInput / Textarea —— 大圆角输入，玫瑰 focus 环。受控/非受控均可。
// ============================================================

const fieldBaseStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: `12px ${space.md}`,
  fontFamily: fonts.sans,
  fontSize: 16, // ≥16px 防 iOS 聚焦缩放
  lineHeight: 1.6,
  color: colors.ink,
  background: colors.surface,
  border: `1px solid ${colors.rule}`,
  borderRadius: radii.md,
  outline: 'none',
  transition: 'border-color .15s ease, box-shadow .15s ease',
}

function focusRing(focused: boolean): CSSProperties {
  return focused
    ? { border: `1px solid ${colors.rose}`, boxShadow: `0 0 0 3px ${colors.fill}` }
    : {}
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>

export function TextInput({ style, onFocus, onBlur, ...rest }: TextInputProps) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      {...rest}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      style={{ ...fieldBaseStyle, ...focusRing(focused), ...style }}
    />
  )
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ style, onFocus, onBlur, rows = 4, ...rest }: TextareaProps) {
  const [focused, setFocused] = useState(false)
  return (
    <textarea
      {...rest}
      rows={rows}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      style={{
        ...fieldBaseStyle,
        resize: 'vertical',
        minHeight: 96,
        lineHeight: 1.8,
        ...focusRing(focused),
        ...style,
      }}
    />
  )
}

// ============================================================
// EmptyState —— 空状态：标题 + 指引 + 可选主操作。给 0 基础运营下一步指引。
// ============================================================

export interface EmptyStateProps {
  title: string
  hint: string
  /** 可选的主操作（通常是一个 <Button>）。 */
  action?: ReactNode
  /** 可选的装饰图标 / emoji（如「✎」）。 */
  icon?: ReactNode
}

export function EmptyState({ title, hint, action, icon }: EmptyStateProps) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: `${space.xl} ${space.lg}`,
        background: colors.fill,
        border: `1px dashed ${colors.rule}`,
        borderRadius: radii.lg,
        fontFamily: fonts.sans,
      }}
    >
      {icon ? (
        <div style={{ fontSize: 36, lineHeight: 1, marginBottom: space.md }} aria-hidden>
          {icon}
        </div>
      ) : null}
      <h3
        style={{
          margin: `0 0 ${space.sm}`,
          fontSize: 18,
          fontWeight: 700,
          color: colors.inkStrong,
          fontFamily: fonts.serif, // 标题宋体
          lineHeight: 1.4,
        }}
      >
        {title}
      </h3>
      <p
        style={{
          margin: `0 auto ${action ? space.lg : '0'}`,
          maxWidth: 360,
          fontSize: 14.5,
          lineHeight: 1.7,
          color: colors.muted,
        }}
      >
        {hint}
      </p>
      {action ? <div style={{ display: 'flex', justifyContent: 'center' }}>{action}</div> : null}
    </div>
  )
}

// ============================================================
// StepHeader —— 顶部「创作 ▸ 发布 ▸ 审核」三步进度。current 高亮当前步。
// ============================================================

const STEPS: { key: 'create' | 'publish' | 'review'; label: string }[] = [
  { key: 'create', label: '创作' },
  { key: 'publish', label: '发布' },
  { key: 'review', label: '审核' },
]

export interface StepHeaderProps {
  current: 'create' | 'publish' | 'review'
}

export function StepHeader({ current }: StepHeaderProps) {
  const currentIdx = STEPS.findIndex((s) => s.key === current)

  return (
    <nav
      aria-label="流程进度"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: space.xs,
        padding: `${space.sm} ${space.md}`,
        marginBottom: space.lg,
        fontFamily: fonts.sans,
      }}
    >
      {STEPS.map((stepItem, idx) => {
        const done = idx < currentIdx
        const isCurrent = idx === currentIdx
        const reached = idx <= currentIdx

        return (
          <span key={stepItem.key} style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                borderRadius: radii.pill,
                fontSize: 14,
                fontWeight: isCurrent ? 700 : 500,
                color: reached ? colors.onRose : colors.muted,
                background: isCurrent ? colors.rose : done ? colors.roseHover : colors.rule,
                opacity: reached ? 1 : 0.85,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  borderRadius: radii.pill,
                  fontSize: 12,
                  fontWeight: 700,
                  color: reached ? colors.rose : colors.surface,
                  background: reached ? colors.surface : colors.muted,
                }}
              >
                {done ? '✓' : idx + 1}
              </span>
              {stepItem.label}
            </span>
            {idx < STEPS.length - 1 ? (
              <span aria-hidden style={{ color: colors.muted, fontSize: 14, padding: '0 2px' }}>
                ▸
              </span>
            ) : null}
          </span>
        )
      })}
    </nav>
  )
}
