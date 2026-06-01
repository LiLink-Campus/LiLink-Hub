// studio/queue/page.tsx —— 发布队列看板（Server Component）。
//
// 汇总所有「待人工发布」(ready_to_publish) 的浏览器自动发布平台稿件，每条显示：
// 标题 / 平台 / 上次浏览器发布结果 + 「一键发布(本机) 或 可复制命令」/ 刷新 / 标记已发布。
// 浏览器自动发布 worker 是独立进程（见 docs/browser-publish-worker.md）。

import { getPayload } from 'payload'
import config from '@payload-config'

import { getPlatformSpec, isManualPlatform, modeForPlatform } from '@/platforms/registry'
import { requireUser } from '../_lib/auth'
import { fonts, colors, space } from '../_lib/theme'
import { PublishQueue, type QueueItem } from './PublishQueue'

export const dynamic = 'force-dynamic'

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function pickTitle(doc: Record<string, unknown>): string {
  const socialTitle = str(doc.socialTitle).trim()
  if (socialTitle) return socialTitle
  const wxTitle = str(doc.wxTitle).trim()
  if (wxTitle) return wxTitle
  const post = doc.post
  if (post && typeof post === 'object') {
    const t = str((post as Record<string, unknown>).title).trim()
    if (t) return t
  }
  return '未命名草稿'
}

function toItem(doc: Record<string, unknown>): QueueItem {
  const platform = str(doc.platform)
  const spec = getPlatformSpec(platform as never)
  const mode = modeForPlatform(platform as never, doc.contentMode)
  const id = String(doc.id)
  const pr = doc.publishResult as Record<string, unknown> | undefined
  const bp = pr?.browserPublish
  return {
    id,
    title: pickTitle(doc),
    platform,
    platformLabel: spec?.label ?? platform,
    mode,
    runCmd: `npx tsx scripts/publish-worker.ts run --content-id ${id} --report`,
    browserPublish: bp && typeof bp === 'object' ? (bp as QueueItem['browserPublish']) : null,
  }
}

export default async function PublishQueuePage() {
  // 与其它工作台页一致：未登录直接 redirect('/login')（不再静默渲染空队列）。
  const user = await requireUser()
  const payload = await getPayload({ config })

  let items: QueueItem[] = []
  try {
    const res = await payload.find({
      collection: 'channel-contents',
      where: { status: { equals: 'ready_to_publish' } },
      depth: 1,
      limit: 100,
      sort: '-updatedAt',
      overrideAccess: false,
      user: user as never,
    })
    items = (res.docs as unknown as Record<string, unknown>[])
      .filter((d) => isManualPlatform(d.platform))
      .map(toItem)
  } catch {
    items = []
  }

  const workerLocal = process.env.LILINK_WORKER_LOCAL === '1'

  return (
    <div>
      <header style={{ marginBottom: space.lg }}>
        <h1 style={{ margin: 0, fontFamily: fonts.serif, fontSize: 26, fontWeight: 700, color: colors.inkStrong }}>
          发布队列
        </h1>
        <p style={{ margin: `${space.xs} 0 0`, fontSize: 14.5, color: colors.muted, lineHeight: 1.6 }}>
          已通过审核、待发布到视频号 / 小红书 / 抖音的内容。浏览器自动发布默认只填好存草稿，由你人工确认后点发布。
        </p>
      </header>
      <PublishQueue items={items} workerLocal={workerLocal} />
    </div>
  )
}
