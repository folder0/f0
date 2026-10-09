import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveF0Config } from '../../server/utils/f0-config'

const SECRET = 'x'.repeat(40)
const prod = (env: Record<string, string>) => resolveF0Config({ NODE_ENV: 'production', ...env })

describe('resolveF0Config', () => {
  it('defaults to a public docs site', () => {
    const config = prod({})
    expect(config.authMode).toBe('public')
    expect(config.authModeSource).toBe('default')
    expect(config.f0Mode).toBe('docs')
    expect(config.contentDir).toBe('./content')
    expect(config.privateDir).toBe('./private')
    expect(config.awsRegion).toBe('us-east-1')
    expect(config.imageCacheDir).toBe(join(tmpdir(), 'f0-image-cache'))
    expect(config.problems).toEqual([])
  })

  it('takes the image cache directory from either name', () => {
    expect(prod({ F0_IMAGE_CACHE_DIR: '/cache/a' }).imageCacheDir).toBe('/cache/a')
    expect(prod({ NUXT_IMAGE_CACHE_DIR: '/cache/b', F0_IMAGE_CACHE_DIR: '/cache/a' }).imageCacheDir).toBe('/cache/b')
  })

  it('accepts the documented short names at runtime', () => {
    const config = prod({ AUTH_MODE: 'private', JWT_SECRET: SECRET, CONTENT_DIR: '/site/content', F0_MODE: 'blog', GITHUB_WEBHOOK_SECRET: 'hook' })
    expect(config.authMode).toBe('private')
    expect(config.authModeSource).toBe('AUTH_MODE')
    expect(config.jwtSecret).toBe(SECRET)
    expect(config.contentDir).toBe('/site/content')
    expect(config.f0Mode).toBe('blog')
    expect(config.githubWebhookSecret).toBe('hook')
    expect(config.problems).toEqual([])
  })

  it('prefers the NUXT_ name when both are set', () => {
    const config = prod({ NUXT_AUTH_MODE: 'private', AUTH_MODE: 'public', NUXT_JWT_SECRET: SECRET, JWT_SECRET: 'other' })
    expect(config.authMode).toBe('private')
    expect(config.authModeSource).toBe('NUXT_AUTH_MODE')
    expect(config.jwtSecret).toBe(SECRET)
  })

  it('ignores empty values', () => {
    const config = prod({ NUXT_AUTH_MODE: '', AUTH_MODE: 'private', NUXT_JWT_SECRET: ' ', JWT_SECRET: SECRET })
    expect(config.authMode).toBe('private')
    expect(config.jwtSecret).toBe(SECRET)
  })

  it.each(['Private', ' PRIVATE ', 'true', 'yes', 'privat'])('treats AUTH_MODE=%j as private', (value) => {
    expect(prod({ AUTH_MODE: value, JWT_SECRET: SECRET }).authMode).toBe('private')
  })

  it('warns about an unknown auth mode', () => {
    expect(prod({ AUTH_MODE: 'privat', JWT_SECRET: SECRET }).warnings.join()).toMatch(/privat/)
  })

  it.each<Record<string, string>>([{}, { JWT_SECRET: 'change-me-in-production' }])('fails closed for a private site without a real secret (%j)', (env) => {
    const config = prod({ AUTH_MODE: 'private', ...env })
    expect(config.problems).toHaveLength(1)
    expect(config.jwtSecret).toBe('')
  })

  it('does not require a secret for a public site', () => {
    expect(prod({}).problems).toEqual([])
  })

  it('uses a development secret outside production', () => {
    const config = resolveF0Config({ NODE_ENV: 'development', AUTH_MODE: 'private' })
    expect(config.problems).toEqual([])
    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(32)
    expect(config.warnings.join()).toMatch(/development JWT secret/)
  })

  it('warns about a short secret and missing SES credentials', () => {
    const warnings = prod({ AUTH_MODE: 'private', JWT_SECRET: 'short' }).warnings.join('\n')
    expect(warnings).toMatch(/shorter than 32/)
    expect(warnings).toMatch(/SES/)
  })

  it('reads the drafts mode', () => {
    expect(prod({}).drafts).toBe('unlisted')
    expect(prod({ F0_DRAFTS: '404' }).drafts).toBe('404')
    expect(prod({ NUXT_DRAFTS: 'hidden' }).warnings.join()).toMatch(/F0_DRAFTS/)
  })

  it('reads one-release opt-outs from F0_FLAGS and warns about them', () => {
    const config = prod({ F0_FLAGS: '-hide-drafts, -nested-config' })
    expect(config.disabledChanges).toEqual(['hide-drafts', 'nested-config'])
    expect(config.warnings.filter(w => /switched off/.test(w))).toHaveLength(2)
    expect(prod({ F0_FLAGS: 'hide-drafts,-unknown' }).disabledChanges).toEqual([])
    expect(prod({ F0_FLAGS: '-unknown' }).warnings.join()).toMatch(/not recognised/)
  })
})
