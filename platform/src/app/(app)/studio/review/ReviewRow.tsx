'use client'

// studio/review/ReviewRow.tsx —— 审核队列单条卡片 + 交互（client）。
//
// 一条渠道稿一张卡片。展示：标题 / 形式 / 平台 / 状态徽标 / 更新时间 / 当前处理人；
// 预览区按形态分流：长文给「预览（新标签）」链接；图文/视频在 ready_to_publish 后展示发布包。
//
// 操作按状态分流（与状态机 src/workflow/states.ts 一致）：
//   - in_review：        「通过」(approve) · 「打回」(reject，先展开输入框填原因)
//   - approved：
//        · 长文（article）→「发布到公众号草稿箱」(publish → published，发完离开队列)
//        · 图文/视频     →「生成发布包」(publish → ready_to_publish，留在队列并展示发布包)
//   - ready_to_publish：「标记已发布」(markPublished → published，发完离开队列)
//
// 所有写操作走 review/actions.ts 的 *AndRefresh：服务端做完即返回「刷新后的整张队列」，
// 通过 onRefreshed 回传给列表整体替换（见 ReviewList）。本组件维护：提交中(pending)、
// 行内错误(error)、操作成功提示(notice)、打回输入框开合与原因文本。

import { useState, useTransition } from 'react'

import { Button, Card, StatusBadge, Field, Textarea } from '../_ui/index'
import { colors, fonts, radii, space } from '../_lib/theme'
import type { ReviewItemDetail } from './_detail'
import { formLabel } from './_detail'
import { PackageView } from './PackageView'
import {
  approveAndRefresh,
  rejectAndRefresh,
  publishAndRefresh,
  markPublishedAndRefresh,
} from './actions'

export interface ReviewRowProps {
  item: ReviewItemDetail
  /** 操作成功后回传「刷新后的整张队列」，由列表整体替换。 */
  onRefreshed: (items: ReviewItemDetail[]) => void
}

/** 把 ISO 时间转成「YYYY-MM-DD HH:mm」本地展示（失败回原串）。 */
function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 解读发布端点返回，给一句友好的成功提示。 */
function publishNotice(result: unknown): string {
  const r = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
  const stage = typeof r.stage === 'string' ? r.stage : ''
  const idempotent = r.idempotent === true
  if (stage === 'draft_created') {
    return idempotent
      ? '公众号草稿此前已建好，已确认并标记为已发布。'
      : '已在公众号草稿箱建好草稿，请到公众号后台群发。'
  }
  if (stage === 'manual_ready') {
    return idempotent
      ? '发布包此前已生成，下方为最新发布包要点。'
      : '已生成发布包，请按下方要点到对应平台人工发布，发完点「标记已发布」。'
  }
  return '操作已完成。'
}

export function ReviewRow({ item, onRefreshed }: ReviewRowProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')

  // 统一跑一个会刷新队列的动作：清旧提示 → pending 包裹 → 成功回传新列表 / 失败展示中文错误。
  const run = (
    fn: () => Promise<ReviewItemDetail[]>,
    onSuccess?: () => void,
  ) => {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      try {
        const next = await fn()
        onSuccess?.()
        // 注意：onRefreshed 会用新列表替换、本行可能因状态改变而被卸载——
        // 故任何「成功后还要 setState 本行」的逻辑都应在 onRefreshed 之前做（见各 handler）。
        onRefreshed(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const onApprove = () => run(() => approveAndRefresh(item.id))

  const onReject = () => {
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('请填写打回原因，方便作者修改。')
      return
    }
    run(() => rejectAndRefresh(item.id, trimmed))
  }

  const onPublish = () => {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      try {
        const { result, items } = await publishAndRefresh(item.id)
        // 发布留在队列的情况（图文/视频→ready_to_publish）下，本行不会卸载，先设提示再替换列表。
        setNotice(publishNotice(result))
        onRefreshed(items)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const onMarkPublished = () => run(() => markPublishedAndRefresh(item.id))

  // 发布按钮文案 / 提示：长文是建公众号草稿，图文/视频是生成发布包。
  const isArticle = item.form === 'article'
  const publishLabel = isArticle ? '发布到公众号草稿箱' : '生成发布包'

  return (
    <Card>
      {/* ===== 头部：标题 + 状态徽标 ===== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: space.md,
          marginBottom: space.sm,
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
            wordBreak: 'break-word',
            minWidth: 0,
          }}
        >
          {item.title}
        </h2>
        <div style={{ flexShrink: 0 }}>
          <StatusBadge status={item.status} />
        </div>
      </div>

      {/* ===== 元信息：形式 · 平台 · 处理人 · 更新时间 ===== */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: space.sm,
          fontSize: 13,
          color: colors.muted,
          marginBottom: space.md,
        }}
      >
        <span
          style={{
            fontWeight: 600,
            color: colors.ink,
            background: colors.fill,
            border: `1px solid ${colors.rule}`,
            borderRadius: radii.pill,
            padding: '2px 10px',
          }}
        >
          {formLabel(item.form)}
        </span>
        <span>平台：{item.platformLabel}</span>
        {item.assigneeName ? <span>· 处理人：{item.assigneeName}</span> : null}
        <span>· 更新于 {formatTime(item.updatedAt)}</span>
      </div>

      {/* ===== 预览区 ===== */}
      {item.previewHref ? (
        // 长文：链到预览页（新标签），所见即所发。
        <div style={{ marginBottom: space.md }}>
          <a
            href={item.previewHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 14,
              fontWeight: 600,
              color: colors.rose,
              textDecoration: 'none',
              padding: `6px ${space.md}`,
              border: `1px solid ${colors.rule}`,
              borderRadius: radii.pill,
              background: colors.fill,
            }}
          >
            预览全文（新标签）↗
          </a>
        </div>
      ) : item.manualPackage ? (
        // 图文/视频且已生成发布包：展示要点。
        <div style={{ marginBottom: space.md }}>
          <PackageView pkg={item.manualPackage} />
        </div>
      ) : (
        // 图文/视频但还没生成发布包（仍在 in_review / approved 未发）：给一句说明。
        <p
          style={{
            margin: `0 0 ${space.md}`,
            fontSize: 13.5,
            lineHeight: 1.6,
            color: colors.muted,
            background: colors.fill,
            border: `1px dashed ${colors.rule}`,
            borderRadius: radii.sm,
            padding: `8px ${space.sm}`,
          }}
        >
          {item.status === 'approved'
            ? '该图文/视频尚未生成发布包，点下方「生成发布包」后会在此展示要点。'
            : '图文/视频内容的发布包会在审核通过并生成后，在此展示要点。'}
        </p>
      )}

      {/* ===== 上次发布残留错误（如有） ===== */}
      {item.lastError ? (
        <p
          style={{
            margin: `0 0 ${space.md}`,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: '#9a6a12',
            background: '#fdf3df',
            border: '1px solid #f0e2bf',
            borderRadius: radii.sm,
            padding: `6px ${space.sm}`,
          }}
        >
          上次发布提示：{item.lastError}
        </p>
      ) : null}

      {/* ===== 打回输入框（in_review 且点了「打回」后展开） ===== */}
      {rejectOpen ? (
        <div
          style={{
            marginBottom: space.md,
            padding: space.md,
            background: colors.fill,
            border: `1px solid ${colors.rule}`,
            borderRadius: radii.md,
          }}
        >
          <Field
            label="打回原因"
            hint="告诉作者哪里需要改（必填）。提交后这篇会退回草稿，作者可修改再次送审。"
            style={{ marginBottom: space.sm }}
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：开头结论先行；第 2 段数据需要来源；配图换更清晰的一张。"
              rows={3}
              disabled={isPending}
              autoFocus
            />
          </Field>
          <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={onReject} disabled={isPending}>
              {isPending ? '提交中…' : '确认打回'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRejectOpen(false)
                setReason('')
                setError(null)
              }}
              disabled={isPending}
            >
              取消
            </Button>
          </div>
        </div>
      ) : null}

      {/* ===== 错误 / 成功提示 ===== */}
      {error ? (
        <p
          style={{
            margin: `0 0 ${space.md}`,
            fontSize: 13,
            lineHeight: 1.6,
            color: '#b3261e',
            background: '#fdeceb',
            border: '1px solid #f5c6c2',
            borderRadius: radii.sm,
            padding: `8px ${space.sm}`,
          }}
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          style={{
            margin: `0 0 ${space.md}`,
            fontSize: 13,
            lineHeight: 1.6,
            color: '#2f7d4f',
            background: '#e6f4ec',
            border: '1px solid #bfe3cd',
            borderRadius: radii.sm,
            padding: `8px ${space.sm}`,
          }}
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {/* ===== 操作按钮（按状态分流） ===== */}
      <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
        {item.status === 'in_review' ? (
          <>
            <Button variant="primary" onClick={onApprove} disabled={isPending || rejectOpen}>
              {isPending ? '处理中…' : '通过'}
            </Button>
            {!rejectOpen ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setRejectOpen(true)
                  setError(null)
                  setNotice(null)
                }}
                disabled={isPending}
              >
                打回
              </Button>
            ) : null}
          </>
        ) : null}

        {item.status === 'approved' ? (
          <Button variant="primary" onClick={onPublish} disabled={isPending}>
            {isPending ? '处理中…' : publishLabel}
          </Button>
        ) : null}

        {item.status === 'ready_to_publish' ? (
          <Button variant="primary" onClick={onMarkPublished} disabled={isPending}>
            {isPending ? '处理中…' : '标记已发布'}
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
