/**
 * Accessibility gate (WCAG 2.1/2.2 A and AA rules, plus axe best practices,
 * that work without a rendering engine): axe-core over the server-rendered
 * HTML of each page type. Color contrast needs real rendering and is checked separately for the
 * brand accent (server/utils/accent.ts).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

const require = createRequire(import.meta.url)
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf-8')

let site: Site
let server: RunningServer

beforeAll(async () => {
  site = await prepareSite('edge-site')
  server = await startServer({ site })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

async function violations(path: string) {
  const html = await (await get(server.url + path)).text()
  const dom = new JSDOM(html, { url: server.url + path, runScripts: 'outside-only', pretendToBeVisual: true })
  dom.window.eval(AXE_SOURCE)
  const axe = (dom.window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string, impact: string, nodes: { target: string[] }[] }[] }> } }).axe
  const result = await axe.run(dom.window.document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  dom.window.close()
  return result.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(', ')}`)
}

describe('accessibility', () => {
  it.each(['/', '/guides/setup', '/blog', '/blog/foo', '/guides/does-not-exist', '/login'])('%s has no violations', async (path) => {
    expect(await violations(path)).toEqual([])
  }, 60_000)
})
