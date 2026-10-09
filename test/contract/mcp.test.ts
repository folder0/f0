/**
 * Model Context Protocol endpoint (/mcp): JSON-RPC over POST, three read-only
 * tools, origin checks, and the same access rules as the site.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, mintToken, prepareSite, startServer, type RunningServer, type Site } from './harness'

let site: Site
let server: RunningServer

const rpc = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  get(`${url}/mcp`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } })

const call = async (url: string, name: string, args: Record<string, unknown>, headers?: Record<string, string>) =>
  (await (await rpc(url, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }, headers)).json()).result

beforeAll(async () => {
  site = await prepareSite('edge-site')
  server = await startServer({ site })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
})

describe('/mcp protocol', () => {
  it('initializes with the requested protocol version', async () => {
    const body = await (await rpc(server.url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })).json()
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.capabilities.tools).toBeDefined()
    expect(body.result.serverInfo.name).toBe('f0')
  })

  it('accepts notifications without a body', async () => {
    const response = await rpc(server.url, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(response.status).toBe(202)
  })

  it('lists three read-only tools', async () => {
    const body = await (await rpc(server.url, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(['search_docs', 'read_page', 'list_pages'])
  })

  it('answers JSON-RPC errors for bad requests', async () => {
    expect((await (await rpc(server.url, { jsonrpc: '2.0', id: 3, method: 'nope' })).json()).error.code).toBe(-32601)
    expect((await (await rpc(server.url, { id: 4, method: 'ping' })).json()).error.code).toBe(-32600)
    const parse = await get(`${server.url}/mcp`, { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } })
    expect((await parse.json()).error.code).toBe(-32700)
  })

  it('has no GET stream and refuses other origins', async () => {
    expect((await get(`${server.url}/mcp`)).status).toBe(405)
    expect((await rpc(server.url, { jsonrpc: '2.0', id: 5, method: 'ping' }, { origin: 'https://evil.test' })).status).toBe(403)
    expect((await rpc(server.url, { jsonrpc: '2.0', id: 6, method: 'ping' }, { origin: server.url })).status).toBe(200)
  })
})

describe('/mcp tools', () => {
  it('search_docs finds pages and leaves drafts out', async () => {
    const result = await call(server.url, 'search_docs', { query: 'install' })
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('Path: /guides/setup')
    expect((await call(server.url, 'search_docs', { query: 'secret draft' })).content[0].text).not.toContain('draft-yes')
  })

  it('read_page returns Markdown, and a tool error for a missing page', async () => {
    expect((await call(server.url, 'read_page', { path: '/guides/setup' })).content[0].text).toContain('# Install Guide')
    const missing = await call(server.url, 'read_page', { path: '/guides/missing' })
    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toMatch(/No page at \/guides\/missing/)
  })

  it('list_pages outlines the navigation', async () => {
    const text = (await call(server.url, 'list_pages', {})).content[0].text
    expect(text).toContain('# Guides (/guides)')
    expect(text).toContain('- Setup (/guides/setup)')
  })
})

describe('/mcp in private mode', () => {
  it('needs a session and passes it to the tools', async () => {
    const privateServer = await startServer({ site, authMode: 'private' })
    try {
      expect((await rpc(privateServer.url, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401)
      const auth = { authorization: `Bearer ${mintToken('reader@example.com')}` }
      const result = await call(privateServer.url, 'read_page', { path: '/guides/setup' }, auth)
      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('# Install Guide')
    }
    finally {
      await privateServer.stop()
    }
  })
})
