/**
 * =============================================================================
 * F0 - ALLOWLIST CHECKER
 * =============================================================================
 *
 * This module manages email allowlist checking for the authentication system.
 *
 * CONSTRAINT COMPLIANCE:
 * - C-SEC-OTP-ALLOWLIST-ONLY-006: Only allowlisted emails can authenticate
 * - C-SEC-PRIVATE-NOT-PUBLIC-005: allowlist.json stored in /private
 *
 * ALLOWLIST FORMAT (allowlist.json):
 * {
 *   "emails": [
 *     "user@example.com",
 *     "admin@company.com"
 *   ],
 *   "domains": [
 *     "@company.com"    // Allows all emails from this domain
 *   ],
 *   "admins": [
 *     "admin@company.com"   // Emails allowed to use /api/admin/* (upload, audit logs).
 *   ]                       // If omitted or empty, nobody is an admin.
 * }
 *
 * The allowlist is cached in memory and reloaded whenever the file's identity
 * changes (mtime, ctime, size or inode), so copies that preserve mtime
 * (cp -p, rsync -t, image layers) are still picked up.
 *
 * If the file later goes missing or stops parsing, the last good copy stays in
 * effect and an error is logged: a typo or a non-atomic save must not log every
 * user out. To revoke everyone, write an allowlist with empty lists.
 */

import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import { logger } from './logger'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Structure of the allowlist.json file
 */
export interface AllowlistConfig {
  // Specific email addresses allowed
  emails?: string[]

  // Domain patterns (e.g., "@company.com" allows all from that domain)
  domains?: string[]

  // Emails permitted to access /api/admin/* endpoints (content upload, audit
  // logs). If absent or empty, nobody is an admin.
  admins?: string[]
}

// =============================================================================
// CACHE
// =============================================================================

let allowlistCache: AllowlistConfig | null = null
// Identity of the file the cache was loaded from.
let cacheStamp = ''
// Identity of a file version that failed to load, so it is not re-read (and
// re-logged) on every request until it changes again.
let failedStamp = ''

/**
 * Invalidate the allowlist cache
 * Call after admin updates the allowlist
 */
export function invalidateAllowlistCache(): void {
  allowlistCache = null
  cacheStamp = ''
  failedStamp = ''
  logger.info('Allowlist cache invalidated')
}

// =============================================================================
// ALLOWLIST LOADING
// =============================================================================

function fileStamp(stats: { mtimeMs: number, ctimeMs: number, size: number, ino: number }): string {
  return `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}:${stats.ino}`
}

/** Normalize one list field; throws if present but not an array of strings. */
function normalizeList(value: unknown, field: string, normalize: (entry: string) => string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new Error(`"${field}" must be an array of strings`)
  }
  return value.map(entry => normalize(entry.toLowerCase().trim()))
}

/** Parse and normalize allowlist.json; throws on malformed content. */
function parseAllowlist(content: string): AllowlistConfig {
  const raw: unknown = JSON.parse(content)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('allowlist.json must contain a JSON object')
  }
  const data = raw as Record<string, unknown>
  return {
    emails: normalizeList(data.emails, 'emails', email => email),
    // Ensure domains start with @
    domains: normalizeList(data.domains, 'domains', domain => domain.startsWith('@') ? domain : `@${domain}`),
    admins: normalizeList(data.admins, 'admins', email => email),
  }
}

/**
 * Load the allowlist from disk
 * Caches the result and reloads when the file's identity changes
 *
 * @param privateDir - Path to private directory
 * @returns AllowlistConfig object
 * @throws when the file is unreadable or malformed and no good copy was ever loaded
 */
async function loadAllowlist(privateDir: string): Promise<AllowlistConfig> {
  const allowlistPath = join(privateDir, 'allowlist.json')
  let stamp = 'missing'

  try {
    stamp = fileStamp(await stat(allowlistPath))

    // Return cache if file hasn't changed
    if (allowlistCache && stamp === cacheStamp) {
      return allowlistCache
    }
    if (allowlistCache && stamp === failedStamp) {
      return allowlistCache
    }

    const config = parseAllowlist(await readFile(allowlistPath, 'utf-8'))

    // Update cache
    allowlistCache = config
    cacheStamp = stamp
    failedStamp = ''

    logger.info('Allowlist loaded', {
      emails: config.emails?.length || 0,
      domains: config.domains?.length || 0,
      admins: config.admins?.length || 0,
    })

    return config
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'

    if (allowlistCache) {
      if (stamp !== failedStamp) {
        failedStamp = stamp
        logger.error('allowlist.json could not be loaded; keeping the last good copy', {
          error: missing ? 'file not found' : (error instanceof Error ? error.message : String(error)),
        })
      }
      return allowlistCache
    }

    if (missing) {
      // File doesn't exist - return empty allowlist
      logger.warn('allowlist.json not found, no users can authenticate')
      return { emails: [], domains: [] }
    }

    logger.error('Error loading allowlist', { error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

// =============================================================================
// MAIN CHECKER
// =============================================================================

export type EmailAccess = 'allowed' | 'denied' | 'unavailable'

/**
 * Check an email against the allowlist, distinguishing "not on the list" from
 * "the allowlist could not be read" so callers can fail closed without
 * treating an operator mistake as a reason to end existing sessions.
 *
 * @param email - Email address to check
 * @param privateDir - Path to private directory
 */
export async function checkEmailAccess(
  email: string,
  privateDir: string
): Promise<EmailAccess> {
  // Normalize email
  const normalizedEmail = email.toLowerCase().trim()

  // Basic email validation
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return 'denied'
  }

  let allowlist: AllowlistConfig
  try {
    allowlist = await loadAllowlist(privateDir)
  } catch (error) {
    logger.error('Error checking email allowlist', { error: error instanceof Error ? error.message : String(error) })
    return 'unavailable'
  }

  // Check specific email match
  if (allowlist.emails?.includes(normalizedEmail)) {
    return 'allowed'
  }

  // Check domain match
  if (allowlist.domains) {
    const emailDomain = '@' + normalizedEmail.split('@')[1]
    if (allowlist.domains.includes(emailDomain)) {
      return 'allowed'
    }
  }

  return 'denied'
}

/**
 * Check if an email is allowed to authenticate
 *
 * @param email - Email address to check
 * @param privateDir - Path to private directory
 * @returns true if email is allowed, false otherwise (including when the
 *          allowlist cannot be read: fail closed)
 */
export async function isEmailAllowed(
  email: string,
  privateDir: string
): Promise<boolean> {
  return (await checkEmailAccess(email, privateDir)) === 'allowed'
}

/**
 * Check if an email is permitted to access admin endpoints.
 *
 * Rules:
 * - The email must first be allowlisted for authentication at all.
 * - The allowlist must declare a non-empty `admins` array containing the email.
 * - If no `admins` array is configured, nobody is an admin.
 *
 * Fails closed on any error (never grants admin on failure).
 *
 * @param email - Email address to check (typically from a verified JWT)
 * @param privateDir - Path to private directory
 */
export async function isEmailAdmin(
  email: string,
  privateDir: string
): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim()

  // Must be an authenticatable user in the first place.
  if (!(await isEmailAllowed(normalizedEmail, privateDir))) {
    return false
  }

  try {
    const allowlist = await loadAllowlist(privateDir)

    // No explicit admin list -> nobody is an admin. Admin endpoints can write
    // content, so they must be granted explicitly (a domain entry would
    // otherwise make every employee an admin).
    if (!allowlist.admins || allowlist.admins.length === 0) {
      return false
    }

    return allowlist.admins.includes(normalizedEmail)
  } catch (error) {
    logger.error('Error checking admin allowlist', { error: error instanceof Error ? error.message : String(error) })
    // Fail closed
    return false
  }
}

/**
 * Get all allowed emails (for admin display)
 * Does not reveal domain patterns, only specific emails
 * 
 * @param privateDir - Path to private directory
 * @returns Array of allowed email addresses
 */
export async function getAllowedEmails(privateDir: string): Promise<string[]> {
  try {
    const allowlist = await loadAllowlist(privateDir)
    return allowlist.emails || []
  } catch {
    return []
  }
}

/**
 * Get allowed domains (for admin display)
 * 
 * @param privateDir - Path to private directory
 * @returns Array of allowed domain patterns
 */
export async function getAllowedDomains(privateDir: string): Promise<string[]> {
  try {
    const allowlist = await loadAllowlist(privateDir)
    return allowlist.domains || []
  } catch {
    return []
  }
}
