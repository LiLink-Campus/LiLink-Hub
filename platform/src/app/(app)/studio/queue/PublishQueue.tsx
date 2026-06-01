'use client'

// studio/queue/PublishQueue.tsx —— 发布队列交互（客户端，自包含样式，不依赖 _ui，避免其 props 约束）。
// 每条稿：标题/平台/形态 + 上次浏览器发布结果徽章 + 「一键发布(本机) 或 复制命令」/ 刷新 / 标记已发布。
// 一键发布触发后轮询结果；status→已发布 仍人工点（防误判已发）。

import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties } from 'react'

import { colors, radii, space, shadow } from '../_lib/theme'
import { markPublished } from '../_lib/actions'
import { refreshBrowserResult, triggerBrowserPublish, type BrowserResultView } from './actions'

export interface QueueItem {
  id: string
  title: string
  platform: string
  platformLabel: string
  mode: string
  runCmd: string
  browserPublish: BrowserResultView | null
}

const STAGE_META: Record<string, { label: string; color: string; bg: string }> = {
  staged: { label: '已填好·待人工点发布', color: '#8a5a00', bg: '#fdf3e0' },
  published: { label: '已发布', color: '#1f7a3d', bg: '#e7f6ec' },
  failed: { label: '失败', color: '#9a2f2f', bg: '#fdeced' },
}

const cardStyle: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.rule}`,
  borderRadius: radii.lg,
  padding: space.lg,
  boxShadow: shadow.card,
}

function btnStyle(variant: 'primary' | 'ghost', disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `0 ${space.lg}`,
    minHeight: 38,
    borderRadius: radii.md,
    border: variant === 'ghost' ? `1px solid ${colors.rule}` : '1px solid transparent',
    background: variant === 'primary' ? colors.rose : 'transparent',
    color: variant === 'primary' ? '#fff' : colors.ink,
    fontSize: 14.5,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    boxSizing: 'border-box',
  }
}

function StageBadge({ stage }: { stage?: string }) {
  const m = (stage && STAGE_META[stage]) || { label: '未发起', color: colors.muted, bg: colors.fill }
  return (
    <span
      style={{
        padding: '2px 10px',
        borderRadius: radii.pill,
        fontSize: 12.5,
        fontWeight: 600,
        color: m.color,
        background: m.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {m.label}
    </span>
  )
}

export function PublishQueue({ items, workerLocal }: { items: QueueItem[]; workerLocal: boolean }) {
  if (items.length === 0) {
    return (
      <div style={cardStyle}>
        <p style={{ margin: 0, color: colors.muted, fontSize: 14.5, lineHeight: 1.7 }}>
          暂无待发布内容。审核通过的图文 / 视频会出现在这里。
        </p>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      {items.map((it) => (
        <QueueRow key={it.id} item={it} workerLocal={workerLocal} />
      ))}
    </div>
  )
}

function QueueRow({ item, workerLocal }: { item: QueueItem; workerLocal: boolean }) {
  const [bp, setBp] = useState<BrowserResultView | null>(item.browserPublish)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState('')
  const [polling, setPolling] = useState(false)
  const [busy, startBusy] = useTransition()

  // 组件卸载后停止轮询：避免卸载后仍 setState / 继续打 server action（最多 12×3s）。
  // mount 时重置 false（兼容 React Strict Mode dev 下 mount→unmount→remount 双调用）。
  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(item.runCmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // 剪贴板不可用时静默（可手动选中复制）
    }
  }, [item.runCmd])

  const poll = useCallback(
    async (before?: string) => {
      setPolling(true)
      try {
        for (let i = 0; i < 12; i += 1) {
          await new Promise((r) => setTimeout(r, 3000))
          if (cancelledRef.current) return
          let r: BrowserResultView | null = null
          try {
            r = await refreshBrowserResult(item.id)
          } catch {
            r = null
          }
          if (cancelledRef.current) return
          if (r) {
            setBp(r)
            if (r.at && r.at !== before) break
          }
        }
      } finally {
        if (!cancelledRef.current) setPolling(false)
      }
    },
    [item.id],
  )

  const onTrigger = useCallback(() => {
    setMsg('')
    const before = bp?.at
    startBusy(async () => {
      try {
        await triggerBrowserPublish(item.id)
        setMsg('已启动：请在弹出的浏览器里检查无误后点【发布/发表】，结果会自动回报到这里。')
        void poll(before)
      } catch (e) {
        setMsg(e instanceof Error ? e.message : '启动失败')
      }
    })
  }, [bp?.at, item.id, poll])

  const onRefresh = useCallback(() => {
    startBusy(async () => {
      try {
        setBp(await refreshBrowserResult(item.id))
      } catch {
        // 刷新失败保留旧值
      }
    })
  }, [item.id])

  const onMark = useCallback(() => {
    setMsg('')
    startBusy(async () => {
      try {
        await markPublished(item.id)
        setMsg('已标记为「已发布」，刷新页面后会移出队列。')
      } catch (e) {
        setMsg(e instanceof Error ? e.message : '标记失败')
      }
    })
  }, [item.id])

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: colors.inkStrong }}>{item.title}</span>
        <span style={{ fontSize: 12.5, color: colors.rose, fontWeight: 600 }}>{item.platformLabel}</span>
        <span style={{ fontSize: 12.5, color: colors.muted }}>{item.mode === 'video' ? '视频' : '图文'}</span>
        <span style={{ flex: 1 }} />
        <StageBadge stage={bp?.stage} />
      </div>

      {bp ? (
        <div style={{ marginTop: space.sm, fontSize: 13, color: colors.ink, lineHeight: 1.7 }}>
          {bp.error ? <div style={{ color: '#9a2f2f' }}>错误：{bp.error}</div> : null}
          {bp.draftUrl ? (
            <div>
              链接：
              <a href={bp.draftUrl} target="_blank" rel="noreferrer" style={{ color: colors.rose }}>
                {bp.draftUrl}
              </a>
            </div>
          ) : null}
          {bp.at ? <div style={{ color: colors.muted, fontSize: 12 }}>更新于 {bp.at}</div> : null}
        </div>
      ) : null}

      <div
        style={{
          position: 'relative',
          marginTop: space.sm,
          padding: `10px 72px 10px ${space.md}`,
          borderRadius: radii.md,
          background: colors.fill,
          border: `1px solid ${colors.rule}`,
          fontSize: 12.5,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: colors.ink,
          wordBreak: 'break-all',
          lineHeight: 1.6,
        }}
      >
        {item.runCmd}
        <button
          type="button"
          onClick={onCopy}
          style={{
            position: 'absolute',
            top: 7,
            right: 7,
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

      {msg ? (
        <div
          role="status"
          style={{
            marginTop: space.sm,
            padding: `8px ${space.md}`,
            borderRadius: radii.md,
            fontSize: 13,
            color: colors.ink,
            background: colors.fill,
            border: `1px solid ${colors.rule}`,
            lineHeight: 1.6,
          }}
        >
          {msg}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', marginTop: space.md }}>
        {workerLocal ? (
          <button type="button" onClick={onTrigger} disabled={busy || polling} style={btnStyle('primary', busy || polling)}>
            {polling ? '发布中…' : '一键浏览器发布（草稿）'}
          </button>
        ) : null}
        <button type="button" onClick={onRefresh} disabled={busy || polling} style={btnStyle('ghost', busy || polling)}>
          刷新结果
        </button>
        <button type="button" onClick={onMark} disabled={busy} style={btnStyle('ghost', busy)}>
          标记已发布
        </button>
      </div>
    </div>
  )
}
