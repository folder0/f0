/**
 * Docs chrome: breadcrumbs, previous/next in sidebar order, and an optional
 * "Edit this page" link. Fixture: test/fixtures/edge-site.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

const chrome = async (slug: string) => (await (await get(`${server.url}/api/content/${slug}`)).json()).chrome

beforeAll(async () => {
  site = await prepareSite('edge-site')
  mkdirSync(join(site.contentDir, 'guides/deep'), { recursive: true })
  writeFileSync(join(site.contentDir, 'guides/deep/01-one.md'), '# Deep One\n')
  server = await startServer({ site, env: { F0_EDIT_URL: 'https://github.com/acme/docs/edit/main/content/{path}' } })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('previous and next', () => {
  it('follow the sidebar order', async () => {
    const setup = await chrome('guides/setup')
    expect(setup.prev).toEqual({ title: 'Intro', path: '/guides/intro' })
    expect(setup.next.path).toBeTruthy()
    expect((await chrome('guides/intro')).prev).toBeNull()
  })

  it('are the same for an alias URL', async () => {
    expect(await chrome('guides/02-setup')).toEqual(await chrome('guides/setup'))
  })

  it('never point at drafts', async () => {
    const nav = await (await get(`${server.url}/api/navigation`)).json()
    const flat = (items: { path: string, type: string, children?: unknown[] }[]): string[] =>
      items.flatMap(item => [...(item.type === 'file' ? [item.path] : []), ...flat((item.children ?? []) as typeof items)])
    const neighbours: string[] = []
    for (const path of flat(nav.sidebar['/guides'])) {
      const pageChrome = await chrome(path.slice(1))
      if (!pageChrome) continue // blog-layout pages have no docs chrome
      for (const link of [pageChrome.prev, pageChrome.next]) if (link) neighbours.push(link.path)
    }
    expect(neighbours).toContain('/guides/deep/one')
    expect(neighbours).not.toContain('/guides/draft-true')
    expect(neighbours).not.toContain('/guides/draft-yes')
  })

  it('lead from a section landing page into its first page', async () => {
    expect((await chrome('guides')).next).toEqual({ title: 'Intro', path: '/guides/intro' })
  })
})

describe('breadcrumbs', () => {
  it('show the section and folders', async () => {
    expect((await chrome('guides/deep/one')).breadcrumbs).toEqual([
      { title: 'Guides', path: '/guides' },
      { title: 'Deep', path: null },
    ])
  })
})

describe('edit link', () => {
  it('points at the source file', async () => {
    expect((await chrome('guides/setup')).editUrl).toBe('https://github.com/acme/docs/edit/main/content/guides/02-setup.md')
  })

  it('is absent without F0_EDIT_URL', async () => {
    const bare = await startServer({ site })
    try {
      expect((await (await get(`${bare.url}/api/content/guides/setup`)).json()).chrome.editUrl).toBeNull()
    }
    finally {
      await bare.stop()
    }
  })
})

describe('server-rendered HTML', () => {
  it('includes breadcrumbs and pager links', async () => {
    const html = await (await get(`${server.url}/guides/setup`)).text()
    expect(html).toContain('class="f0-breadcrumbs"')
    expect(html).toMatch(/<a href="\/guides\/intro"[^>]*class="f0-pager-link f0-pager-prev"[^>]*rel="prev"/)
    expect(html).toContain('Edit this page')
  })
})
