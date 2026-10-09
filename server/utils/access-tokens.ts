/**
 * =============================================================================
 * F0 - PERSONAL ACCESS TOKENS (private mode)
 * =============================================================================
 *
 * Long-lived tokens for tools and agents (an MCP client, a sync script) on
 * private sites, where a browser session from the email-code login lasts 72h.
 *
 *   private/tokens.json
 *   { "tokens": [ { "name": "claude-desktop", "email": "ana@acme.com",
 *                   "hash": "<sha256 hex>", "created": "2026-10-09",
 *                   "expires": "2027-10-09" } ] }
 *
 * Only SHA-256 hashes are stored; the token itself is shown once by
 * `npm run token -- create`. A token acts as its email and works only while
 * that email is on the allowlist. Tokens are accepted from the Authorization
 * header only (never from cookies). Delete an entry to revoke it.
 */

import { createHash, timingSafeEqual } from 'crypto'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import { logger } from './logger'

export const ACCESS_TOKEN_PREFIX = 'f0_pat_'

export interface AccessTokenRecord {
  name: string
  email: string
  hash: string
  created?: string
  expires?: string | null
}

let cache: { stamp: string, records: AccessTokenRecord[] } | null = null

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isAccessToken(token: string): boolean {
  return token.startsWith(ACCESS_TOKEN_PREFIX)
}

async function loadRecords(privateDir: string): Promise<AccessTokenRecord[]> {
  const path = join(privateDir, 'tokens.json')
  const stats = await stat(path).catch(() => null)
  if (!stats) {
    cache = null
    return []
  }
  const stamp = `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}:${stats.ino}`
  if (cache?.stamp === stamp) return cache.records

  try {
    const data = JSON.parse(await readFile(path, 'utf-8')) as { tokens?: unknown }
    const records = (Array.isArray(data.tokens) ? data.tokens : []).filter((t): t is AccessTokenRecord =>
      !!t && typeof t === 'object'
      && typeof (t as AccessTokenRecord).hash === 'string' && /^[0-9a-f]{64}$/.test((t as AccessTokenRecord).hash)
      && typeof (t as AccessTokenRecord).email === 'string')
    cache = { stamp, records }
    return records
  }
  catch (error) {
    logger.error('private/tokens.json could not be read; access tokens are refused', { error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

/** The record for a presented token, or null (unknown, malformed or expired). */
export async function findAccessToken(token: string, privateDir: string, now = new Date()): Promise<AccessTokenRecord | null> {
  if (!isAccessToken(token) || token.length < ACCESS_TOKEN_PREFIX.length + 32) return null
  const presented = Buffer.from(hashAccessToken(token), 'hex')
  for (const record of await loadRecords(privateDir)) {
    const stored = Buffer.from(record.hash, 'hex')
    if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) continue
    if (record.expires && new Date(`${record.expires}T23:59:59Z`) < now) return null
    return record
  }
  return null
}
