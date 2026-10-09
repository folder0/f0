/**
 * Personal access tokens on private sites: created with the CLI, accepted as
 * Bearer tokens (never cookies), bound to an allowlisted email, revocable.
 */
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer
let token: string

const cli = (...args: string[]) => execFileSync(process.execPath, ['bin/f0-token.mjs', ...args, '--private', site.privateDir], { encoding: 'utf-8' })
const bearer = (value: string) => ({ authorization: `Bearer ${value}` })

beforeAll(async () => {
  site = await prepareSite()
  token = cli('create', '--email', 'reader@example.com', '--name', 'agent', '--days', '30').trim().split('\n').pop()!
  server = await startServer({ site, authMode: 'private' })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('personal access tokens', () => {
  it('the CLI prints a token once and stores only its hash', () => {
    expect(token).toMatch(/^f0_pat_[A-Za-z0-9_-]{43}$/)
    expect(cli('list')).toMatch(/^agent\treader@example\.com\tcreated \d{4}-\d{2}-\d{2}\texpires \d{4}-\d{2}-\d{2}/)
  })

  it('open the API and /mcp as the token\'s email', async () => {
    expect((await get(`${server.url}/api/content/guides/intro`, { headers: bearer(token) })).status).toBe(200)
    const mcp = await get(`${server.url}/mcp`, {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_page', arguments: { path: '/guides/intro' } } }),
    })
    expect((await mcp.json()).result.isError).toBe(false)
  })

  it('are refused from a cookie, and when unknown', async () => {
    expect((await get(`${server.url}/api/content/guides/intro`, { headers: { cookie: `f0_token=${token}` } })).status).toBe(401)
    expect((await get(`${server.url}/api/content/guides/intro`, { headers: bearer(`f0_pat_${'x'.repeat(43)}`) })).status).toBe(401)
  })

  it('stop working when the email leaves the allowlist', async () => {
    site.writeAllowlist({ emails: ['admin@example.com'], admins: ['admin@example.com'] })
    expect((await get(`${server.url}/api/content/guides/intro`, { headers: bearer(token) })).status).toBe(401)
    site.writeAllowlist({ emails: ['reader@example.com', 'admin@example.com'], admins: ['admin@example.com'] })
    expect((await get(`${server.url}/api/content/guides/intro`, { headers: bearer(token) })).status).toBe(200)
  })

  it('stop working once revoked', async () => {
    expect(cli('revoke', '--name', 'agent')).toMatch(/Revoked "agent"/)
    expect((await get(`${server.url}/api/content/guides/intro`, { headers: bearer(token) })).status).toBe(401)
  })
})
