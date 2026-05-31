import { afterEach, describe, expect, test, vi } from 'vitest'

import { reportResult, type BrowserPublishResult } from '@/automation/report'

afterEach(() => vi.restoreAllMocks())

const result: BrowserPublishResult = {
  platform: 'douyin',
  mode: 'video',
  stage: 'staged',
  at: '2026-06-01T00:00:00.000Z',
}

describe('reportResult', () => {
  test('POST 到正确 URL（去尾斜杠）+ Bearer token + JSON body，成功返回 true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const ok = await reportResult({ studioUrl: 'https://x.test/', token: 'T0ken', contentId: '42', result })
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x.test/api/channel-contents/42/browser-result')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer T0ken')
    expect(JSON.parse(init.body as string)).toMatchObject({ platform: 'douyin', stage: 'staged' })
  })

  test('非 2xx → false（吞错，不抛）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    expect(await reportResult({ studioUrl: 'https://x.test', token: 'T', contentId: '1', result })).toBe(false)
  })

  test('网络异常 → false（吞错，不抛）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    expect(await reportResult({ studioUrl: 'https://x.test', token: 'T', contentId: '1', result })).toBe(false)
  })

  test('contentId 做 URL 编码', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await reportResult({ studioUrl: 'https://x.test', token: 'T', contentId: 'a/b', result })
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.test/api/channel-contents/a%2Fb/browser-result')
  })
})
