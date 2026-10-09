/**
 * Path confinement: user-supplied paths must never reach files outside the
 * content directory, symlinks may not lead out of it, control files and
 * dotfiles are never served, and documents among the assets are sandboxed.
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

beforeAll(async () => {
  site = await prepareSite()
  const { contentDir, root } = site
  const outside = join(root, 'outside-secret.md')

  // Symlinks leading out of the content directory (file and directory)
  symlinkSync(outside, join(contentDir, 'guides/03-leak.md'))
  symlinkSync(root, join(contentDir, 'linked'))
  symlinkSync(outside, join(contentDir, 'assets/images/leak.png'))
  symlinkSync(root, join(contentDir, 'assets/linked'))
  // A symlink that stays inside keeps working
  symlinkSync(join(contentDir, 'guides/02-setup.md'), join(contentDir, 'guides/04-setup-alias.md'))

  // Dotfiles among the assets
  writeFileSync(join(contentDir, 'assets/.env'), 'SECRET=1\n')
  mkdirSync(join(contentDir, 'assets/.private'), { recursive: true })
  writeFileSync(join(contentDir, 'assets/.private/note.txt'), 'hidden\n')

  // Files a browser would render as documents
  writeFileSync(join(contentDir, 'assets/page.html'), '<script>alert(1)</script>')
  writeFileSync(join(contentDir, 'assets/page.xhtml'), '<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>')
  writeFileSync(join(contentDir, 'assets/data.xml'), '<?xml version="1.0"?><root/>')
  writeFileSync(join(contentDir, 'assets/images/diagram.svgz'), 'not really gzip')

  server = await startServer({ site, authMode: 'public' })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('?path= confinement', () => {
  it.each([
    '/api/blog?path=..',
    '/api/blog?path=%2e%2e',
    '/api/blog?path=blog/../..',
    '/api/blog/tags?path=..',
    '/feed.xml?path=..',
    '/api/blog?path=_drafts',
  ])('rejects %s with 400 and leaks nothing', async (path) => {
    const response = await get(server.url + path)
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('OUTSIDE SECRET')
  })

  it('still lists a real blog directory', async () => {
    const response = await get(`${server.url}/api/blog/tags?path=/blog`)
    expect(response.status).toBe(200)
    expect((await response.json()).tags.map((t: { name: string }) => t.name)).toContain('news')
  })
})

describe('control files', () => {
  it.each([
    '/api/content/blog/_config',
    '/api/content/_brand',
    '/api/content/raw/blog/_config',
    '/api/content/raw/_brand',
  ])('%s returns 404', async (path) => {
    expect((await get(server.url + path)).status).toBe(404)
  })
})

describe('symlinks', () => {
  it.each([
    '/api/content/guides/leak',
    '/api/content/raw/guides/leak',
    '/api/content/linked/outside-secret',
    '/api/content/raw/linked/outside-secret',
    '/api/content/assets/images/leak.png',
    '/api/content/assets/linked/outside-secret.md',
  ])('%s does not follow a symlink out of the content directory', async (path) => {
    const response = await get(server.url + path)
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('OUTSIDE SECRET')
  })

  it.each([
    '/llms.txt',
    '/llms.txt?section=guides',
    '/llms-index.txt',
    '/sitemap.xml',
    '/api/navigation',
    '/api/search?q=outside',
    '/api/agents/search?q=outside&include_content=true',
  ])('%s does not index a symlink that leaves the content directory', async (path) => {
    const response = await get(server.url + path)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).not.toContain('OUTSIDE SECRET')
    expect(body).not.toContain('guides/leak')
  })

  it('still serves a symlink that stays inside the content directory', async () => {
    const response = await get(`${server.url}/api/content/guides/setup-alias`)
    expect(response.status).toBe(200)
  })
})

describe('asset dotfiles', () => {
  it.each([
    '/api/content/assets/.env',
    '/api/content/assets/.private/note.txt',
  ])('%s returns 404', async (path) => {
    expect((await get(server.url + path)).status).toBe(404)
  })
})

describe('document-type assets', () => {
  it.each([
    '/api/content/assets/page.html',
    '/api/content/assets/page.xhtml',
    '/api/content/assets/data.xml',
    '/api/content/assets/images/diagram.svg',
    '/api/content/assets/images/diagram.svgz',
  ])('%s is served sandboxed', async (path) => {
    const response = await get(server.url + path)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toMatch(/^sandbox/)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('does not sandbox plain images', async () => {
    const response = await get(`${server.url}/api/content/assets/images/pixel.png`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBeNull()
  })
})
