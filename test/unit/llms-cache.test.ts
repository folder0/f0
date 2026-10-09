import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCachedLlmsTxt } from '../../server/utils/llms-cache'

const RELATIVE = 'test/fixtures/site/content'

describe('getCachedLlmsTxt', () => {
  it('serves a relative content path from the cache built with the absolute path', async () => {
    const warmed = await getCachedLlmsTxt(resolve(RELATIVE), 'Fixture Docs')
    await new Promise(r => setTimeout(r, 5))
    const served = await getCachedLlmsTxt(RELATIVE, 'Fixture Docs')
    // Same generation timestamp: the second call was a cache hit
    expect(served).toBe(warmed)
    expect(served).toContain('Intro')
  })
})
