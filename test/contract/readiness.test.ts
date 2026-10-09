/**
 * Readiness: /_ready stays 503 while the pages visitors land on first are
 * rendered, then turns 200 without waiting for the rest of the site, which
 * keeps warming in the background. Liveness (/_health) is up from the start.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

const section = (i: number) => `## Section ${i}\n\nText with \`code\` and a [link](/guides/intro).\n\n\`\`\`js\nconst x = ${i}\n\`\`\`\n`

let site: Site
let server: RunningServer

beforeAll(async () => {
  site = await prepareSite()
  // A heavy home page: critical, so readiness waits for it.
  writeFileSync(join(site.contentDir, 'home.md'), `---\ntitle: Fixture Home\n---\n\n# Fixture Home\n\n${Array.from({ length: 1500 }, (_, i) => section(i)).join('\n')}`)
  // A large section outside the top navigation: warmed in the background only.
  const dir = join(site.contentDir, 'archive')
  mkdirSync(dir, { recursive: true })
  const body = Array.from({ length: 30 }, (_, i) => section(i)).join('\n')
  for (let i = 0; i < 400; i++) {
    writeFileSync(join(dir, `page-${i}.md`), `---\ntitle: Page ${i}\n---\n\n# Page ${i}\n\n${body}`)
  }
  server = await startServer({ site, waitFor: '/_health' })
}, 60_000)

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('/_ready', () => {
  it('waits for the critical pages only, then lets the rest warm in the background', async () => {
    const statuses: number[] = []
    const deadline = Date.now() + 30_000
    let body: { status?: string, checks?: Record<string, string> } = {}
    for (;;) {
      const response = await get(`${server.url}/_ready`)
      statuses.push(response.status)
      body = await response.json()
      if (response.status === 200 || Date.now() > deadline) break
      expect(JSON.stringify(body)).toContain('warming_up')
      expect((await get(`${server.url}/_health`)).status).toBe(200)
      await new Promise(r => setTimeout(r, 25))
    }
    expect(statuses[0]).toBe(503)
    expect(statuses.at(-1)).toBe(200)
    expect(body.checks?.warmup).toBe('ok')
    expect(server.output()).toMatch(/Critical pages warmed/)
    // The archive section is still warming when the instance becomes ready
    expect(server.output()).not.toMatch(/Content cache warmed/)

    const background = Date.now() + 50_000
    while (!/Content cache warmed/.test(server.output()) && Date.now() < background) {
      await new Promise(r => setTimeout(r, 200))
    }
    expect(server.output()).toMatch(/Content cache warmed/)
  }, 90_000)
})
