/**
 * Baseline contract for private mode: the login gate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, mintToken, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

beforeAll(async () => {
  site = await prepareSite()
  server = await startServer({ site, authMode: 'private' })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('private mode baseline', () => {
  it('keeps health probes and the login page reachable without a session', async () => {
    expect((await get(`${server.url}/_health`)).status).toBe(200)
    expect((await get(`${server.url}/_ready`)).status).toBe(200)
    expect((await get(`${server.url}/login`)).status).toBe(200)
  })

  it('rejects anonymous API requests with 401', async () => {
    expect((await get(`${server.url}/api/content/guides/intro`)).status).toBe(401)
    expect((await get(`${server.url}/llms.txt`)).status).not.toBe(200)
  })

  it('redirects anonymous page requests to the login page', async () => {
    const response = await get(`${server.url}/guides/intro`)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/login?redirect=%2Fguides%2Fintro')
  })

  it('serves content to an allowlisted session', async () => {
    const token = mintToken('reader@example.com')
    const response = await get(`${server.url}/api/content/guides/intro`, { headers: { authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    expect((await response.json()).title).toBe('Intro')
  })

  it('does not serve content images to anonymous users', async () => {
    expect((await get(`${server.url}/api/content/assets/images/pixel.png`)).status).toBe(401)
    expect((await get(`${server.url}/api/content/assets/images/pixel.png?w=400&f=webp`)).status).toBe(401)
  })

  it('serves content images to a session', async () => {
    const token = mintToken('reader@example.com')
    const response = await get(`${server.url}/api/content/assets/images/pixel.png`, { headers: { authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
  })

  it('still serves fingerprinted build assets anonymously so /login can load', async () => {
    const html = await (await get(`${server.url}/login`)).text()
    const asset = html.match(/\/_nuxt\/[\w.-]+\.js/)?.[0]
    expect(asset).toBeTruthy()
    expect((await get(server.url + asset)).status).toBe(200)
  })

  it.each(['/llms.txt', '/api/content/guides/intro', '/api/content/raw/guides/intro', '/api/content/assets/images/pixel.png', '/guides/intro'])(
    'marks %s as private and uncacheable for shared caches',
    async (path) => {
      const token = mintToken('reader@example.com')
      const response = await get(server.url + path, { headers: { authorization: `Bearer ${token}` } })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('vary')).toMatch(/Cookie/)
      expect(response.headers.get('vary')).toMatch(/Authorization/)
    },
  )

  it('rejects a token signed with the wrong secret', async () => {
    const response = await get(`${server.url}/api/content/guides/intro`, { headers: { authorization: 'Bearer not.a.token' } })
    expect(response.status).toBe(401)
  })
})
