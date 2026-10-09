/**
 * Black-box contract harness.
 *
 * Boots the BUILT server (.output/server/index.mjs) against a temporary copy of
 * the fixture site and exposes its URL, so tests exercise real HTTP behaviour:
 * middleware order, headers, status codes and response shapes. Run
 * `npm run build` first; `npm run test:contract` does not build.
 *
 * Configuration is passed with NUXT_* variable names, which override runtime
 * config both before and after the runtime-config change. The child process
 * gets a minimal environment so a developer's .env never leaks into a test.
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SERVER_ENTRY = join(ROOT, '.output/server/index.mjs')
const FIXTURES = join(ROOT, 'test/fixtures')

export const TEST_JWT_SECRET = 'contract-test-secret-0123456789abcdef'

export interface Site {
  root: string
  contentDir: string
  privateDir: string
  writeAllowlist(config: { emails?: string[], domains?: string[], admins?: string[] }): void
  cleanup(): void
}

/**
 * Copy a fixture site (test/fixtures/<name>) to a temp dir and add generated
 * binary assets. 'site' is the baseline; 'edge-site' holds content edge cases.
 */
export async function prepareSite(fixture: 'site' | 'edge-site' = 'site'): Promise<Site> {
  const root = mkdtempSync(join(tmpdir(), 'f0-contract-'))
  cpSync(join(FIXTURES, fixture), root, { recursive: true })
  const contentDir = join(root, 'content')
  const privateDir = join(root, 'private')

  const imagesDir = join(contentDir, 'assets/images')
  mkdirSync(imagesDir, { recursive: true })
  const { default: sharp } = await import('sharp')
  await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#2547b8' } })
    .png()
    .toFile(join(imagesDir, 'pixel.png'))

  return {
    root,
    contentDir,
    privateDir,
    writeAllowlist(config) {
      writeFileSync(join(privateDir, 'allowlist.json'), JSON.stringify(config, null, 2))
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

export interface RunningServer {
  url: string
  output(): string
  stop(): Promise<void>
}

export interface ServerOptions {
  site: Site
  authMode?: 'public' | 'private'
  env?: Record<string, string>
  /** Probe that must answer 200 before the server counts as started. */
  waitFor?: '/_ready' | '/_health'
}

export async function startServer({ site, authMode = 'public', env = {}, waitFor = '/_ready' }: ServerOptions): Promise<RunningServer> {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error('No build found at .output/server/index.mjs. Run `npm run build` first.')
  }

  const port = await freePort()
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    NUXT_CONTENT_DIR: site.contentDir,
    NUXT_PRIVATE_DIR: site.privateDir,
    NUXT_AUTH_MODE: authMode,
    NUXT_JWT_SECRET: TEST_JWT_SECRET,
    NUXT_PUBLIC_SITE_NAME: 'Fixture Docs',
    NUXT_PUBLIC_SITE_DESCRIPTION: 'Contract-test fixture',
    NUXT_PUBLIC_SITE_URL: 'https://docs.example.test',
    ...env,
  }

  let output = ''
  const child = spawn(process.execPath, [SERVER_ENTRY], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  // Track exit from the start: a child killed by a signal has exitCode null,
  // and a listener added after the fact would wait forever.
  let exited = false
  const exit = new Promise<void>((done) => {
    child.once('exit', () => {
      exited = true
      done()
    })
  })

  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 20_000
  for (;;) {
    if (exited) {
      throw new Error(`Server exited (${child.exitCode ?? child.signalCode}) before becoming healthy:\n${output}`)
    }
    try {
      const response = await fetch(url + waitFor)
      if (response.ok) break
    }
    catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      await exit
      throw new Error(`Server did not answer ${waitFor} within 20s:\n${output}`)
    }
    await new Promise(r => setTimeout(r, 100))
  }

  return {
    url,
    output: () => output,
    stop: async () => {
      if (exited) return
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
      await exit
      clearTimeout(timer)
    },
  }
}

/** Mint a session token the way the server does (HS256, email claim). */
export function mintToken(email: string, extra: Record<string, unknown> = {}): string {
  return jwt.sign({ email, ...extra }, TEST_JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' })
}

/** fetch that never follows redirects, so tests can assert them. */
export function get(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { redirect: 'manual', ...init })
}
