/**
 * =============================================================================
 * F0 - SERVER SETTINGS
 * =============================================================================
 *
 * Every server-only setting is read from the environment when the server
 * starts, never at build time:
 * - a value set only in the runtime environment (Coolify's default) takes
 *   effect, so AUTH_MODE=private can no longer be silently ignored;
 * - secrets are never written into the built bundle or the image.
 *
 * Each setting accepts its NUXT_ name and the short name documented before
 * (NUXT_AUTH_MODE or AUTH_MODE). When both are set, the NUXT_ name wins.
 *
 * FAIL CLOSED: a private site without a usable JWT secret reports a problem.
 * The startup check exits on problems and the auth middleware answers 503,
 * so a misconfigured private site never serves content.
 *
 * Site metadata shown in the browser (NUXT_PUBLIC_SITE_NAME and friends) stays
 * in Nuxt's public runtime config, which already reads NUXT_PUBLIC_* at runtime.
 */

import { tmpdir } from 'os'
import { join } from 'path'

export type AuthMode = 'public' | 'private'

export interface F0Config {
  authMode: AuthMode
  /** Which variable decided the auth mode, for the startup log. */
  authModeSource: 'NUXT_AUTH_MODE' | 'AUTH_MODE' | 'default'
  jwtSecret: string
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
  emailFrom: string
  /** As configured (relative to the working directory, or absolute). */
  contentDir: string
  privateDir: string
  f0Mode: 'docs' | 'blog'
  githubWebhookSecret: string
  /** Where resized image variants are written (never inside contentDir). */
  imageCacheDir: string
  /**
   * Drafts: 'unlisted' (default) serves a draft at its URL, marked noindex,
   * but lists it nowhere; '404' hides it completely (strict wikis).
   */
  drafts: 'unlisted' | '404'
  /** Behavior changes switched off with F0_FLAGS=-name (one release only). */
  disabledChanges: ChangeName[]
  /** "Edit this page" URL template with {path} (relative to contentDir); '' for none. */
  editUrl: string
  /** Misconfigurations that must stop the site from serving (fail closed). */
  problems: string[]
  /** Settings that work but deserve attention. */
  warnings: string[]
}

type Env = Record<string, string | undefined>

/**
 * Behavior changes that ship on by default with a one-release opt-out:
 * F0_FLAGS=-hide-drafts,-nested-config. Security fixes are never listed here.
 */
export const CHANGES = {
  'hide-drafts': 'Drafts (draft: true/yes/on) are left out of the sidebar, sitemap, llms.txt and search',
  'nested-config': 'A page uses the nearest _config.md above it, not only its top-level folder',
} as const
export type ChangeName = keyof typeof CHANGES

/** The JWT secret shipped as a placeholder in earlier versions. */
const PLACEHOLDER_JWT_SECRET = 'change-me-in-production'

/** Used only outside production, so `npm run dev` works without setup. */
const DEVELOPMENT_JWT_SECRET = 'f0-development-only-jwt-secret-do-not-use'

const MIN_JWT_SECRET_LENGTH = 32

/** First non-empty value among the given variable names, and its name. */
function readNamed(env: Env, ...names: string[]): { value: string, name: string } {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return { value, name }
  }
  return { value: '', name: '' }
}

function read(env: Env, ...names: string[]): string {
  return readNamed(env, ...names).value
}

/** Resolve settings from an environment (process.env by default). */
export function resolveF0Config(env: Env = process.env): F0Config {
  const problems: string[] = []
  const warnings: string[] = []
  const production = env.NODE_ENV === 'production'

  // Anything other than "public" is private: a typo must not open the site.
  const authModeSetting = readNamed(env, 'NUXT_AUTH_MODE', 'AUTH_MODE')
  const rawAuthMode = authModeSetting.value.toLowerCase()
  let authMode: AuthMode = 'public'
  if (rawAuthMode && rawAuthMode !== 'public') {
    authMode = 'private'
    if (rawAuthMode !== 'private') {
      warnings.push(`AUTH_MODE "${rawAuthMode}" is not "public" or "private"; treating the site as private`)
    }
  }

  let jwtSecret = read(env, 'NUXT_JWT_SECRET', 'JWT_SECRET')
  if (!jwtSecret || jwtSecret === PLACEHOLDER_JWT_SECRET) {
    if (production) {
      if (authMode === 'private') {
        problems.push('NUXT_JWT_SECRET (or JWT_SECRET) is not set: a private site cannot sign sessions. Set a random value of 32+ characters.')
      }
      jwtSecret = ''
    }
    else {
      jwtSecret = DEVELOPMENT_JWT_SECRET
      if (authMode === 'private') {
        warnings.push('Using a built-in development JWT secret; set NUXT_JWT_SECRET before deploying')
      }
    }
  }
  else if (authMode === 'private' && jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    warnings.push(`NUXT_JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters; use a longer random value`)
  }

  const awsAccessKeyId = read(env, 'NUXT_AWS_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID')
  const awsSecretAccessKey = read(env, 'NUXT_AWS_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY')
  if (authMode === 'private' && (!awsAccessKeyId || !awsSecretAccessKey)) {
    warnings.push('AWS SES credentials are not set: login codes cannot be emailed, so nobody can sign in')
  }

  const f0Mode = read(env, 'NUXT_F0_MODE', 'F0_MODE').toLowerCase() === 'blog' ? 'blog' : 'docs'

  const draftsSetting = read(env, 'NUXT_DRAFTS', 'F0_DRAFTS').toLowerCase()
  const drafts = draftsSetting === '404' ? '404' : 'unlisted'
  if (draftsSetting && draftsSetting !== '404' && draftsSetting !== 'unlisted') {
    warnings.push(`F0_DRAFTS "${draftsSetting}" is not "unlisted" or "404"; using "unlisted"`)
  }

  const editUrl = read(env, 'NUXT_PUBLIC_EDIT_URL', 'F0_EDIT_URL')
  if (editUrl && !editUrl.includes('{path}')) {
    warnings.push('F0_EDIT_URL has no {path} placeholder and is ignored, e.g. https://github.com/acme/docs/edit/main/content/{path}')
  }

  const disabledChanges: ChangeName[] = []
  for (const flag of read(env, 'NUXT_F0_FLAGS', 'F0_FLAGS').split(',').map(f => f.trim()).filter(Boolean)) {
    const name = flag.replace(/^-/, '')
    if (!flag.startsWith('-') || !(name in CHANGES)) {
      warnings.push(`F0_FLAGS entry "${flag}" is not recognised; known opt-outs: ${Object.keys(CHANGES).map(c => `-${c}`).join(', ')}`)
      continue
    }
    disabledChanges.push(name as ChangeName)
    warnings.push(`F0_FLAGS: "${name}" is switched off (${CHANGES[name as ChangeName]}). This opt-out is removed in the next release.`)
  }

  return {
    authMode,
    authModeSource: (authModeSetting.name || 'default') as F0Config['authModeSource'],
    jwtSecret,
    awsRegion: read(env, 'NUXT_AWS_REGION', 'AWS_REGION') || 'us-east-1',
    awsAccessKeyId,
    awsSecretAccessKey,
    emailFrom: read(env, 'NUXT_EMAIL_FROM', 'EMAIL_FROM') || 'no-reply@example.com',
    contentDir: read(env, 'NUXT_CONTENT_DIR', 'CONTENT_DIR') || './content',
    privateDir: read(env, 'NUXT_PRIVATE_DIR', 'PRIVATE_DIR') || './private',
    f0Mode,
    githubWebhookSecret: read(env, 'NUXT_GITHUB_WEBHOOK_SECRET', 'GITHUB_WEBHOOK_SECRET'),
    imageCacheDir: read(env, 'NUXT_IMAGE_CACHE_DIR', 'F0_IMAGE_CACHE_DIR') || join(tmpdir(), 'f0-image-cache'),
    drafts,
    disabledChanges,
    editUrl: editUrl.includes('{path}') ? editUrl : '',
    problems,
    warnings,
  }
}

let resolved: F0Config | null = null

/** Settings for this process, resolved once from process.env. */
export function f0Config(): F0Config {
  if (!resolved) resolved = Object.freeze(resolveF0Config()) as F0Config
  return resolved
}

/** False when this process opted out of a behavior change via F0_FLAGS. */
export function changeEnabled(name: ChangeName): boolean {
  return !f0Config().disabledChanges.includes(name)
}
