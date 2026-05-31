'use server'

// studio/review/actions.ts —— 审核页专用 Server Actions（薄封装）。
//
// 复用 foundation 的 _lib/actions.ts 做实际写操作（approve / reject / publishContent /
// markPublished），本文件只在其上加两件事：
//   1) 操作后 revalidatePath('/studio/review')，让服务端缓存的列表失效；
//   2) 把「最新的审核队列详情列表」一并查好返回给客户端，客户端一次往返即可刷新整页列表，
//      不必再单独发请求或整页 router.refresh()（也就保住了其它行已展开的发布包/未提交的输入）。
//
// 详情列表的拉取：先 listReviewQueue() 拿到队列里有哪些 id（跨运营、状态在 in_review/
// approved/ready_to_publish），再对每条 getContent(id)（depth:2）取完整文档、提取要点。
// 单条取详情失败（如刚被并发改动而读不到）就跳过该条，不让整页崩。
//
// 鉴权：底层 _lib/actions.ts 每个动作内部都已 getPayloadAndUser()，未登录会抛中文错误；
// 这里不再重复鉴权。

import { revalidatePath } from 'next/cache'

import {
  approve as approveContent,
  reject as rejectContent,
  publishContent as publishContentInner,
  markPublished as markPublishedInner,
  listReviewQueue,
  getContent,
} from '../_lib/actions'
import { toReviewItemDetail, type ReviewItemDetail } from './_detail'

const REVIEW_PATH = '/studio/review'

/**
 * 拉取审核队列的「完整详情列表」（卡片所需）。
 * 不抛错：任一条取详情失败就跳过该条；整体失败回空数组（页面据空状态给指引）。
 */
export async function fetchReviewDetails(): Promise<ReviewItemDetail[]> {
  let summaries: { id: string }[]
  try {
    summaries = await listReviewQueue()
  } catch {
    return []
  }
  const details = await Promise.all(
    summaries.map(async (s) => {
      try {
        const doc = await getContent(s.id)
        return toReviewItemDetail(doc)
      } catch {
        return null
      }
    }),
  )
  return details.filter((d): d is ReviewItemDetail => d !== null)
}

/** 审核通过（in_review → approved），随后返回刷新后的队列详情。 */
export async function approveAndRefresh(id: string): Promise<ReviewItemDetail[]> {
  await approveContent(id)
  revalidatePath(REVIEW_PATH)
  return fetchReviewDetails()
}

/** 打回（in_review → draft，记原因），随后返回刷新后的队列详情。 */
export async function rejectAndRefresh(id: string, reason: string): Promise<ReviewItemDetail[]> {
  await rejectContent(id, reason)
  revalidatePath(REVIEW_PATH)
  return fetchReviewDetails()
}

/**
 * 发布：
 *  - 长文（wechat）：建公众号草稿，状态机置 published。
 *  - 图文/视频：生成人工发布包，状态机置 ready_to_publish。
 * 返回 { result, items }：result 是发布端点原始返回（含 stage / manualPackage 等，
 * 供前端即时提示）；items 是刷新后的队列详情。
 */
export async function publishAndRefresh(
  id: string,
): Promise<{ result: unknown; items: ReviewItemDetail[] }> {
  const result = await publishContentInner(id)
  revalidatePath(REVIEW_PATH)
  const items = await fetchReviewDetails()
  return { result, items }
}

/** 人工确认已发（ready_to_publish → published），随后返回刷新后的队列详情。 */
export async function markPublishedAndRefresh(id: string): Promise<ReviewItemDetail[]> {
  await markPublishedInner(id)
  revalidatePath(REVIEW_PATH)
  return fetchReviewDetails()
}
