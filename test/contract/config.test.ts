/**
 * Folder configuration: the nearest _config.md applies (nested and numbered
 * folders included), edits apply without a restart, and a webhook push
 * clears every content cache. Fixture: test/fixtures/edge-site.
 */
import { createHmac } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

const WEBHOOK_SECRET = 'config-test-webhook-secret'

let site: Site
let server: RunningServer

const json = async (path: string) => (await get(server.url + path)).json()

beforeAll(async () => {
  site = await prepareSite('edge-site')
  server = await startServer({ site, env: { NUXT_GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET } })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('nearest _config.md', () => {
  it('applies a nested folder config to its pages', async () => {
    const page = await json('/api/content/guides/changelog/release')
    expect(page.layout).toBe('blog')
    expect(page.blog.date).toBe('2026-01-01')
  })

  it('keeps the top-level config for pages without a nearer one', async () => {
    expect((await json('/api/content/guides/intro')).layout).toBe('docs')
    expect((await json('/api/content/blog/foo')).layout).toBe('blog')
  })

  it('can be switched off for one release with F0_FLAGS=-nested-config', async () => {
    const legacy = await startServer({ site, env: { F0_FLAGS: '-nested-config' } })
    try {
      expect((await (await get(`${legacy.url}/api/content/guides/changelog/release`)).json()).layout).toBe('docs')
    }
    finally {
      await legacy.stop()
    }
  })

  it('picks up an edited _config.md without a restart', async () => {
    expect((await json('/api/blog?path=/blog')).config.title).toBe('Edge Blog')
    writeFileSync(join(site.contentDir, 'blog/_config.md'), '---\nlayout: blog\ntitle: Renamed Blog\n---\n')
    await new Promise(r => setTimeout(r, 20))
    expect((await json('/api/blog?path=/blog')).config.title).toBe('Renamed Blog')
  })
})

describe('sidebar refresh', () => {
  it('picks up a title edit three folders deep without a restart', async () => {
    const titles = async () => {
      const nav = await json('/api/navigation')
      const flat = (items: { title: string, children?: unknown[] }[]): string[] =>
        items.flatMap(item => [item.title, ...flat((item.children ?? []) as { title: string }[])])
      return flat(nav.sidebar['/guides'])
    }
    expect(await titles()).toContain('Release One')
    writeFileSync(join(site.contentDir, 'guides/changelog/2026-01-01-release.md'), '---\ntitle: Release Renamed\ndate: 2026-01-01\n---\n\nRelease notes.\n')
    await new Promise(r => setTimeout(r, 1100))
    expect(await titles()).toContain('Release Renamed')
  })
})

describe('webhook push', () => {
  it('clears the search index along with every other content cache', async () => {
    const search = async () => ((await json('/api/search?q=zanzibar')).results as { path: string }[]).map(r => r.path)
    expect(await search()).toEqual([])

    // The search index is cached; a new page is not found until content changes are signalled
    writeFileSync(join(site.contentDir, 'guides/zanzibar.md'), '# Zanzibar\n\nNew page about zanzibar.\n')
    expect(await search()).toEqual([])

    const body = JSON.stringify({ ref: 'refs/heads/main' })
    const response = await get(`${server.url}/api/webhook`, {
      method: 'POST',
      body,
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'config-test-1',
        'x-hub-signature-256': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`,
        'content-type': 'application/json',
      },
    })
    expect(response.status).toBe(200)
    expect(await search()).toEqual(['/guides/zanzibar'])
    expect(server.output()).toMatch(/Content caches invalidated.*"search-index"/)
  })
})
