/**
 * Readiness: /_ready stays 503 while the startup warm-up renders the site, and
 * turns 200 once it has finished. Liveness (/_health) is up from the start.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

beforeAll(async () => {
  site = await prepareSite()
  // Enough pages that warm-up takes noticeably longer than the first probe.
  const dir = join(site.contentDir, 'bulk')
  mkdirSync(dir, { recursive: true })
  const body = Array.from({ length: 10 }, (_, i) => `## Section ${i}\n\nSome text with \`code\` and a [link](/guides/intro).\n\n\`\`\`js\nconst x = ${i}\n\`\`\`\n`).join('\n')
  for (let i = 0; i < 300; i++) {
    writeFileSync(join(dir, `page-${i}.md`), `---\ntitle: Page ${i}\n---\n\n# Page ${i}\n\n${body}`)
  }
  server = await startServer({ site, waitFor: '/_health' })
}, 60_000)

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('/_ready', () => {
  it('reports warming_up until the startup warm-up finishes, then ready', async () => {
    const statuses: number[] = []
    const deadline = Date.now() + 50_000
    let body: { status?: string, checks?: Record<string, string> } = {}
    for (;;) {
      const response = await get(`${server.url}/_ready`)
      statuses.push(response.status)
      body = await response.json()
      if (response.status === 200 || Date.now() > deadline) break
      expect(response.status).toBe(503)
      expect(JSON.stringify(body)).toContain('warming_up')
      expect((await get(`${server.url}/_health`)).status).toBe(200)
      await new Promise(r => setTimeout(r, 50))
    }
    expect(statuses[0]).toBe(503)
    expect(statuses.at(-1)).toBe(200)
    expect(body.checks?.warmup).toBe('ok')
    expect(server.output()).toMatch(/Content cache warmed/)
  }, 60_000)
})
