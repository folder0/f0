/**
 * =============================================================================
 * F0 - MODEL CONTEXT PROTOCOL SERVER
 * =============================================================================
 *
 * POST /mcp  (MCP Streamable HTTP transport, JSON responses)
 *
 * Lets AI tools (Claude, Cursor, VS Code ...) search and read this site:
 *   search_docs  full-text search, best matches with excerpts
 *   read_page    a page's Markdown source by its path
 *   list_pages   the navigation: sections and their pages
 *
 * Add it to a client as an HTTP MCP server at https://<site>/mcp. On private
 * sites it is behind the same login as everything else: send the session
 * token as "Authorization: Bearer <token>".
 *
 * The tools call the site's own endpoints through event.$fetch, so they see
 * exactly what the caller may see (drafts unlisted, private mode enforced).
 * No server-to-client stream: GET answers 405, as the transport allows.
 */

import type { H3Event } from 'h3'
import { logger } from '../utils/logger'

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY_BYTES = 64 * 1024

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message)
  }
}

const TOOLS = [
  {
    name: 'search_docs',
    title: 'Search the documentation',
    description: 'Full-text search over every published page. Returns the best matches with their paths and an excerpt. Read a match in full with read_page.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for' },
        limit: { type: 'number', description: 'Maximum results (1-10, default 5)' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_page',
    title: 'Read a page',
    description: 'The Markdown source of one page, by its path as returned by search_docs or list_pages (for example /guides/setup; "/" is the home page).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Page path, e.g. /guides/setup' },
      },
      required: ['path'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_pages',
    title: 'List sections and pages',
    description: 'The site navigation: each section with its pages and their paths.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
]

interface SidebarItem { title: string, path: string, type: string, children?: SidebarItem[] }

function outline(items: SidebarItem[], depth = 0): string[] {
  return items.flatMap(item => [
    `${'  '.repeat(depth)}- ${item.title}${item.type === 'file' ? ` (${item.path})` : ''}`,
    ...outline(item.children ?? [], depth + 1),
  ])
}

async function callTool(event: H3Event, name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'search_docs') {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) throw new RpcError(-32602, 'search_docs needs a "query" string')
    const limit = Math.min(10, Math.max(1, Number(args.limit) || 5))
    const response = await event.$fetch<{ results: { title: string, path: string, excerpt: string, section: string }[] }>('/api/search', { query: { q: query } })
    const results = response.results.slice(0, limit)
    if (results.length === 0) return `No pages match "${query}".`
    return results.map(r => `## ${r.title}\nPath: ${r.path}\nSection: ${r.section}\n${r.excerpt}`).join('\n\n')
  }

  if (name === 'read_page') {
    const raw = typeof args.path === 'string' ? args.path.trim() : ''
    if (!raw.startsWith('/')) throw new RpcError(-32602, 'read_page needs a "path" starting with /')
    const slug = raw.replace(/^\/+|\/+$/g, '').replace(/\.md$/, '')
    try {
      return await event.$fetch<string>(`/api/content/raw/${slug.split('/').map(encodeURIComponent).join('/')}`, { responseType: 'text' })
    }
    catch {
      throw new ToolError(`No page at ${raw}. Use search_docs or list_pages to find paths.`)
    }
  }

  if (name === 'list_pages') {
    const nav = await event.$fetch<{ topNav: { title: string, path: string, isExternal: boolean }[], sidebar: Record<string, SidebarItem[]> }>('/api/navigation')
    const sections = Object.entries(nav.sidebar).map(([path, items]) => {
      const title = nav.topNav.find(item => item.path === path)?.title ?? (path === '/' ? 'Home' : path)
      return [`# ${title} (${path})`, ...outline(items)].join('\n')
    })
    return sections.join('\n\n') || 'No pages.'
  }

  throw new RpcError(-32602, `Unknown tool: ${name}`)
}

/** A tool failure the model should see (isError), not a protocol error. */
class ToolError extends Error {}

async function handle(event: H3Event, request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case 'initialize': {
      const requested = String(request.params?.protocolVersion ?? '')
      const config = useRuntimeConfig()
      return {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'f0', title: config.public.siteName || 'f0', version: '1.0.0' },
        instructions: 'Documentation for this site. Use search_docs to find pages, read_page to read one, list_pages for the structure.',
      }
    }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS }
    case 'tools/call': {
      const name = String(request.params?.name ?? '')
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>
      try {
        return { content: [{ type: 'text', text: await callTool(event, name, args) }], isError: false }
      }
      catch (error) {
        if (error instanceof ToolError) {
          return { content: [{ type: 'text', text: error.message }], isError: true }
        }
        throw error
      }
    }
    default:
      throw new RpcError(-32601, `Method not found: ${request.method}`)
  }
}

/** Reject cross-site browser requests (DNS rebinding protection required by the spec). */
function originAllowed(event: H3Event): boolean {
  const origin = getHeader(event, 'origin')
  if (!origin) return true
  const siteUrl = useRuntimeConfig().public.siteUrl
  const allowed = new Set([getRequestURL(event).origin])
  if (siteUrl) {
    try {
      allowed.add(new URL(siteUrl).origin)
    }
    catch {
      // ignore an invalid site URL
    }
  }
  return allowed.has(origin)
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    setResponseHeader(event, 'Allow', 'POST')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }
  if (!originAllowed(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const raw = await readRawBody(event, 'utf8')
  if (raw && raw.length > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  }

  let request: JsonRpcRequest
  try {
    request = JSON.parse(raw || '')
  }
  catch {
    return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
  }
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
  }

  // Notifications (no id) get no response body
  if (request.id === undefined) {
    setResponseStatus(event, 202)
    return null
  }

  try {
    return { jsonrpc: '2.0', id: request.id, result: await handle(event, request) }
  }
  catch (error) {
    if (error instanceof RpcError) {
      return { jsonrpc: '2.0', id: request.id, error: { code: error.code, message: error.message } }
    }
    logger.error('MCP request failed', { method: request.method, error: error instanceof Error ? error.message : String(error) })
    return { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Internal error' } }
  }
})
