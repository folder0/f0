/**
 * Private-mode sessions and admin access: explicit admins, revocable logout,
 * immediate effect of allowlist removals, SVG handling, login redirects.
 */
import { readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { get, mintToken, prepareSite, startServer, type RunningServer, type Site } from './harness'

const DEFAULT_ALLOWLIST = { emails: ['reader@example.com', 'admin@example.com'], admins: ['admin@example.com'] }

let site: Site
let server: RunningServer

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

beforeAll(async () => {
  site = await prepareSite()
  server = await startServer({ site, authMode: 'private' })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

afterEach(async () => {
  site.writeAllowlist(DEFAULT_ALLOWLIST)
  // allowlist is mtime-cached; give the next write a distinct mtime
  await new Promise(r => setTimeout(r, 15))
})

describe('admin access', () => {
  it('lets a listed admin read audit logs and refuses other users', async () => {
    expect((await get(`${server.url}/api/admin/audit-logs`, { headers: bearer(mintToken('admin@example.com')) })).status).toBe(200)
    expect((await get(`${server.url}/api/admin/audit-logs`, { headers: bearer(mintToken('reader@example.com')) })).status).toBe(403)
  })

  it('treats nobody as admin when the allowlist has no admins list', async () => {
    site.writeAllowlist({ emails: ['reader@example.com', 'admin@example.com'] })
    await new Promise(r => setTimeout(r, 15))
    expect((await get(`${server.url}/api/admin/audit-logs`, { headers: bearer(mintToken('admin@example.com')) })).status).toBe(403)
  })

  it('rejects SVG uploads and accepts markdown uploads from an admin', async () => {
    const upload = (name: string, body: string) => {
      const form = new FormData()
      form.append('file', new Blob([body]), name)
      form.append('path', `guides/${name}`)
      return get(`${server.url}/api/admin/upload`, { method: 'POST', body: form, headers: bearer(mintToken('admin@example.com')) })
    }
    expect((await upload('evil.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).status).toBe(400)
    expect((await upload('uploaded.md', '# Uploaded\n')).status).toBe(200)
  })

  it('refuses upload paths into dot-folders, private/ or through symlinks', async () => {
    const uploadTo = (path: string) => {
      const form = new FormData()
      form.append('file', new Blob(['# x\n']), 'x.md')
      form.append('path', path)
      return get(`${server.url}/api/admin/upload`, { method: 'POST', body: form, headers: bearer(mintToken('admin@example.com')) })
    }
    symlinkSync(site.root, join(site.contentDir, 'escape'))
    for (const path of ['.git/x.md', 'guides/.cache/x.md', '../x.md', 'guides/../../x.md', 'private/x.md', 'escape/x.md']) {
      expect((await uploadTo(path)).status, path).toBe(400)
    }
    expect((await uploadTo('guides/_partials/doc-footer.md')).status).toBe(200)
  })
})

describe('SVG assets', () => {
  it('serves content SVG sandboxed and without MIME sniffing', async () => {
    const response = await get(`${server.url}/api/content/assets/images/diagram.svg`, { headers: bearer(mintToken('reader@example.com')) })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toMatch(/^sandbox/)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('logout', () => {
  it('revokes the session so the same token stops working', async () => {
    const token = mintToken('reader@example.com', { jti: 'contract-logout-1' })
    expect((await get(`${server.url}/api/content/guides/intro`, { headers: bearer(token) })).status).toBe(200)

    const logout = await get(`${server.url}/api/auth/logout`, { method: 'POST', headers: bearer(token) })
    expect(logout.status).toBe(200)
    const cookie = logout.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/f0_token=;/)
    expect(cookie).toMatch(/Path=\//)

    expect((await get(`${server.url}/api/content/guides/intro`, { headers: bearer(token) })).status).toBe(401)
  })

  it('succeeds without a session or with a garbage token', async () => {
    expect((await get(`${server.url}/api/auth/logout`, { method: 'POST' })).status).toBe(200)
    expect((await get(`${server.url}/api/auth/logout`, { method: 'POST', headers: bearer('garbage') })).status).toBe(200)
  })
})

describe('allowlist changes take effect immediately', () => {
  it('locks out a user removed from the allowlist despite a valid token', async () => {
    const token = mintToken('reader@example.com')
    expect((await get(`${server.url}/api/content/guides/intro`, { headers: bearer(token) })).status).toBe(200)

    site.writeAllowlist({ emails: ['admin@example.com'], admins: ['admin@example.com'] })
    await new Promise(r => setTimeout(r, 15))

    expect((await get(`${server.url}/api/content/guides/intro`, { headers: bearer(token) })).status).toBe(401)
  })
})

describe('allowlist reloads', () => {
  const intro = (email: string) => get(`${server.url}/api/content/guides/intro`, { headers: bearer(mintToken(email)) })

  it('picks up a replacement that keeps an older modification time (cp -p, rsync -t)', async () => {
    expect((await intro('reader@example.com')).status).toBe(200)
    const allowlistPath = join(site.privateDir, 'allowlist.json')
    const before = statSync(allowlistPath)

    site.writeAllowlist({ emails: ['admin@example.com'], admins: ['admin@example.com'] })
    const older = new Date(before.mtimeMs - 60_000)
    utimesSync(allowlistPath, older, older)

    expect((await intro('reader@example.com')).status).toBe(401)
  })

  it('keeps the last good allowlist when the file becomes malformed', async () => {
    expect((await intro('reader@example.com')).status).toBe(200)

    writeFileSync(join(site.privateDir, 'allowlist.json'), '{ "emails": [ "reader@example.com", ')
    const response = await intro('reader@example.com')
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect((await intro('stranger@example.com')).status).toBe(401)
    expect(server.output()).toMatch(/keeping the last good copy/)
  })

  it('keeps the last good allowlist when a list has the wrong shape', async () => {
    writeFileSync(join(site.privateDir, 'allowlist.json'), JSON.stringify({ emails: 'reader@example.com' }))
    expect((await intro('reader@example.com')).status).toBe(200)
  })

  it('fails closed without ending sessions when no allowlist was ever readable', async () => {
    const broken = await prepareSite()
    writeFileSync(join(broken.privateDir, 'allowlist.json'), 'not json')
    const brokenServer = await startServer({ site: broken, authMode: 'private' })
    try {
      const request = () => get(`${brokenServer.url}/api/content/guides/intro`, { headers: { cookie: `f0_token=${mintToken('reader@example.com')}` } })
      const response = await request()
      expect(response.status).toBe(503)
      expect(response.headers.get('set-cookie')).toBeNull()

      broken.writeAllowlist(DEFAULT_ALLOWLIST)
      expect((await request()).status).toBe(200)
    }
    finally {
      await brokenServer.stop()
      broken.cleanup()
    }
  })
})

describe('browser session state', () => {
  const session = (headers: Record<string, string> = {}) => get(`${server.url}/api/auth/session`, { headers })

  it('reports an anonymous visitor as signed out, without a 401', async () => {
    const response = await session()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authMode: 'private', authenticated: false })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('reports the signed-in user from the httpOnly cookie', async () => {
    const body = await (await session({ cookie: `f0_token=${mintToken('reader@example.com')}` })).json()
    expect(body).toEqual({ authMode: 'private', authenticated: true, user: { email: 'reader@example.com' } })
  })

  it('reports revoked and garbage sessions as signed out', async () => {
    const token = mintToken('reader@example.com', { jti: 'contract-session-revoked' })
    await get(`${server.url}/api/auth/logout`, { method: 'POST', headers: { cookie: `f0_token=${token}` } })
    expect((await (await session({ cookie: `f0_token=${token}` })).json()).authenticated).toBe(false)
    expect((await (await session({ cookie: 'f0_token=garbage' })).json()).authenticated).toBe(false)
  })

  it('ships no client code that writes the session token to localStorage', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../.output/public/_nuxt')
    const bundles = readdirSync(root).filter(name => name.endsWith('.js')).map(name => readFileSync(join(root, name), 'utf-8'))
    expect(bundles.length).toBeGreaterThan(0)
    for (const code of bundles) {
      expect(code).not.toMatch(/setItem\([^)]{0,40}f0_token/)
      expect(code).not.toMatch(/Bearer \$\{/)
    }
  })
})

describe('login redirects', () => {
  it('builds a valid login URL when an invalid session hits the home page', async () => {
    const response = await get(`${server.url}/`, { headers: { cookie: 'f0_token=garbage' } })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/login?reason=expired')
  })

  it('keeps the destination and reason for deeper pages', async () => {
    const response = await get(`${server.url}/guides/intro`, { headers: { cookie: 'f0_token=garbage' } })
    expect(response.headers.get('location')).toBe('/login?redirect=%2Fguides%2Fintro&reason=expired')
  })
})
