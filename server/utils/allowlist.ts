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
 * The allowlist is cached in memory and reloaded when the file changes
 * or when manually invalidated.
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
let cacheModTime: number = 0

/**
 * Invalidate the allowlist cache
 * Call after admin updates the allowlist
 */
export function invalidateAllowlistCache(): void {
  allowlistCache = null
  cacheModTime = 0
  logger.info('Allowlist cache invalidated')
}

// =============================================================================
// ALLOWLIST LOADING
// =============================================================================

/**
 * Load the allowlist from disk
 * Caches the result and checks file modification time
 * 
 * @param privateDir - Path to private directory
 * @returns AllowlistConfig object
 */
async function loadAllowlist(privateDir: string): Promise<AllowlistConfig> {
  const allowlistPath = join(privateDir, 'allowlist.json')
  
  try {
    // Check if file has changed since last load
    const stats = await stat(allowlistPath)
    const modTime = stats.mtimeMs
    
    // Return cache if file hasn't changed
    if (allowlistCache && modTime <= cacheModTime) {
      return allowlistCache
    }
    
    // Load and parse the allowlist
    const content = await readFile(allowlistPath, 'utf-8')
    const config = JSON.parse(content) as AllowlistConfig
    
    // Normalize emails to lowercase
    if (config.emails) {
      config.emails = config.emails.map(email => email.toLowerCase().trim())
    }
    
    // Normalize domains to lowercase
    if (config.domains) {
      config.domains = config.domains.map(domain => {
        // Ensure domain starts with @
        domain = domain.toLowerCase().trim()
        return domain.startsWith('@') ? domain : `@${domain}`
      })
    }

    // Normalize admins to lowercase
    if (config.admins) {
      config.admins = config.admins.map(email => email.toLowerCase().trim())
    }
    
    // Update cache
    allowlistCache = config
    cacheModTime = modTime
    
    logger.info('Allowlist loaded', {
      emails: config.emails?.length || 0,
      domains: config.domains?.length || 0,
    })
    
    return config
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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

/**
 * Check if an email is allowed to authenticate
 * 
 * @param email - Email address to check
 * @param privateDir - Path to private directory
 * @returns true if email is allowed, false otherwise
 */
export async function isEmailAllowed(
  email: string,
  privateDir: string
): Promise<boolean> {
  // Normalize email
  const normalizedEmail = email.toLowerCase().trim()
  
  // Basic email validation
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return false
  }
  
  try {
    const allowlist = await loadAllowlist(privateDir)
    
    // Check specific email match
    if (allowlist.emails?.includes(normalizedEmail)) {
      return true
    }
    
    // Check domain match
    if (allowlist.domains) {
      const emailDomain = '@' + normalizedEmail.split('@')[1]
      if (allowlist.domains.includes(emailDomain)) {
        return true
      }
    }
    
    return false
  } catch (error) {
    logger.error('Error checking email allowlist', { error: error instanceof Error ? error.message : String(error) })
    // Fail closed - if we can't verify, deny access
    return false
  }
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
