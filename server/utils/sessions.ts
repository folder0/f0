/**
 * =============================================================================
 * F0 - SESSION REVOCATION
 * =============================================================================
 *
 * Session JWTs carry a random `jti`. Logging out records that id as revoked
 * until the token would have expired anyway, so a copied token or the httpOnly
 * cookie stops working immediately.
 *
 * LIMITATION: revocations live in the process-local storage adapter, so they
 * are lost on restart and not shared between replicas. Tokens issued before
 * `jti` existed cannot be revoked individually; they expire within 72h.
 */

import { storage } from './storage'

function revokedKey(jti: string): string {
  return `revoked:${jti}`
}

/**
 * Revoke a verified session until its natural expiry.
 * Returns false when the token has no jti/exp (legacy token).
 */
export async function revokeSession(payload: { jti?: string, exp?: number }): Promise<boolean> {
  if (!payload.jti || !payload.exp) return false
  const ttlSeconds = Math.max(1, payload.exp - Math.floor(Date.now() / 1000))
  await storage.set(revokedKey(payload.jti), true, ttlSeconds)
  return true
}

/** True when the session with this jti has been revoked. */
export async function isSessionRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false
  return storage.exists(revokedKey(jti))
}
