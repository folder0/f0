/**
 * Runtime settings: the documented short names work when set only at runtime,
 * and a private site that cannot sign sessions refuses to start.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_JWT_SECRET, get, mintToken, prepareSite, startServer, type Site } from './harness'

let site: Site

beforeAll(async () => {
  site = await prepareSite()
})

afterAll(() => {
  site?.cleanup()
})

describe('runtime settings', () => {
  it('honours AUTH_MODE and JWT_SECRET set only at runtime', async () => {
    const server = await startServer({
      site,
      env: { NUXT_AUTH_MODE: '', AUTH_MODE: 'private', NUXT_JWT_SECRET: '', JWT_SECRET: TEST_JWT_SECRET },
    })
    try {
      const anonymous = await get(`${server.url}/guides/intro`)
      expect(anonymous.status).toBe(302)
      const signedIn = await get(`${server.url}/api/content/guides/intro`, { headers: { authorization: `Bearer ${mintToken('reader@example.com')}` } })
      expect(signedIn.status).toBe(200)
      expect(server.output()).toMatch(/Auth mode.*"authMode":"private".*"source":"AUTH_MODE"/)
    }
    finally {
      await server.stop()
    }
  })

  it('treats an unknown AUTH_MODE as private', async () => {
    const server = await startServer({ site, env: { NUXT_AUTH_MODE: 'Privat' } })
    try {
      expect((await get(`${server.url}/guides/intro`)).status).toBe(302)
    }
    finally {
      await server.stop()
    }
  })

  it('refuses to start a private site without a JWT secret', async () => {
    await expect(startServer({ site, authMode: 'private', env: { NUXT_JWT_SECRET: '' } }))
      .rejects.toThrow(/Refusing to start/)
  })

  it('refuses to start a private site with the old placeholder secret', async () => {
    await expect(startServer({ site, authMode: 'private', env: { NUXT_JWT_SECRET: 'change-me-in-production' } }))
      .rejects.toThrow(/Refusing to start/)
  })
})
