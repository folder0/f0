#!/usr/bin/env node
/**
 * =============================================================================
 * F0 - FLEET INVENTORY (read-only)
 * =============================================================================
 *
 * Lists every f0 application on a Coolify instance and flags configuration
 * that is unsafe or broken, using Coolify's read-only API. Optionally probes
 * each live site to confirm private sites really require a login.
 *
 * USAGE:
 *   COOLIFY_URL=https://coolify.example.com COOLIFY_TOKEN=... node bin/f0-fleet.mjs [--probe] [--json] [--filter <text>]
 *
 * Use a short-lived token with read access only, and revoke it afterwards.
 *
 * PRIVACY: secret values (JWT secret, AWS keys, webhook secret) are never
 * printed or stored. Only whether they exist and where they are available.
 * The auth mode is compared against the literal "private"; nothing else from
 * environment values is used.
 *
 * FLAGS:
 *   PUBLIC-BUT-MEANT-PRIVATE  AUTH_MODE=private is set without NUXT_AUTH_MODE:
 *                             the runtime ignores it, so the site is public
 *   PROBE-PUBLIC              --probe found a page served without a login on
 *                             a site configured as private
 *   SECRET-AT-BUILDTIME       a secret is available at build time and can end
 *                             up inside the image
 *   PRIVATE-WITHOUT-SECRET    private mode without a NUXT_JWT_SECRET
 *   NO-SITE-URL               NUXT_PUBLIC_SITE_URL missing
 *   HEALTHCHECK-ON-ROOT       Coolify health check probes '/' instead of /_ready
 *   CONTENT-VOLUME            a volume is mounted on /app/content (image
 *                             content is hidden; git pushes won't change it)
 *
 * EXIT CODES: 0 no flags, 1 at least one flag, 2 usage or API error
 */

import { pathToFileURL } from 'node:url'

const SECRET_KEYS = [
  'JWT_SECRET', 'NUXT_JWT_SECRET',
  'AWS_ACCESS_KEY_ID', 'NUXT_AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'NUXT_AWS_SECRET_ACCESS_KEY',
  'GITHUB_WEBHOOK_SECRET',
]

const REPORTED_KEYS = [
  'AUTH_MODE', 'NUXT_AUTH_MODE',
  ...SECRET_KEYS,
  'NUXT_PUBLIC_SITE_URL', 'NUXT_PUBLIC_SITE_NAME',
  'EMAIL_FROM', 'NUXT_EMAIL_FROM', 'F0_MODE',
]

/** Normalise one Coolify env entry across API versions. */
function envFlags(entry) {
  const buildtime = entry.is_buildtime ?? entry.is_build_time ?? false
  // Older Coolify versions have no runtime flag: every variable is at runtime.
  const runtime = entry.is_runtime ?? true
  return { key: entry.key, buildtime: Boolean(buildtime), runtime: Boolean(runtime) }
}

/** Heuristic: is this Coolify application an f0 site? */
export function looksLikeF0(app, envs) {
  const keys = new Set(envs.map(e => e.key))
  if (['NUXT_AUTH_MODE', 'AUTH_MODE', 'NUXT_PUBLIC_SITE_NAME', 'NUXT_PUBLIC_SITE_URL'].some(k => keys.has(k))) return true
  return /f0|docs/i.test(`${app.name ?? ''} ${app.git_repository ?? ''}`)
}

/**
 * Analyse one application. `envs` are the raw Coolify env entries.
 * Returns a report with no secret values in it.
 */
export function analyzeApp(app, envs, storages = []) {
  const byKey = new Map()
  for (const entry of envs) byKey.set(entry.key, { ...envFlags(entry), value: entry.value })

  const valueOf = key => (byKey.get(key)?.value ?? '').trim().toLowerCase()
  const runtimeAuth = byKey.has('NUXT_AUTH_MODE') ? valueOf('NUXT_AUTH_MODE') : null
  const shortAuth = byKey.has('AUTH_MODE') ? valueOf('AUTH_MODE') : null
  const intendedPrivate = runtimeAuth === 'private' || shortAuth === 'private'
  const effectivelyPrivate = runtimeAuth === 'private'

  const flags = []
  if (shortAuth === 'private' && runtimeAuth !== 'private') {
    flags.push({ code: 'PUBLIC-BUT-MEANT-PRIVATE', detail: 'AUTH_MODE=private is ignored at runtime; set NUXT_AUTH_MODE=private (with NUXT_JWT_SECRET and NUXT_AWS_*)' })
  }
  if (intendedPrivate && !byKey.has('NUXT_JWT_SECRET')) {
    flags.push({ code: 'PRIVATE-WITHOUT-SECRET', detail: 'private mode needs NUXT_JWT_SECRET set at runtime' })
  }
  for (const key of SECRET_KEYS) {
    if (byKey.get(key)?.buildtime) {
      flags.push({ code: 'SECRET-AT-BUILDTIME', detail: `${key} is available at build time; untick it and rotate the secret` })
    }
  }
  if (!byKey.has('NUXT_PUBLIC_SITE_URL')) {
    flags.push({ code: 'NO-SITE-URL', detail: 'set NUXT_PUBLIC_SITE_URL for canonical links, sitemap and feeds' })
  }
  if (app.health_check_enabled && (app.health_check_path ?? '/') === '/') {
    flags.push({ code: 'HEALTHCHECK-ON-ROOT', detail: 'health check probes "/"; use /_ready on 127.0.0.1' })
  }
  if (storages.some(s => (s.mount_path ?? s.mountPath ?? '').replace(/\/+$/, '') === '/app/content')) {
    flags.push({ code: 'CONTENT-VOLUME', detail: 'a volume is mounted on /app/content; content baked into the image is hidden' })
  }

  return {
    uuid: app.uuid,
    name: app.name,
    url: (app.fqdn ?? '').split(',')[0] || null,
    buildPack: app.build_pack ?? null,
    repository: app.git_repository ?? null,
    branch: app.git_branch ?? null,
    healthCheck: app.health_check_enabled ? (app.health_check_path ?? '/') : 'disabled',
    intendedPrivate,
    effectivelyPrivate,
    env: REPORTED_KEYS.filter(k => byKey.has(k)).map((k) => {
      const { buildtime, runtime } = byKey.get(k)
      return { key: k, buildtime, runtime }
    }),
    flags,
  }
}

/** Passive check: does a content page require a login? */
export async function probeSite(url, fetchImpl = fetch) {
  if (!url) return { status: 'no-url' }
  const target = new URL('/api/navigation', url).toString()
  try {
    const response = await fetchImpl(target, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    return { status: response.status === 401 ? 'login-required' : response.ok ? 'public' : `http-${response.status}` }
  }
  catch (error) {
    return { status: 'unreachable', error: error instanceof Error ? error.message : String(error) }
  }
}

async function api(base, token, path) {
  const response = await fetch(new URL(`/api/v1${path}`, base), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`GET ${path} -> HTTP ${response.status}`)
  return response.json()
}

export async function inventory({ base, token, probe = false, filter = '' }) {
  const apps = await api(base, token, '/applications')
  const reports = []
  for (const app of apps) {
    if (filter && !`${app.name} ${app.fqdn ?? ''}`.toLowerCase().includes(filter.toLowerCase())) continue
    const envs = await api(base, token, `/applications/${app.uuid}/envs`).catch(() => [])
    if (!looksLikeF0(app, envs)) continue
    const storages = app.persistent_storages ?? app.persistentStorages ?? []
    const report = analyzeApp(app, envs, storages)
    if (probe) {
      report.probe = await probeSite(report.url)
      if (report.intendedPrivate && report.probe.status === 'public') {
        report.flags.unshift({ code: 'PROBE-PUBLIC', detail: 'site is configured as private but serves content without a login' })
      }
    }
    reports.push(report)
  }
  return reports
}

function printTable(reports) {
  for (const r of reports) {
    const mode = r.effectivelyPrivate ? 'private' : r.intendedPrivate ? 'PUBLIC (meant private)' : 'public'
    console.log(`\n${r.name}  ${r.url ?? ''}`)
    console.log(`  build: ${r.buildPack ?? '?'}  repo: ${r.repository ?? '?'}@${r.branch ?? '?'}  health: ${r.healthCheck}  mode: ${mode}${r.probe ? `  probe: ${r.probe.status}` : ''}`)
    console.log(`  env: ${r.env.map(e => `${e.key}${e.buildtime ? '[build]' : ''}${e.runtime ? '' : '[no-runtime]'}`).join(', ') || '(none)'}`)
    for (const f of r.flags) console.log(`  ! ${f.code}: ${f.detail}`)
  }
  const flagged = reports.filter(r => r.flags.length > 0).length
  console.log(`\n${reports.length} f0 site(s), ${flagged} with flags`)
}

async function main(argv) {
  const args = argv.slice(2)
  const json = args.includes('--json')
  const probe = args.includes('--probe')
  const filterIndex = args.indexOf('--filter')
  const filter = filterIndex >= 0 ? args[filterIndex + 1] ?? '' : ''
  const base = process.env.COOLIFY_URL
  const token = process.env.COOLIFY_TOKEN
  if (!base || !token) {
    console.error('Set COOLIFY_URL and COOLIFY_TOKEN (read-only). Usage: node bin/f0-fleet.mjs [--probe] [--json] [--filter <text>]')
    return 2
  }
  let reports
  try {
    reports = await inventory({ base, token, probe, filter })
  }
  catch (error) {
    console.error(`Coolify API error: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  if (json) console.log(JSON.stringify(reports, null, 2))
  else printTable(reports)
  return reports.some(r => r.flags.length > 0) ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then(code => process.exit(code))
}
