/**
 * Baseline contract for public mode: endpoints existing sites and agents rely on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

beforeAll(async () => {
  site = await prepareSite()
  server = await startServer({ site, authMode: 'public' })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('public mode baseline', () => {
  it.each([
    '/',
    '/guides/intro',
    '/guides/setup',
    '/blog/hello-world',
    '/api/content/guides/intro',
    '/api/navigation',
    '/llms.txt',
    '/llms-index.txt',
    '/sitemap.xml',
    '/feed.xml?path=/blog',
    '/api/search?q=intro',
    '/api/agents/search?q=intro',
    '/api/blog?path=/blog',
    '/api/content/raw/guides/intro',
    '/_health',
    '/_ready',
  ])('GET %s returns 200', async (path) => {
    const response = await get(server.url + path)
    expect(response.status).toBe(200)
  })

  it('serves server-rendered HTML with stable heading anchor ids', async () => {
    const html = await (await get(`${server.url}/guides/intro`)).text()
    expect(html).toContain('<title>Intro | Fixture Docs</title>')
    expect(html).toContain('id="getting-started"')
    expect(html).toContain('id="details"')
  })

  it('keeps the content API response shape', async () => {
    const body = await (await get(`${server.url}/api/content/guides/intro`)).json()
    expect(body).toMatchObject({ type: 'markdown', title: 'Intro', path: '/guides/intro', layout: 'docs' })
    expect(body).toHaveProperty('html')
    expect(body).toHaveProperty('toc')
    expect(body).toHaveProperty('frontmatter')
    expect(body).toHaveProperty('markdown')
  })

  it('keeps the agent search response shape', async () => {
    const body = await (await get(`${server.url}/api/agents/search?q=intro`)).json()
    expect(body).toMatchObject({ query: 'intro' })
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results[0]).toEqual(expect.objectContaining({
      title: expect.any(String),
      path: expect.any(String),
      url: expect.any(String),
      section: expect.any(String),
      relevance: expect.any(Number),
      excerpt: expect.any(String),
    }))
  })

  it('serves /llms.txt as plain text with the site header', async () => {
    const response = await get(`${server.url}/llms.txt`)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(await response.text()).toMatch(/^# Fixture Docs - Documentation Context/)
  })

  it('keeps public caching headers in public mode', async () => {
    expect((await get(`${server.url}/llms.txt`)).headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('lists blog posts in the blog API and feed', async () => {
    const blog = await (await get(`${server.url}/api/blog?path=/blog`)).json()
    expect(blog.config.layout).toBe('blog')
    expect(blog.posts.map((p: { title: string }) => p.title)).toContain('Hello World')

    const feed = await (await get(`${server.url}/feed.xml?path=/blog`)).text()
    expect(feed).toContain('<title>Hello World</title>')
  })

  it('returns an empty listing (not an error) for a blog path that does not exist', async () => {
    const response = await get(`${server.url}/api/blog?path=/no-such-section`)
    expect(response.status).toBe(200)
    expect((await response.json()).posts).toEqual([])
  })

  it('processes image variants on demand', async () => {
    const response = await get(`${server.url}/api/content/assets/images/pixel.png?w=400&f=webp`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('x-image-processed')).toBe('true')
  })

  it('reports public mode and no session from /api/auth/session', async () => {
    const response = await get(`${server.url}/api/auth/session`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authMode: 'public', authenticated: false })
  })

  it('keeps admin endpoints closed in public mode', async () => {
    expect((await get(`${server.url}/api/admin/audit-logs`)).status).toBe(403)
  })

  it('rejects webhooks when no secret is configured', async () => {
    const response = await get(`${server.url}/api/webhook`, { method: 'POST', body: '{}', headers: { 'x-github-event': 'push' } })
    expect(response.status).toBe(503)
  })
})
