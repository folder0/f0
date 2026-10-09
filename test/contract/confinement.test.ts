/**
 * Path confinement: user-supplied paths must never reach files outside the
 * content directory, and control files are never served as pages.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

beforeAll(async () => {
  site = await prepareSite()
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
