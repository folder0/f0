/**
 * =============================================================================
 * F0 - PRIVATE RESPONSE HEADERS
 * =============================================================================
 *
 * Shared by the auth middleware (which runs before any handler and also covers
 * login redirects and 401s) and the private-cache plugin (which runs after
 * handlers that set their own public Cache-Control).
 */

import type { H3Event } from 'h3'

/** Add header names to Vary without duplicating ones already present. */
export function mergeVary(event: H3Event, ...names: string[]): void {
  const current = event.node.res.getHeader('vary')
  const existing = (Array.isArray(current) ? current.join(',') : String(current ?? ''))
    .split(',').map(v => v.trim()).filter(Boolean)
  const lower = new Set(existing.map(v => v.toLowerCase()))
  for (const name of names) {
    if (!lower.has(name.toLowerCase())) {
      existing.push(name)
      lower.add(name.toLowerCase())
    }
  }
  setResponseHeader(event, 'Vary', existing.join(', '))
}

/** Keep a response out of shared caches (CDNs, proxies). */
export function markPrivateResponse(event: H3Event): void {
  if (event.node.res.headersSent) return
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  mergeVary(event, 'Cookie', 'Authorization')
}
