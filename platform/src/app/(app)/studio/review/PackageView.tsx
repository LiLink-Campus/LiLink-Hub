'use client'

// studio/review/PackageView.tsx —— 人工发布包要点展示（client，纯展示）。
//
// 图文 / 视频形态在 approved 发布后会生成「人工发布包」（publishResult.manualPackage）。
// 这里把发布包要点排成审核员一眼能核对的版式：平台 + 形态、标题、正文（可复制）、话题、
// 素材清单（标注是否已有可访问直链）、校验提示（warning/error 配色）、以及发布入口链接 +
// 人工操作清单。复制按钮方便审核员把标题 / 正文 / 话题直接拷到平台后台。
//
// 数据来自 _detail.ts 的 ReviewManualPackage（已是可序列化的精简形状），本组件不做取数。

import { useState } from 'react'

import { colors, fonts, radii, space } from '../_lib/theme'
import type { ReviewManualPackage } from './_detail'

/** 小标题（区块标签）。 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12.5,
        fontWeight: 700,
        color: colors.muted,
        letterSpacing: '.04em',
        marginBottom: space.xs,
      }}
    >
      {children}
    </div>
  )
}

/** 一键复制小按钮（复制成功短暂提示「已复制」）。 */
function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // 剪贴板不可用（无 https / 权限）时静默失败，审核员可手动选中复制。
        }
      }}
      style={{
        appearance: 'none',
        cursor: 'pointer',
        fontFamily: fonts.sans,
        fontSize: 12.5,
        fontWeight: 600,
        color: copied ? colors.onRose : colors.rose,
        background: copied ? colors.rose : colors.fill,
        border: `1px solid ${copied ? colors.rose : colors.rule}`,
        borderRadius: radii.pill,
        padding: '3px 12px',
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
      }}
    >
      {copied ? '已复制' : label}
    </button>
  )
}

export interface PackageViewProps {
  pkg: ReviewManualPackage
}

export function PackageView({ pkg }: PackageViewProps) {
  const hasErrors = pkg.warnings.some((w) => w.level === 'error')

  return (
    <div
      style={{
        background: colors.fill,
        border: `1px solid ${colors.rule}`,
        borderRadius: radii.md,
        padding: space.md,
        fontFamily: fonts.sans,
      }}
    >
      {/* 顶：平台 + 形态 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space.sm,
          flexWrap: 'wrap',
          marginBottom: space.md,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: colors.inkStrong }}>
          {pkg.platformLabel}发布包
        </span>
        <span
          style={{
            fontSize: 12,
            color: colors.muted,
            background: colors.surface,
            border: `1px solid ${colors.rule}`,
            borderRadius: radii.pill,
            padding: '2px 10px',
          }}
        >
          {pkg.modeLabel}
        </span>
      </div>

      {/* 标题 */}
      <div style={{ marginBottom: space.md }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
          <SectionLabel>标题</SectionLabel>
          <CopyButton text={pkg.title} />
        </div>
        <div style={{ fontSize: 15, color: colors.ink, lineHeight: 1.6, wordBreak: 'break-word' }}>
          {pkg.title || <span style={{ color: colors.muted }}>（未填写标题）</span>}
        </div>
      </div>

      {/* 正文 / 描述（含拼好的话题与 LiLink 链接，可整段复制） */}
      {pkg.caption ? (
        <div style={{ marginBottom: space.md }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
            <SectionLabel>正文（含话题 / 链接，可整段复制）</SectionLabel>
            <CopyButton text={pkg.caption} label="复制正文" />
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: fonts.sans,
              fontSize: 13.5,
              lineHeight: 1.7,
              color: colors.ink,
              background: colors.surface,
              border: `1px solid ${colors.rule}`,
              borderRadius: radii.sm,
              padding: space.sm,
              maxHeight: 220,
              overflow: 'auto',
            }}
          >
            {pkg.caption}
          </pre>
        </div>
      ) : null}

      {/* 话题标签 */}
      {pkg.hashtags.length > 0 ? (
        <div style={{ marginBottom: space.md }}>
          <SectionLabel>话题（{pkg.hashtags.length}）</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs }}>
            {pkg.hashtags.map((tag, i) => (
              <span
                key={`${tag}-${i}`}
                style={{
                  fontSize: 12.5,
                  color: colors.rose,
                  background: colors.surface,
                  border: `1px solid ${colors.rule}`,
                  borderRadius: radii.pill,
                  padding: '3px 10px',
                  lineHeight: 1.5,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* 素材清单 */}
      {pkg.assets.length > 0 ? (
        <div style={{ marginBottom: space.md }}>
          <SectionLabel>素材（{pkg.assets.length}）</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: space.xs }}>
            {pkg.assets.map((asset, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: space.sm,
                  fontSize: 13,
                  color: colors.ink,
                  lineHeight: 1.5,
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: colors.muted,
                    background: colors.surface,
                    border: `1px solid ${colors.rule}`,
                    borderRadius: radii.sm,
                    padding: '1px 8px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {asset.roleLabel}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {asset.name || '（未命名素材）'}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: asset.hasUrl ? '#2f7d4f' : '#9a6a12',
                    whiteSpace: 'nowrap',
                  }}
                  title={asset.hasUrl ? '已有可访问直链' : '尚未拿到可访问直链，发布前请确认媒体库直链配置'}
                >
                  {asset.hasUrl ? '可用' : '待确认直链'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 校验提示（error 红、warning 黄） */}
      {pkg.warnings.length > 0 ? (
        <div style={{ marginBottom: space.md }}>
          <SectionLabel>检查提示</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: space.xs }}>
            {pkg.warnings.map((w, i) => (
              <li
                key={i}
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: w.level === 'error' ? '#b3261e' : '#9a6a12',
                  background: w.level === 'error' ? '#fdeceb' : '#fdf3df',
                  border: `1px solid ${w.level === 'error' ? '#f5c6c2' : '#f0e2bf'}`,
                  borderRadius: radii.sm,
                  padding: `6px ${space.sm}`,
                }}
              >
                {w.level === 'error' ? '需修正：' : '提示：'}
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 操作清单 + 发布入口 */}
      {pkg.checklist.length > 0 ? (
        <div>
          <SectionLabel>人工发布步骤</SectionLabel>
          <ol style={{ margin: 0, paddingLeft: '1.2em', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pkg.checklist.map((step, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.6, color: colors.ink }}>
                {step}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {pkg.publishUrl ? (
        <div style={{ marginTop: space.md }}>
          <a
            href={pkg.publishUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13.5,
              fontWeight: 600,
              color: colors.rose,
              textDecoration: 'none',
            }}
          >
            打开{pkg.platformLabel}发布入口 ↗
          </a>
        </div>
      ) : null}

      {hasErrors ? (
        <p style={{ margin: `${space.sm} 0 0`, fontSize: 12.5, color: '#b3261e', lineHeight: 1.6 }}>
          发布包存在「需修正」项，相应素材补齐后才能成功生成 / 发布。
        </p>
      ) : null}
    </div>
  )
}
