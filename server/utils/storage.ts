/**
 * =============================================================================
 * F0 - STORAGE ABSTRACTION LAYER
 * =============================================================================
 * 
 * This module provides an abstract storage interface for OTP codes and rate
 * limiting. The default implementation uses in-memory storage, which works
 * perfectly for single-instance deployments.
 * 
 * WHY THIS ABSTRACTION EXISTS:
 * - Constraint C-OPS-ZERO-CONFIG-DEFAULT-008 requires zero config by default
 * - In-memory works for MVP without requiring a database
 * - When scaling horizontally, swap MemoryStorage for SqliteStorage or RedisStorage
 * - The interface is simple: set, get, delete, increment (for rate limiting)
 * 
 * FUTURE SQLITE MIGRATION:
 * When you need persistence or horizontal scaling, implement SqliteStorage:
 * 1. Install better-sqlite3: npm install better-sqlite3
 * 2. Create SqliteStorage class implementing StorageAdapter
 * 3. Change the export at the bottom of this file
 * 
 * TTL (Time-To-Live):
 * - OTPs expire after 5 minutes (300 seconds)
 * - Rate limit windows are 5 minutes
 * - Expired entries are cleaned up lazily on access
 */

/**
 * Interface for storage adapters
 * Any storage backend must implement these methods
 */
export interface StorageAdapter {
  /**
   * Store a value with optional TTL
   * @param key - Unique key for the value
   * @param value - Any JSON-serializable value
   * @param ttlSeconds - Optional time-to-live in seconds
   */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>
  
  /**
   * Retrieve a value by key
   * Returns null if key doesn't exist or has expired
   */
  get<T = unknown>(key: string): Promise<T | null>
  
  /**
   * Delete a value by key
   */
  delete(key: string): Promise<void>
  
  /**
   * Increment a numeric counter
   * Creates the key with value 1 if it doesn't exist
   * Useful for rate limiting
   * @returns The new value after incrementing
   */
  increment(key: string, ttlSeconds?: number): Promise<number>
  
  /**
   * Check if a key exists and hasn't expired
   */
  exists(key: string): Promise<boolean>
}

/**
 * Entry stored in memory with expiration tracking
 */
interface StorageEntry {
  value: unknown
  expiresAt: number | null  // Unix timestamp in ms, null = never expires
}

/**
 * In-memory storage implementation
 * 
 * LIMITATIONS:
 * - Data lost on server restart
 * - Not shared across multiple server instances
 * - Memory grows with usage (cleaned up lazily)
 * 
 * SUITABLE FOR:
 * - Single-instance deployments (Coolify, single Docker container)
 * - Development and testing
 * - MVP phase
 */
class MemoryStorage implements StorageAdapter {
  private store: Map<string, StorageEntry> = new Map()
  
  // Periodic cleanup interval (every 60 seconds)
  private cleanupInterval: NodeJS.Timeout | null = null
  
  constructor() {
    // Start periodic cleanup to prevent memory leaks from expired entries
    this.startCleanup()
  }
  
  /**
   * Start periodic cleanup of expired entries
   * Runs every 60 seconds to remove stale data
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.store.entries()) {
        if (entry.expiresAt !== null && entry.expiresAt <= now) {
          this.store.delete(key)
        }
      }
    }, 60000) // Every 60 seconds
    
    // Don't let cleanup interval prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref()
    }
  }
  
  /**
   * Check if an entry has expired
   */
  private isExpired(entry: StorageEntry): boolean {
    if (entry.expiresAt === null) return false
    return Date.now() >= entry.expiresAt
  }
  
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds 
      ? Date.now() + (ttlSeconds * 1000)
      : null
    
    this.store.set(key, { value, expiresAt })
  }
  
  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    
    if (!entry) return null
    
    // Lazy cleanup: delete if expired
    if (this.isExpired(entry)) {
      this.store.delete(key)
      return null
    }
    
    return entry.value as T
  }
  
  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
  
  async increment(key: string, ttlSeconds?: number): Promise<number> {
    const entry = this.store.get(key)
    
    // If entry doesn't exist or is expired, start fresh at 1
    if (!entry || this.isExpired(entry)) {
      await this.set(key, 1, ttlSeconds)
      return 1
    }
    
    // Increment existing value
    const newValue = (typeof entry.value === 'number' ? entry.value : 0) + 1
    
    // Keep the original expiration time when incrementing
    this.store.set(key, { value: newValue, expiresAt: entry.expiresAt })
    
    return newValue
  }
  
  async exists(key: string): Promise<boolean> {
    const entry = this.store.get(key)
    if (!entry) return false
    if (this.isExpired(entry)) {
      this.store.delete(key)
      return false
    }
    return true
  }
  
  /**
   * Cleanup method for graceful shutdown
   * Call this when the server is shutting down
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.store.clear()
  }
}

// =============================================================================
// STORAGE INSTANCE EXPORT
// =============================================================================
// 
// This is the single storage instance used throughout the application.
// To switch to SQLite or Redis, change this line to:
// export const storage: StorageAdapter = new SqliteStorage()
// export const storage: StorageAdapter = new RedisStorage(redisClient)

export const storage: StorageAdapter = new MemoryStorage()

// =============================================================================
// HELPER FUNCTIONS FOR COMMON OPERATIONS
// =============================================================================

/**
 * Generate a storage key for OTP codes
 * @param email - User's email address
 */
export function otpKey(email: string): string {
  return `otp:${email.toLowerCase()}`
}

/**
 * Generate a storage key for rate limiting
 * @param email - User's email address
 * @param action - The action being rate limited (e.g., 'verify', 'request')
 */
export function rateLimitKey(email: string, action: string): string {
  return `ratelimit:${action}:${email.toLowerCase()}`
}

/**
 * OTP configuration constants
 * Aligned with security constraint C-SEC-OTP-RATE-LIMIT-007
 */
export const OTP_CONFIG = {
  // OTP expires after 5 minutes
  TTL_SECONDS: 300,
  
  // Max verification attempts before lockout
  MAX_VERIFY_ATTEMPTS: 3,
  
  // Rate limit window (5 minutes)
  RATE_LIMIT_WINDOW_SECONDS: 300,
  
  // Max OTP requests per window
  MAX_OTP_REQUESTS: 3,
  
  // OTP length (8 digits as per PRD)
  CODE_LENGTH: 8,
} as const
