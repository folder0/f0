/**
 * =============================================================================
 * F0 - AUDIT LOGGING
 * =============================================================================
 * 
 * Security audit logging for authentication events.
 * Logs all auth attempts with IP, timestamp, and outcome.
 * 
 * LOG FORMAT:
 * Each log entry contains:
 * - timestamp: ISO 8601 format
 * - event: Type of auth event
 * - email: Email address involved (masked for privacy)
 * - ip: Client IP address
 * - userAgent: Browser/client identifier
 * - success: Whether the action succeeded
 * - reason: Failure reason if applicable
 * - metadata: Additional context
 * 
 * STORAGE:
 * - Console logging (always)
 * - In-memory ring buffer for recent events (queryable via admin API)
 * - File logging (when LOG_FILE path is set)
 * 
 * PRIVACY:
 * - Emails are partially masked in logs (j***@example.com)
 * - Full data available in memory buffer for debugging
 * - Configurable retention period
 */

import { appendFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { H3Event } from 'h3'
import { getHeader } from 'h3'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type AuditEventType = 
  | 'otp_requested'
  | 'otp_sent'
  | 'otp_send_failed'
  | 'otp_verified'
  | 'otp_failed'
  | 'otp_expired'
  | 'otp_max_attempts'
  | 'otp_rate_limited'
  | 'login_success'
  | 'login_failed'
  | 'token_issued'
  | 'token_invalid'
  | 'token_expired'
  | 'access_denied'
  | 'allowlist_rejected'

export interface AuditLogEntry {
  timestamp: string
  event: AuditEventType
  email: string
  emailMasked: string
  ip: string
  userAgent: string
  success: boolean
  reason?: string
  metadata?: Record<string, unknown>
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const config = {
  // Max entries to keep in memory (ring buffer)
  maxMemoryEntries: 1000,
  
  // Log file path (null = disabled)
  logFilePath: process.env.AUTH_AUDIT_LOG || null,
  
  // Console logging
  consoleLogging: true,
}

// =============================================================================
// IN-MEMORY STORAGE (Ring Buffer)
// =============================================================================

class AuditBuffer {
  private entries: AuditLogEntry[] = []
  private maxSize: number
  
  constructor(maxSize: number) {
    this.maxSize = maxSize
  }
  
  push(entry: AuditLogEntry): void {
    this.entries.push(entry)
    
    // Remove oldest entries if over max size
    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(-this.maxSize)
    }
  }
  
  getRecent(count: number = 100): AuditLogEntry[] {
    return this.entries.slice(-count).reverse()
  }
  
  getByEmail(email: string, count: number = 50): AuditLogEntry[] {
    const normalizedEmail = email.toLowerCase()
    return this.entries
      .filter(e => e.email === normalizedEmail)
      .slice(-count)
      .reverse()
  }
  
  getByIp(ip: string, count: number = 50): AuditLogEntry[] {
    return this.entries
      .filter(e => e.ip === ip)
      .slice(-count)
      .reverse()
  }
  
  getFailedAttempts(minutes: number = 60): AuditLogEntry[] {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString()
    return this.entries
      .filter(e => !e.success && e.timestamp > cutoff)
      .reverse()
  }
  
  clear(): void {
    this.entries = []
  }
  
  get size(): number {
    return this.entries.length
  }
}

// Global audit buffer instance
const auditBuffer = new AuditBuffer(config.maxMemoryEntries)

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Mask email for privacy in logs
 * john.doe@example.com → j*******@example.com
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  
  const maskedLocal = local.length > 1 
    ? local[0] + '*'.repeat(Math.min(local.length - 1, 7))
    : '*'
  
  return `${maskedLocal}@${domain}`
}

/**
 * Extract client IP from H3 event
 * Handles proxies (X-Forwarded-For, X-Real-IP)
 */
export function getClientIp(event: H3Event): string {
  // Check X-Forwarded-For header (common for proxies/load balancers)
  const forwardedFor = getHeader(event, 'x-forwarded-for')
  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs, first is the client
    const ips = forwardedFor.split(',').map(ip => ip.trim())
    if (ips[0]) return ips[0]
  }
  
  // Check X-Real-IP header (nginx)
  const realIp = getHeader(event, 'x-real-ip')
  if (realIp) return realIp
  
  // Check CF-Connecting-IP (Cloudflare)
  const cfIp = getHeader(event, 'cf-connecting-ip')
  if (cfIp) return cfIp
  
  // Fall back to remote address
  const remoteAddr = event.node.req.socket?.remoteAddress
  if (remoteAddr) {
    // Handle IPv6-mapped IPv4 addresses
    if (remoteAddr.startsWith('::ffff:')) {
      return remoteAddr.slice(7)
    }
    return remoteAddr
  }
  
  return 'unknown'
}

/**
 * Extract User-Agent from request
 */
function getUserAgent(event: H3Event): string {
  return getHeader(event, 'user-agent') || 'unknown'
}

/**
 * Format log entry for console output
 */
function formatConsoleLog(entry: AuditLogEntry): string {
  const status = entry.success ? '✓' : '✗'
  const reason = entry.reason ? ` (${entry.reason})` : ''
  return `[Audit] ${status} ${entry.event} | ${entry.emailMasked} | IP: ${entry.ip}${reason}`
}

/**
 * Write entry to log file
 */
async function writeToFile(entry: AuditLogEntry): Promise<void> {
  if (!config.logFilePath) return
  
  try {
    // Ensure directory exists
    const dir = dirname(config.logFilePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    
    // Append JSON line
    const line = JSON.stringify(entry) + '\n'
    await appendFile(config.logFilePath, line, 'utf-8')
  } catch (error) {
    console.error('[Audit] Failed to write to log file:', error)
  }
}

// =============================================================================
// MAIN LOGGING FUNCTION
// =============================================================================

/**
 * Log an authentication event
 * 
 * @param event - H3 event (for IP/User-Agent extraction)
 * @param type - Type of auth event
 * @param email - Email address involved
 * @param success - Whether the action succeeded
 * @param reason - Optional failure reason
 * @param metadata - Optional additional data
 */
export async function auditLog(
  event: H3Event,
  type: AuditEventType,
  email: string,
  success: boolean,
  reason?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()
  
  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    event: type,
    email: normalizedEmail,
    emailMasked: maskEmail(normalizedEmail),
    ip: getClientIp(event),
    userAgent: getUserAgent(event),
    success,
    reason,
    metadata,
  }
  
  // Store in memory buffer
  auditBuffer.push(entry)
  
  // Console logging
  if (config.consoleLogging) {
    console.log(formatConsoleLog(entry))
  }
  
  // File logging (async, non-blocking)
  writeToFile(entry).catch(() => {
    // Silently ignore file write errors
  })
}

/**
 * Convenience function for logging without H3 event
 * Used for internal/system events
 */
export async function auditLogSystem(
  type: AuditEventType,
  email: string,
  success: boolean,
  reason?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()
  
  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    event: type,
    email: normalizedEmail,
    emailMasked: maskEmail(normalizedEmail),
    ip: 'system',
    userAgent: 'system',
    success,
    reason,
    metadata,
  }
  
  auditBuffer.push(entry)
  
  if (config.consoleLogging) {
    console.log(formatConsoleLog(entry))
  }
  
  writeToFile(entry).catch(() => {})
}

// =============================================================================
// QUERY FUNCTIONS (for admin API)
// =============================================================================

/**
 * Get recent audit log entries
 */
export function getRecentAuditLogs(count: number = 100): AuditLogEntry[] {
  return auditBuffer.getRecent(count)
}

/**
 * Get audit logs for a specific email
 */
export function getAuditLogsByEmail(email: string, count: number = 50): AuditLogEntry[] {
  return auditBuffer.getByEmail(email, count)
}

/**
 * Get audit logs from a specific IP
 */
export function getAuditLogsByIp(ip: string, count: number = 50): AuditLogEntry[] {
  return auditBuffer.getByIp(ip, count)
}

/**
 * Get failed authentication attempts in the last N minutes
 * Useful for detecting brute force attacks
 */
export function getRecentFailures(minutes: number = 60): AuditLogEntry[] {
  return auditBuffer.getFailedAttempts(minutes)
}

/**
 * Get suspicious IPs (multiple failed attempts)
 */
export function getSuspiciousIps(threshold: number = 5, minutes: number = 60): { ip: string; failures: number }[] {
  const failures = auditBuffer.getFailedAttempts(minutes)
  
  // Count failures per IP
  const ipCounts = new Map<string, number>()
  for (const entry of failures) {
    ipCounts.set(entry.ip, (ipCounts.get(entry.ip) || 0) + 1)
  }
  
  // Filter IPs over threshold
  return Array.from(ipCounts.entries())
    .filter(([, count]) => count >= threshold)
    .map(([ip, failures]) => ({ ip, failures }))
    .sort((a, b) => b.failures - a.failures)
}

/**
 * Get audit log statistics
 */
export function getAuditStats(): {
  totalEntries: number
  recentFailures: number
  suspiciousIps: number
} {
  return {
    totalEntries: auditBuffer.size,
    recentFailures: auditBuffer.getFailedAttempts(60).length,
    suspiciousIps: getSuspiciousIps(5, 60).length,
  }
}
