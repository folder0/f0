/**
 * One content model: every endpoint reads frontmatter, titles and URLs the
 * same way, including files with CRLF endings, a BOM, empty frontmatter, no
 * title, or a shell comment in a code block. Fixture: test/fixtures/edge-site.
 */
import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

const json = async (path: string) => (await get(server.url + path)).json()

beforeAll(async () => {
  site = await prepareSite('edge-site')
  writeFileSync(join(site.contentDir, 'guides/mdx-page.mdx'), '# MDX Page\n\nRendered as Markdown.\n')
  writeFileSync(join(site.contentDir, 'guides/to-rename.md'), '# Before Rename\n')
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

describe('URL resolution', () => {
  it('resolves pages in numbered folders at the URL the navigation links to', async () => {
    expect((await get(`${server.url}/api/content/reference/api-basics`)).status).toBe(200)
    const nav = await json('/api/navigation')
    expect(nav.sidebar['/reference'].map((item: { path: string }) => item.path)).toEqual(['/reference/api-basics'])
  })

  it('keeps the literal folder URL working', async () => {
    expect((await get(`${server.url}/api/content/02-reference/api-basics`)).status).toBe(200)
    expect((await get(`${server.url}/api/content/guides/01-intro`)).status).toBe(200)
  })

  it('serves .mdx pages the sidebar links to', async () => {
    const nav = await json('/api/navigation')
    const paths = nav.sidebar['/guides'].map((item: { path: string }) => item.path)
    expect(paths).toContain('/guides/mdx-page')
    expect((await json('/api/content/guides/mdx-page')).title).toBe('MDX Page')
  })

  it('lists canonical URLs in the sitemap', async () => {
    const xml = await (await get(`${server.url}/sitemap.xml`)).text()
    expect(xml).toContain('<loc>https://edge.test/reference/api-basics</loc>')
    expect(xml).toContain('<loc>https://edge.test/guides</loc>')
    expect(xml).not.toContain('/02-reference/')
    expect(xml).not.toContain('/guides/index<')
  })

  it('filters llms.txt by section with either folder name', async () => {
    const byUrlName = await (await get(`${server.url}/llms.txt?section=reference`)).text()
    const byFolderName = await (await get(`${server.url}/llms.txt?section=02-reference`)).text()
    expect(byUrlName).toContain('Reference body.')
    expect(byFolderName).toContain('Reference body.')
    expect(byUrlName).not.toContain('Intro body.')
    expect(await (await get(`${server.url}/llms-index.txt`)).text()).toContain('/reference ')
  })

  it('only blocks a folder literally named private', async () => {
    expect((await get(`${server.url}/api/content/guides/private-keys`)).status).toBe(200)
    expect((await get(`${server.url}/api/content/private/anything`)).status).toBe(403)
  })

  it('answers 404, not 500, after a page is renamed', async () => {
    expect((await get(`${server.url}/api/content/guides/to-rename`)).status).toBe(200)
    renameSync(join(site.contentDir, 'guides/to-rename.md'), join(site.contentDir, 'guides/renamed.md'))
    expect((await get(`${server.url}/api/content/guides/to-rename`)).status).toBe(404)
    expect((await get(`${server.url}/api/content/guides/renamed`)).status).toBe(200)
  })
})

describe('site search quality', () => {
  const search = async (q: string) => ((await json(`/api/search?q=${encodeURIComponent(q)}`)).results as { path: string, title: string, excerpt: string }[])

  it('matches word prefixes while typing', async () => {
    expect((await search('insta')).map(r => r.path)).toContain('/guides/setup')
  })

  it('forgives a small typo in longer words', async () => {
    expect((await search('windos')).map(r => r.path)).toContain('/guides/crlf')
  })

  it('ranks a title match above a body mention', async () => {
    const results = await search('release')
    expect(results[0].path).toBe('/guides/changelog/release')
  })

  it('centers the excerpt on the matched word', async () => {
    const [first] = await search('rotat')
    expect(first.path).toBe('/guides/private-keys')
    expect(first.excerpt.toLowerCase()).toContain('rotation')
  })

  it('keeps the response shape', async () => {
    const body = await json('/api/search?q=intro')
    expect(Object.keys(body).sort()).toEqual(['query', 'results', 'total'])
    expect(Object.keys(body.results[0]).sort()).toEqual(['excerpt', 'path', 'section', 'title'])
  })
})

