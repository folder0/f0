/**
 * Markdown partials: content/_partials/*.md render into fixed places, page
 * partials come from the nearest folder, and partials are never pages.
 * Fixture: test/fixtures/edge-site.
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
  mkdirSync(join(site.contentDir, '_partials'), { recursive: true })
  mkdirSync(join(site.contentDir, 'blog/_partials'), { recursive: true })
  writeFileSync(join(site.contentDir, '_partials/announcement.md'), '**Version 2 is out.**\n')
  writeFileSync(join(site.contentDir, '_partials/footer.md'), 'Footer partial with <script>alert(1)</script> removed.\n')
  writeFileSync(join(site.contentDir, '_partials/doc-footer.md'), 'Was this page helpful?\n')
  writeFileSync(join(site.contentDir, '_partials/post-footer.md'), 'Site-wide post footer.\n')
  writeFileSync(join(site.contentDir, 'blog/_partials/post-footer.md'), 'Subscribe to the newsletter.\n')
  server = await startServer({ site })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('site partials', () => {
  it('are rendered and sanitized', async () => {
    const partials = await json('/api/partials')
    expect(partials.announcement).toBe('<p><strong>Version 2 is out.</strong></p>')
    expect(partials.footer).toContain('Footer partial with')
    expect(partials.footer).not.toContain('<script')
  })

  it('appear on every page', async () => {
    const html = await (await get(`${server.url}/guides/intro`)).text()
    expect(html).toContain('class="f0-partial f0-announcement"')
    expect(html).toContain('class="f0-partial f0-footer-partial"')
  })
})

describe('page partials', () => {
  it('put doc-footer under docs pages', async () => {
    expect((await json('/api/content/guides/intro')).footerHtml).toBe('<p>Was this page helpful?</p>')
    expect(await (await get(`${server.url}/guides/intro`)).text()).toContain('Was this page helpful?')
  })

  it('use the nearest folder: the blog has its own post-footer', async () => {
    expect((await json('/api/content/blog/foo')).footerHtml).toBe('<p>Subscribe to the newsletter.</p>')
  })

  it('are absent when no partial exists', async () => {
    const bare = await startServer({ site: await prepareSite('edge-site') })
    try {
      expect((await (await get(`${bare.url}/api/content/guides/intro`)).json()).footerHtml).toBeUndefined()
      expect(await (await get(`${bare.url}/api/partials`)).json()).toEqual({ announcement: '', footer: '' })
    }
    finally {
      await bare.stop()
    }
  })
})

describe('partials are not pages', () => {
  it('are not served or listed', async () => {
    expect((await get(`${server.url}/api/content/_partials/footer`)).status).toBe(404)
    expect((await get(`${server.url}/_partials/footer.md`)).status).toBe(404)
    const nav = JSON.stringify(await json('/api/navigation'))
    expect(nav).not.toContain('_partials')
    expect(JSON.stringify(await json('/api/search?q=newsletter'))).not.toContain('_partials')
    expect(await (await get(`${server.url}/sitemap.xml`)).text()).not.toContain('_partials')
  })
})
