/**
 * One content model: every endpoint reads frontmatter, titles and URLs the
 * same way, including files with CRLF endings, a BOM, empty frontmatter, no
 * title, or a shell comment in a code block. Fixture: test/fixtures/edge-site.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

const json = async (path: string) => (await get(server.url + path)).json()

beforeAll(async () => {
  site = await prepareSite('edge-site')
  server = await startServer({ site, env: { NUXT_PUBLIC_SITE_URL: 'https://edge.test' } })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('frontmatter and titles', () => {
  it.each([
    ['guides/crlf', 'Windows File'],
    ['guides/bom', 'Bom File'],
    ['guides/subtitle', "Don't Panic"],
    ['guides/fence', 'Real Fence Title'],
    ['guides/empty-fm', 'Empty FM Heading'],
    ['guides/no-title', 'No Title'],
    ['blog/null-fm', 'Null FM Post'],
  ])('%s is titled %j by the page, raw header and search alike', async (slug, title) => {
    const page = await get(`${server.url}/api/content/${slug}`)
    expect(page.status).toBe(200)
    const body = await page.json()
    expect(body.title).toBe(title)
    expect(body.html).not.toContain('title:')

    const raw = await get(`${server.url}/api/content/raw/${slug}`)
    expect(raw.status).toBe(200)
    expect(decodeURIComponent(raw.headers.get('x-page-title') ?? '')).toBe(title)
  })

  it('never uses the server file path as a title', async () => {
    const results = (await json('/api/search?q=body')).results as { title: string }[]
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) expect(result.title).not.toMatch(/\//)
  })

  it('logs no parse errors for any fixture page', () => {
    expect(server.output()).not.toMatch(/"level":"error"/)
  })
})

describe('blog listings', () => {
  it('lists every post even after one with comment-only frontmatter', async () => {
    const posts = (await json('/api/blog?path=/blog')).posts.map((p: { title: string }) => p.title)
    expect(posts).toEqual(expect.arrayContaining(['Foo Post', 'Null FM Post', 'Later Post']))
  })

  it('puts every post in the feed', async () => {
    const xml = await (await get(`${server.url}/feed.xml?path=/blog`)).text()
    for (const title of ['Foo Post', 'Null FM Post', 'Later Post']) expect(xml).toContain(title)
  })
})

describe('search URLs', () => {
  it('links dated posts at the same URL as the sidebar', async () => {
    const results = (await json('/api/search?q=foo')).results as { path: string }[]
    expect(results.map(r => r.path)).toContain('/blog/foo')
    const agents = (await json('/api/agents/search?q=release')).results as { url: string }[]
    expect(agents.map(r => new URL(r.url).pathname)).toContain('/guides/changelog/release')
  })

  it('still serves the old dated-post alias search used to link', async () => {
    expect((await get(`${server.url}/api/content/blog/02-11-foo`)).status).toBe(200)
  })
})
