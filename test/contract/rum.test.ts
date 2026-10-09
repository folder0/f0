/**
 * Opt-in real-user metrics: off by default; when on, valid measurements are
 * logged and everything else is rejected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

const post = (url: string, body: unknown) => get(`${url}/api/rum`, {
  method: 'POST',
  body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
})

const LCP = { name: 'LCP', value: 1830.4, rating: 'good', navigationType: 'navigate', path: '/guides/intro' }

beforeAll(async () => {
  site = await prepareSite()
  server = await startServer({ site, env: { NUXT_PUBLIC_RUM: 'true' } })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('/api/rum', () => {
  it('is off by default', async () => {
    const off = await startServer({ site })
    try {
      expect((await post(off.url, LCP)).status).toBe(404)
    }
    finally {
      await off.stop()
    }
  })

  it('logs a valid measurement', async () => {
    expect((await post(server.url, LCP)).status).toBe(204)
    expect(server.output()).toMatch(/"msg":"rum".*"name":"LCP".*"value":1830.*"path":"\/guides\/intro"/)
  })

  it.each([
    { ...LCP, name: 'FID' },
    { ...LCP, value: -1 },
    { ...LCP, value: 'fast' },
    { ...LCP, rating: 'great' },
    { ...LCP, path: 'https://evil.test/' },
    'not json',
  ])('rejects %j', async (body) => {
    expect((await post(server.url, body)).status).toBe(400)
  })

  it('rejects oversized bodies', async () => {
    expect((await post(server.url, { ...LCP, path: '/' + 'x'.repeat(2000) })).status).toBe(413)
  })
})
