import { describe, expect, it } from 'vitest'
import { isSessionRevoked, revokeSession } from '../../server/utils/sessions'

describe('session revocation', () => {
  it('revokes a session by jti until its expiry', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    expect(await isSessionRevoked('jti-a')).toBe(false)
    expect(await revokeSession({ jti: 'jti-a', exp })).toBe(true)
    expect(await isSessionRevoked('jti-a')).toBe(true)
    expect(await isSessionRevoked('jti-b')).toBe(false)
  })

  it('cannot revoke legacy tokens without a jti, and never treats them as revoked', async () => {
    expect(await revokeSession({ exp: Math.floor(Date.now() / 1000) + 60 })).toBe(false)
    expect(await isSessionRevoked(undefined)).toBe(false)
  })
})
