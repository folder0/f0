/**
 * Drafts (draft: true, yes or on) are listed nowhere, stay reachable by URL
 * marked noindex, and disappear entirely with F0_DRAFTS=404.
 * Fixture: test/fixtures/edge-site (guides/draft-true, guides/draft-yes, blog/draft).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

const text = async (path: string) => (await get(server.url + path)).text()
const sidebarPaths = (nav: { sidebar: Record<string, { path: string, children?: unknown[] }[]> }) =>
  Object.values(nav.sidebar).flat().map(item => item.path)

beforeAll(async () => {
  site = await prepareSite('edge-site')
  server = await startServer({ site, env: { NUXT_PUBLIC_SITE_URL: 'https://edge.test' } })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('drafts are listed nowhere', () => {
  it('leaves them out of the sidebar', async () => {
    const paths = sidebarPaths(await (await get(`${server.url}/api/navigation`)).json())
    expect(paths).toContain('/guides/intro')
    for (const draft of ['/guides/draft-true', '/guides/draft-yes', '/blog/draft']) expect(paths).not.toContain(draft)
  })

  it.each(['/sitemap.xml', '/llms.txt', '/llms-index.txt', '/api/search?q=secret', '/api/agents/search?q=secret&include_content=true', '/api/blog?path=/blog', '/feed.xml?path=/blog'])(
    'leaves them out of %s',
    async (path) => {
      const body = await text(path)
      expect(body).not.toMatch(/draft-true|draft-yes|blog\/draft|Secret draft|Draft Post/)
    },
  )
})

describe('drafts are reachable by URL, marked noindex', () => {
  it.each(['guides/draft-true', 'guides/draft-yes', 'blog/draft'])('%s', async (slug) => {
    const api = await get(`${server.url}/api/content/${slug}`)
    expect(api.status).toBe(200)
    expect(api.headers.get('x-robots-tag')).toBe('noindex')
    expect((await api.json()).draft).toBe(true)

    const raw = await get(`${server.url}/api/content/raw/${slug}`)
    expect(raw.headers.get('x-robots-tag')).toBe('noindex')

    const page = await get(`${server.url}/${slug}`)
    expect(page.headers.get('x-robots-tag')).toBe('noindex')
    const html = await page.text()
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).toContain('class="draft-banner"')
  })

  it('does not mark published pages', async () => {
    const page = await get(`${server.url}/guides/intro`)
    expect(page.headers.get('x-robots-tag')).toBeNull()
    expect(await page.text()).not.toContain('class="draft-banner"')
  })
})

describe('F0_DRAFTS=404', () => {
  it('hides drafts completely', async () => {
    const strict = await startServer({ site, env: { NUXT_DRAFTS: '404' } })
    try {
      expect((await get(`${strict.url}/api/content/guides/draft-yes`)).status).toBe(404)
      expect((await get(`${strict.url}/api/content/raw/guides/draft-yes`)).status).toBe(404)
      expect((await get(`${strict.url}/api/content/guides/intro`)).status).toBe(200)
    }
    finally {
      await strict.stop()
    }
  })
})

describe('F0_FLAGS=-hide-drafts', () => {
  it('lists drafts again for one release and says so in the log', async () => {
    const legacy = await startServer({ site, env: { F0_FLAGS: '-hide-drafts' } })
    try {
      const paths = sidebarPaths(await (await get(`${legacy.url}/api/navigation`)).json())
      expect(paths).toContain('/guides/draft-yes')
      // Blog listings keep skipping draft: true, as before
      const posts = (await (await get(`${legacy.url}/api/blog?path=/blog`)).json()).posts.map((p: { title: string }) => p.title)
      expect(posts).not.toContain('Draft Post')
      expect(legacy.output()).toMatch(/hide-drafts.*switched off/)
    }
    finally {
      await legacy.stop()
    }
  })
})
