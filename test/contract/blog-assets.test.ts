/**
 * Blog images and feeds: cover_image resolves like images in Markdown,
 * og:image is an absolute URL (falling back to the brand og_image), raw HTML
 * images resolve, and /feed.xml without ?path= serves the blog.
 * Fixture: test/fixtures/edge-site.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

const ogImage = (html: string) => html.match(/property="og:image" content="([^"]*)"/)?.[1] ?? null

beforeAll(async () => {
  site = await prepareSite('edge-site')
  writeFileSync(join(site.contentDir, '_brand.md'), '---\nog_image: ./assets/images/cover.png\n---\n')
  writeFileSync(join(site.contentDir, 'guides/raw-image.md'), '# Raw Image\n\n<img src="./assets/images/cover.png" alt="Cover">\n')
  server = await startServer({ site, env: { NUXT_PUBLIC_SITE_URL: 'https://edge.test' } })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('cover_image', () => {
  it('resolves the documented ./assets/... form to a URL that serves the image', async () => {
    const posts = (await (await get(`${server.url}/api/blog?path=/blog`)).json()).posts as { title: string, coverImage?: string }[]
    const cover = posts.find(post => post.title === 'Foo Post')?.coverImage
    expect(cover).toBe('/api/content/assets/images/cover.png')
    const image = await get(server.url + cover)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect((await (await get(`${server.url}/api/content/blog/foo`)).json()).blog.coverImage).toBe(cover)
  })
})

describe('og:image', () => {
  it('is the absolute cover image URL on a post', async () => {
    expect(ogImage(await (await get(`${server.url}/blog/foo`)).text())).toBe('https://edge.test/api/content/assets/images/cover.png')
  })

  it('falls back to the brand og_image', async () => {
    expect(ogImage(await (await get(`${server.url}/guides/intro`)).text())).toBe('https://edge.test/api/content/assets/images/cover.png')
  })

  it('stays absolute when no site URL is configured', async () => {
    const bare = await startServer({ site, env: { NUXT_PUBLIC_SITE_URL: '' } })
    try {
      expect(ogImage(await (await get(`${bare.url}/blog/foo`)).text())).toBe(`${bare.url}/api/content/assets/images/cover.png`)
    }
    finally {
      await bare.stop()
    }
  })
})

describe('raw HTML images', () => {
  it('resolve like Markdown images', async () => {
    const html = (await (await get(`${server.url}/api/content/guides/raw-image`)).json()).html as string
    expect(html).toContain('src="/api/content/assets/images/cover.png"')
  })
})

describe('/feed.xml', () => {
  it('serves the blog when no ?path= is given, with links on the site URL', async () => {
    const xml = await (await get(`${server.url}/feed.xml`)).text()
    expect(xml).toContain('<link>https://edge.test/blog/foo</link>')
    expect(xml).toContain('<title>Edge Blog</title>')
    expect(xml).not.toContain('127.0.0.1')
  })
})
