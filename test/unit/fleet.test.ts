import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script without type declarations
import { analyzeApp, looksLikeF0, probeSite } from '../../bin/f0-fleet.mjs'

const app = (overrides = {}) => ({
  uuid: 'a1', name: 'acme-docs', fqdn: 'https://docs.acme.test', build_pack: 'dockerfile',
  git_repository: 'acme/docs', git_branch: 'main', health_check_enabled: true, health_check_path: '/_ready',
  ...overrides,
})
const env = (key: string, value = 'x', extra = {}) => ({ key, value, is_buildtime: false, is_runtime: true, ...extra })
const codes = (report: { flags: { code: string }[] }) => report.flags.map(f => f.code)

describe('analyzeApp', () => {
  it('flags a site meant to be private that is public at runtime', () => {
    const report = analyzeApp(app(), [env('AUTH_MODE', 'private'), env('JWT_SECRET', 's3cret'), env('NUXT_PUBLIC_SITE_URL', 'https://docs.acme.test')])
    expect(report.intendedPrivate).toBe(true)
    expect(report.effectivelyPrivate).toBe(false)
    expect(codes(report)).toContain('PUBLIC-BUT-MEANT-PRIVATE')
    expect(codes(report)).toContain('PRIVATE-WITHOUT-SECRET')
  })

  it('accepts a correctly configured private site', () => {
    const report = analyzeApp(app(), [
      env('NUXT_AUTH_MODE', 'private'), env('NUXT_JWT_SECRET', 'abc'), env('NUXT_PUBLIC_SITE_URL', 'https://docs.acme.test'),
    ])
    expect(report.effectivelyPrivate).toBe(true)
    expect(report.flags).toEqual([])
  })

  it('flags secrets available at build time (both API field spellings)', () => {
    const report = analyzeApp(app(), [
      env('NUXT_JWT_SECRET', 'abc', { is_buildtime: true }),
      { key: 'NUXT_AWS_SECRET_ACCESS_KEY', value: 'k', is_build_time: true },
      env('NUXT_PUBLIC_SITE_URL', 'https://x'),
    ])
    expect(report.flags.filter((f: { code: string }) => f.code === 'SECRET-AT-BUILDTIME')).toHaveLength(2)
  })

  it('flags a root health check, a missing site URL and a content volume', () => {
    const report = analyzeApp(app({ health_check_path: '/' }), [env('NUXT_AUTH_MODE', 'public')], [{ mount_path: '/app/content' }])
    expect(codes(report)).toEqual(expect.arrayContaining(['HEALTHCHECK-ON-ROOT', 'NO-SITE-URL', 'CONTENT-VOLUME']))
  })

  it('never includes secret values in the report', () => {
    const report = analyzeApp(app(), [env('NUXT_JWT_SECRET', 'TOP-SECRET-VALUE'), env('AWS_SECRET_ACCESS_KEY', 'AWS-SECRET-VALUE')])
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('TOP-SECRET-VALUE')
    expect(serialized).not.toContain('AWS-SECRET-VALUE')
  })
})

describe('looksLikeF0', () => {
  it('detects f0 apps by their variables or name', () => {
    expect(looksLikeF0({ name: 'billing-api' }, [{ key: 'NUXT_AUTH_MODE' }])).toBe(true)
    expect(looksLikeF0({ name: 'acme-docs' }, [])).toBe(true)
    expect(looksLikeF0({ name: 'billing-api', git_repository: 'acme/billing' }, [{ key: 'DATABASE_URL' }])).toBe(false)
  })
})

describe('probeSite', () => {
  const fakeFetch = (status: number) => async () => new Response('', { status })
  it('classifies responses', async () => {
    expect((await probeSite('https://x.test', fakeFetch(401))).status).toBe('login-required')
    expect((await probeSite('https://x.test', fakeFetch(200))).status).toBe('public')
    expect((await probeSite('https://x.test', fakeFetch(503))).status).toBe('http-503')
    expect((await probeSite(null)).status).toBe('no-url')
  })
})

describe('inventory against a mock Coolify API', () => {
  it('lists f0 apps with flags and sends the bearer token', async () => {
    const { createServer } = await import('node:http')
    // @ts-expect-error plain ESM script without type declarations
    const { inventory } = await import('../../bin/f0-fleet.mjs')
    const seenAuth: string[] = []
    const server = createServer((req, res) => {
      seenAuth.push(String(req.headers.authorization))
      const routes: Record<string, unknown> = {
        '/api/v1/applications': [
          { uuid: 'u1', name: 'acme-docs', fqdn: 'https://docs.acme.test', build_pack: 'dockerfile', health_check_enabled: true, health_check_path: '/' },
          { uuid: 'u2', name: 'billing-api', fqdn: 'https://api.acme.test', build_pack: 'nixpacks' },
        ],
        '/api/v1/applications/u1/envs': [{ key: 'AUTH_MODE', value: 'private', is_buildtime: true, is_runtime: true }],
        '/api/v1/applications/u2/envs': [{ key: 'DATABASE_URL', value: 'postgres://...' }],
      }
      const body = routes[req.url ?? '']
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body ?? {}))
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const { port } = server.address() as { port: number }
    try {
      const reports = await inventory({ base: `http://127.0.0.1:${port}`, token: 'tok' })
      expect(reports.map((r: { name: string }) => r.name)).toEqual(['acme-docs'])
      expect(reports[0].flags.map((f: { code: string }) => f.code)).toEqual(
        expect.arrayContaining(['PUBLIC-BUT-MEANT-PRIVATE', 'HEALTHCHECK-ON-ROOT', 'NO-SITE-URL']),
      )
      expect(seenAuth.every(a => a === 'Bearer tok')).toBe(true)
    }
    finally {
      server.close()
    }
  })
})
