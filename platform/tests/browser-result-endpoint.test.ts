import { afterEach, describe, expect, test, vi } from 'vitest'

import { browserResultEndpoint } from '@/endpoints/browserResult'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function fakeReq(opts: {
  token?: string
  id?: string
  data?: unknown
  doc?: unknown
}) {
  const update = vi.fn().mockResolvedValue({})
  const findByID = vi.fn().mockResolvedValue(opts.doc ?? null)
  const headers = new Headers()
  if (opts.token !== undefined) headers.set('authorization', `Bearer ${opts.token}`)
  return {
    req: {
      payload: { findByID, update },
      headers,
      routeParams: { id: opts.id ?? '5' },
      data: opts.data,
    },
    update,
    findByID,
  }
}

const validBody = { platform: 'douyin', mode: 'video', stage: 'staged', title: '标题' }

describe('browser-result endpoint', () => {
  test('未配置 WORKER_REPORT_TOKEN → 501', async () => {
    const { req } = fakeReq({ token: 'x', data: validBody })
    const res = await browserResultEndpoint.handler(req)
    expect(res.status).toBe(501)
  })

  test('token 不匹配 → 401，不写库', async () => {
    vi.stubEnv('WORKER_REPORT_TOKEN', 'SECRET')
    const { req, update } = fakeReq({ token: 'WRONG', data: validBody, doc: { id: 5 } })
    const res = await browserResultEndpoint.handler(req)
    expect(res.status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  test('缺 Authorization → 401', async () => {
    vi.stubEnv('WORKER_REPORT_TOKEN', 'SECRET')
    const { req } = fakeReq({ data: validBody, doc: { id: 5 } }) // 无 token
    const res = await browserResultEndpoint.handler(req)
    expect(res.status).toBe(401)
  })

  test('stage 非法 → 400', async () => {
    vi.stubEnv('WORKER_REPORT_TOKEN', 'SECRET')
    const { req } = fakeReq({ token: 'SECRET', data: { ...validBody, stage: 'nope' }, doc: { id: 5 } })
    const res = await browserResultEndpoint.handler(req)
    expect(res.status).toBe(400)
  })

  test('platform 非法 → 400', async () => {
    vi.stubEnv('WORKER_REPORT_TOKEN', 'SECRET')
    const { req } = fakeReq({ token: 'SECRET', data: { ...validBody, platform: 'wechat' }, doc: { id: 5 } })
    const res = await browserResultEndpoint.handler(req)
    expect(res.status).toBe(400)
  })

  test('稿不存在 → 404', async () => {
    vi.stubEnv('WORKER_REPORT_TOKEN', 'SECRET')
    const { req } = fakeReq({ token: 'SECRET', data: validBody, doc: null })
    const res = await browserResultEndpoint.handler(req)
    expect(res.status).toBe(404)
  })

  test('合法 → 写 publishResult.browserPublish、不改 status、返回 ok', async () => {
    vi.stubEnv('WORKER_REPORT_TOKEN', 'SECRET')
    const { req, update } = fakeReq({ token: 'SECRET', data: validBody, doc: { id: 5 } })
    const res = await browserResultEndpoint.handler(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, stage: 'staged' })
    expect(update).toHaveBeenCalledOnce()
    const arg = update.mock.calls[0][0]
    const bp = arg.data.publishResult.browserPublish
    expect(bp).toMatchObject({ platform: 'douyin', mode: 'video', stage: 'staged', title: '标题' })
    expect(bp.at).toBeTruthy()
    // 绝不改 status
    expect(JSON.stringify(arg.data)).not.toContain('"status"')
  })
})
