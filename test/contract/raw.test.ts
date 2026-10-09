/**
 * Raw Markdown endpoint: headers stay valid for any title or path, and the
 * title comes from the frontmatter `title` key, not a look-alike.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

beforeAll(async () => {
  site = await prepareSite()
  const dir = join(site.contentDir, 'intl')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'greek.md'), '---\nsubtitle: Not this one\ntitle: "Καλημέρα 世界 🚀"\n---\n\n# Heading\n\nBody.\n')
  writeFileSync(join(dir, 'café.md'), '# Café Crème\n\nBody.\n')
  writeFileSync(join(dir, 'plain.md'), '---\ntitle: Plain Title\n---\n\nBody.\n')
  server = await startServer({ site })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('/api/content/raw', () => {
  it('serves a non-Latin-1 title as a percent-encoded header instead of failing', async () => {
    const response = await get(`${server.url}/api/content/raw/intl/greek`)
    expect(response.status).toBe(200)
    expect(decodeURIComponent(response.headers.get('x-page-title') ?? '')).toBe('Καλημέρα 世界 🚀')
    expect(await response.text()).toContain('Body.')
  })

  it('keeps plain ASCII titles unchanged', async () => {
    const response = await get(`${server.url}/api/content/raw/intl/plain`)
    expect(response.headers.get('x-page-title')).toBe('Plain Title')
    expect(response.headers.get('x-page-path')).toBe('/intl/plain')
  })

  it('handles a non-ASCII path and download file name', async () => {
    const response = await get(`${server.url}/api/content/raw/intl/caf%C3%A9?download=true`)
    expect(response.status).toBe(200)
    expect(decodeURIComponent(response.headers.get('x-page-title') ?? '')).toBe('Café Crème')
    const disposition = response.headers.get('content-disposition') ?? ''
    expect(disposition).toMatch(/^attachment; filename="intl-caf_\.md"; filename\*=UTF-8''intl-caf%C3%A9\.md$/)
  })
})
