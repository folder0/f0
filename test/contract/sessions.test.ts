/**
 * Private-mode sessions and admin access: explicit admins, revocable logout,
 * immediate effect of allowlist removals, SVG handling, login redirects.
 */
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
