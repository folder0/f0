/**
 * Blog: previous/next across the whole folder (not one index page), numbered
 * blog folders, and full-content RSS, Atom and JSON feeds.
 * Fixture: test/fixtures/edge-site plus generated posts.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

const json = async (path: string) => (await get(server.url + path)).json()

beforeAll(async () => {
  site = await prepareSite('edge-site')
  // A numbered blog folder with more posts than one index page holds
  const dir = join(site.contentDir, '03-news')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '_config.md'), '---\nlayout: blog\ntitle: News\nposts_per_page: 5\n---\n')
  for (let i = 1; i <= 12; i++) {
    const day = String(i).padStart(2, '0')
    writeFileSync(join(dir, `2026-03-${day}-item-${i}.md`), `---\ntitle: Item ${i}\n---\n\nNews item ${i} with an ![image](./assets/images/cover.png).\n`)
  }
  server = await startServer({ site, env: { NUXT_PUBLIC_SITE_URL: 'https://edge.test' } })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('numbered blog folders', () => {
  it('list their posts at the URL name', async () => {
    const body = await json('/api/blog?path=/news')
    expect(body.config.title).toBe('News')
    expect(body.pagination.totalPosts).toBe(12)
    expect(body.posts[0].path).toBe('/news/item-12')
  })
})

describe('previous and next post', () => {
  it('reach past the first index page', async () => {
    const oldest = await json('/api/content/news/item-1')
    expect(oldest.blog.prev).toEqual({ title: 'Item 2', path: '/news/item-2' })
    expect(oldest.blog.next).toBeNull()
    const middle = await json('/api/content/news/item-6')
    expect(middle.blog.prev.path).toBe('/news/item-7')
    expect(middle.blog.next.path).toBe('/news/item-5')
  })

  it('are the same at an alias URL', async () => {
    expect((await json('/api/content/news/2026-03-06-item-6')).blog.prev).toEqual((await json('/api/content/news/item-6')).blog.prev)
  })

  it('never include drafts', async () => {
    const foo = await json('/api/content/blog/foo')
    expect([foo.blog.prev?.path, foo.blog.next?.path]).not.toContain('/blog/draft')
  })
})

describe('feeds', () => {
  it('RSS carries the full content with absolute links', async () => {
    const response = await get(`${server.url}/feed.xml?path=/news`)
    expect(response.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8')
    const xml = await response.text()
    expect(xml).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"')
    expect(xml).toContain('<guid>https://edge.test/news/item-12</guid>')
    expect(xml).toMatch(/<content:encoded>[^<]*src=&quot;https:\/\/edge\.test\/api\/content\/assets\/images\/cover\.png/)
    expect(xml.match(/<item>/g)).toHaveLength(12)
  })

  it('Atom has entries with content', async () => {
    const response = await get(`${server.url}/feed.atom?path=/news`)
    expect(response.headers.get('content-type')).toBe('application/atom+xml; charset=utf-8')
    const xml = await response.text()
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(xml).toContain('<id>https://edge.test/news/item-12</id>')
    expect(xml).toContain('<published>2026-03-12T00:00:00.000Z</published>')
    expect(xml).toContain('<content type="html">')
  })

  it('JSON Feed lists the same items', async () => {
    const response = await get(`${server.url}/feed.json?path=/news`)
    expect(response.headers.get('content-type')).toBe('application/feed+json; charset=utf-8')
    const feed = await response.json()
    expect(feed.version).toBe('https://jsonfeed.org/version/1.1')
    expect(feed.feed_url).toBe('https://edge.test/feed.json?path=/news')
    expect(feed.items).toHaveLength(12)
    expect(feed.items[0]).toMatchObject({ id: 'https://edge.test/news/item-12', title: 'Item 12', date_published: '2026-03-12T00:00:00.000Z' })
    expect(feed.items[0].content_html).toContain('News item 12')
  })

  it('serve the site blog without ?path= and leave drafts out', async () => {
    const feed = await (await get(`${server.url}/feed.json`)).json()
    expect(feed.title).toBe('Edge Blog')
    expect(feed.items.map((item: { title: string }) => item.title)).not.toContain('Draft Post')
  })
})

describe('blog presets', () => {
  it('render the index with the preset from _config.md', async () => {
    const html = await (await get(`${server.url}/news`)).text()
    expect(html).toContain('data-blog-preset="classic"')
    writeFileSync(join(site.contentDir, '03-news/_config.md'), '---\nlayout: blog\ntitle: News\npreset: cards\n---\n')
    await new Promise(r => setTimeout(r, 20))
    expect(await (await get(`${server.url}/news`)).text()).toContain('data-blog-preset="cards"')
    expect((await json('/api/blog?path=/news')).config.preset).toBe('cards')
  })

  it('fall back to classic for an unknown preset, with a warning', async () => {
    writeFileSync(join(site.contentDir, '03-news/_config.md'), '---\nlayout: blog\ntitle: News\npreset: fancy\n---\n')
    await new Promise(r => setTimeout(r, 20))
    expect((await json('/api/blog?path=/news')).config.preset).toBe('classic')
    expect(server.output()).toMatch(/preset \\"fancy\\" is unknown/)
  })
})
