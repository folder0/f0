/**
 * Client JavaScript budget: what a docs page loads before any interaction.
 * Measured on the built output (gzip). Raise the budget deliberately, in the
 * same change that needs it, never to silence a regression.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

// Measured at 99KB gzip in October 2026 (Nuxt 4.5)
const INITIAL_JS_BUDGET_KB = 110

const PUBLIC_NUXT = resolve(dirname(fileURLToPath(import.meta.url)), '../../.output/public/_nuxt')

let site: Site
let server: RunningServer

beforeAll(async () => {
  site = await prepareSite()
  server = await startServer({ site })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('client JavaScript', () => {
  it(`keeps the initial JavaScript of a docs page under ${INITIAL_JS_BUDGET_KB}KB gzip`, async () => {
    const html = await (await get(`${server.url}/guides/intro`)).text()
    const files = [...new Set([...html.matchAll(/(?:src|href)="\/_nuxt\/([^"]+\.js)"/g)].map(m => m[1]))]
    expect(files.length).toBeGreaterThan(0)
    const gzipKb = files.reduce((sum, file) => sum + gzipSync(readFileSync(join(PUBLIC_NUXT, file))).length, 0) / 1024
    expect(gzipKb, `initial JS is ${gzipKb.toFixed(1)}KB gzip over ${files.length} files`).toBeLessThanOrEqual(INITIAL_JS_BUDGET_KB)
  })

  it('does not load mermaid up front', async () => {
    const html = await (await get(`${server.url}/guides/intro`)).text()
    const files = [...new Set([...html.matchAll(/(?:src|href)="\/_nuxt\/([^"]+\.js)"/g)].map(m => m[1]))]
    for (const file of files) {
      expect(readFileSync(join(PUBLIC_NUXT, file), 'utf-8')).not.toMatch(/mermaid\.initialize|flowchart-v2/)
    }
  })
})
