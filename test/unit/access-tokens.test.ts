import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findAccessToken, hashAccessToken, isAccessToken } from '../../server/utils/access-tokens'

const dir = mkdtempSync(join(tmpdir(), 'f0-tokens-'))
const TOKEN = 'f0_pat_' + 'a'.repeat(43)
const EXPIRED = 'f0_pat_' + 'b'.repeat(43)

writeFileSync(join(dir, 'tokens.json'), JSON.stringify({
  tokens: [
    { name: 'agent', email: 'reader@example.com', hash: hashAccessToken(TOKEN), expires: '2999-01-01' },
    { name: 'old', email: 'reader@example.com', hash: hashAccessToken(EXPIRED), expires: '2020-01-01' },
    { name: 'broken', email: 'reader@example.com', hash: 'not-a-hash' },
  ],
}))

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('access tokens', () => {
  it('recognises the prefix', () => {
    expect(isAccessToken(TOKEN)).toBe(true)
    expect(isAccessToken('eyJhbGciOi...')).toBe(false)
  })

  it('finds a valid token by its hash', async () => {
    expect((await findAccessToken(TOKEN, dir))?.name).toBe('agent')
  })

  it('refuses expired, unknown and short tokens', async () => {
    expect(await findAccessToken(EXPIRED, dir)).toBeNull()
    expect(await findAccessToken('f0_pat_' + 'c'.repeat(43), dir)).toBeNull()
    expect(await findAccessToken('f0_pat_short', dir)).toBeNull()
  })

  it('refuses everything without a tokens file', async () => {
    expect(await findAccessToken(TOKEN, join(dir, 'missing'))).toBeNull()
  })
})
