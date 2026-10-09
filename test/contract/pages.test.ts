/**
 * Server-rendered pages: navigation is in the HTML, blog folders render their
 * index, missing pages answer 404, and API specs carry their download source.
 * Fixture: test/fixtures/edge-site.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, mintToken, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

const page = async (path: string, init?: RequestInit) => {
  const response = await get(server.url + path, init)
  return { status: response.status, html: await response.text() }
}

beforeAll(async () => {
  site = await prepareSite('edge-site')
  writeFileSync(join(site.contentDir, 'guides/petstore.json'), JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Petstore', version: '1.0.0' },
    paths: { '/pets': { get: { summary: 'List pets', responses: { 200: { description: 'OK' } } } } },
  }))
  server = await startServer({ site })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('navigation in the server-rendered HTML', () => {
  it('includes the header and sidebar links', async () => {
    const { html } = await page('/guides/intro')
    expect(html).toContain('href="/reference"')
    expect(html).toContain('href="/guides/setup"')
    expect(html).not.toContain('class="sidebar-loading"')
  })

  it('includes them in private mode, for a signed-in visitor', async () => {
    const privateServer = await startServer({ site, authMode: 'private' })
    try {
      const response = await get(`${privateServer.url}/guides/intro`, { headers: { cookie: `f0_token=${mintToken('reader@example.com')}` } })
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('href="/guides/setup"')
    }
    finally {
      await privateServer.stop()
    }
  })
})

describe('status codes', () => {
  it('answers 404 for a missing page, with the usual chrome', async () => {
    const { status, html } = await page('/guides/does-not-exist')
    expect(status).toBe(404)
    expect(html).toContain('Page Not Found')
    expect(html).toContain('href="/guides"')
  })

  it('answers 200 for existing pages', async () => {
    for (const path of ['/', '/guides/intro', '/reference/api-basics', '/blog/foo']) {
      expect((await page(path)).status).toBe(200)
    }
  })
})

describe('blog folders', () => {
  it('render their index on the server', async () => {
    const { status, html } = await page('/blog')
    expect(status).toBe(200)
    expect(html).not.toContain('Page Not Found')
    expect(html).toContain('href="/blog/foo"')
    expect(html).toContain('href="/blog/later"')
  })
})

describe('API specs', () => {
  it('ship the original spec for the download button', async () => {
    const { status, html } = await page('/guides/petstore')
    expect(status).toBe(200)
    expect(html).toContain('rawSpec')
    expect(html).toContain('List pets')
  })
})
