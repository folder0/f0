/**
 * Input hardening: brand colour injection, bounded and collision-free image
 * variants, readiness body, host-independent sitemap, webhook body limit and
 * delivery dedupe.
 */
import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, prepareSite, startServer, type RunningServer, type Site } from './harness'

const WEBHOOK_SECRET = 'contract-webhook-secret'

let site: Site
let server: RunningServer
const imageCacheDir = mkdtempSync(join(tmpdir(), 'f0-image-cache-'))

beforeAll(async () => {
  site = await prepareSite()

  // Two images with the same file name in different folders
  const { default: sharp } = await import('sharp')
  mkdirSync(join(site.contentDir, 'assets/other'), { recursive: true })
  await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ff0000' } })
    .png().toFile(join(site.contentDir, 'assets/other/pixel.png'))

  server = await startServer({
    site,
    authMode: 'public',
    env: { NUXT_PUBLIC_SITE_URL: '', GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET, NUXT_IMAGE_CACHE_DIR: imageCacheDir },
  })
})

afterAll(async () => {
  await server?.stop()
  site?.cleanup()
  rmSync(imageCacheDir, { recursive: true, force: true })
})

/** GET with an explicit Host header (fetch does not allow overriding it). */
function getWithHost(path: string, host: string): Promise<string> {
  const { port } = new URL(server.url)
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve(body))
    })
    req.on('error', reject)
    req.end()
  })
}

async function imageWidth(response: Response): Promise<number | undefined> {
  const { default: sharp } = await import('sharp')
  return (await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width
}

describe('brand accent colour', () => {
  it('drops an accent_color that tries to break out of the style block', async () => {
    writeFileSync(join(site.contentDir, '_brand.md'), '---\naccent_color: "red;}</style><script>alert(1)</script>"\n---\n')
    await new Promise(r => setTimeout(r, 20))
    const html = await (await get(`${server.url}/`)).text()
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('red;}')
  })

  it('applies a valid accent colour for both themes, readable on each background', async () => {
    writeFileSync(join(site.contentDir, '_brand.md'), '---\naccent_color: "#0d9488"\n---\n')
    await new Promise(r => setTimeout(r, 20))
    const html = await (await get(`${server.url}/`)).text()
    // Teal is too light for text on white (3.7:1): darkened in light mode only
    const light = html.match(/:root:root \{ --color-accent: (#[0-9a-f]{6});/)?.[1]
    const dark = html.match(/:root\[data-theme="dark"\] \{ --color-accent: (#[0-9a-f]{6});/)?.[1]
    expect(light).toBeTruthy()
    expect(light).not.toBe('#0d9488')
    expect(dark).toBe('#0d9488')
    expect(html).toMatch(/--color-accent-dark: #[0-9a-f]{6}/)
  })

  it('keeps the accent as written with accent_exact', async () => {
    writeFileSync(join(site.contentDir, '_brand.md'), '---\naccent_color: "#0d9488"\naccent_exact: true\n---\n')
    await new Promise(r => setTimeout(r, 20))
    const html = await (await get(`${server.url}/`)).text()
    expect(html).toContain(':root:root { --color-accent: #0d9488;')
  })

  it('loads custom_css after the theme stylesheet', async () => {
    writeFileSync(join(site.contentDir, 'assets/custom.css'), ':root { --color-text-primary: #123456; }\n')
    writeFileSync(join(site.contentDir, '_brand.md'), '---\ncustom_css: ./assets/custom.css\n---\n')
    await new Promise(r => setTimeout(r, 20))
    const html = await (await get(`${server.url}/`)).text()
    const theme = html.search(/<link rel="stylesheet" href="\/_nuxt\/entry\.[^"]+\.css"/)
    const custom = html.indexOf('<link rel="stylesheet" href="/api/content/assets/custom.css"')
    expect(theme).toBeGreaterThan(-1)
    expect(custom).toBeGreaterThan(theme)
  })
})

describe('image variants', () => {
  it('snaps arbitrary widths up to an allowed step', async () => {
    const response = await get(`${server.url}/api/content/assets/images/pixel.png?w=500&f=webp`)
    expect(response.status).toBe(200)
    expect(await imageWidth(response)).toBe(800)
  })

  it('keeps same-named images in different folders apart in the variant cache', async () => {
    const a = await get(`${server.url}/api/content/assets/images/pixel.png?w=160`)
    const b = await get(`${server.url}/api/content/assets/other/pixel.png?w=160`)
    const { default: sharp } = await import('sharp')
    const statsA = await sharp(Buffer.from(await a.arrayBuffer())).stats()
    const statsB = await sharp(Buffer.from(await b.arrayBuffer())).stats()
    // pixel.png is blue (#2547b8), other/pixel.png is red: dominant colours differ
    expect(statsA.dominant).not.toEqual(statsB.dominant)
  })

  it('writes variants to the image cache directory, never into content', async () => {
    expect((await get(`${server.url}/api/content/assets/images/pixel.png?w=320&f=webp`)).status).toBe(200)
    expect(readdirSync(imageCacheDir).some(name => name.startsWith('pixel-') && name.endsWith('-w320.webp'))).toBe(true)
    expect(existsSync(join(site.contentDir, '.cache'))).toBe(false)
  })

  it('serves new pixels when a source is replaced with an older modification time', async () => {
    const { default: sharp } = await import('sharp')
    const source = join(site.contentDir, 'assets/other/swap.png')
    const dominant = async () => (await sharp(Buffer.from(await (await get(`${server.url}/api/content/assets/other/swap.png?w=96`)).arrayBuffer())).stats()).dominant

    await sharp({ create: { width: 200, height: 200, channels: 3, background: '#00ff00' } }).png().toFile(source)
    const before = await dominant()
    const { mtime } = statSync(source)

    await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ff00ff' } }).png().toFile(source)
    const older = new Date(mtime.getTime() - 60_000)
    utimesSync(source, older, older)

    expect(await dominant()).not.toEqual(before)
  })
})

describe('readiness probe', () => {
  it('does not disclose the content directory path', async () => {
    const body = await (await get(`${server.url}/_ready`)).text()
    expect(body).not.toContain(site.contentDir)
    expect(JSON.parse(body).status).toBe('ready')
  })
})

describe('sitemap', () => {
  it('uses each request host instead of caching the first one', async () => {
    const poisoned = await getWithHost('/sitemap.xml', 'evil.test')
    expect(poisoned).toContain('http://evil.test/')
    const normal = await getWithHost('/sitemap.xml', 'docs.example.test')
    expect(normal).toContain('http://docs.example.test/')
    expect(normal).not.toContain('evil.test')
  })
})

describe('webhook', () => {
  const sign = (body: string) => `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`

  it('rejects bodies over 1MB with 413', async () => {
    const body = 'x'.repeat(1024 * 1024 + 1)
    const response = await get(`${server.url}/api/webhook`, {
      method: 'POST',
      body,
      headers: { 'x-github-event': 'push', 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
    })
    expect(response.status).toBe(413)
  })

  it('rejects a chunked body over 1MB with 413 and keeps running', async () => {
    const status = await new Promise<number>((resolveStatus, reject) => {
      let answered = false
      const req = request(`${server.url}/api/webhook`, {
        method: 'POST',
        headers: { 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=00', 'content-type': 'application/json' },
      }, (res) => {
        answered = true
        res.resume()
        resolveStatus(res.statusCode ?? 0)
      })
      req.on('error', (error) => {
        // The server closes the connection after its 413. If that close
        // reaches us while we are still sending, the reset can arrive before
        // the response is read: count it as the rejection.
        const code = (error as NodeJS.ErrnoException).code
        if (answered) return
        if (code === 'ECONNRESET' || code === 'EPIPE') resolveStatus(-1)
        else reject(error)
      })
      // Stream 2.5MB without a content-length, one chunk at a time, and stop
      // as soon as the server has answered.
      const chunk = 'x'.repeat(64 * 1024)
      const writeNext = (i: number) => {
        if (answered || i >= 40) return req.end()
        req.write(chunk, () => setImmediate(() => writeNext(i + 1)))
      }
      writeNext(0)
    })
    expect([413, -1]).toContain(status)
    expect((await get(`${server.url}/_health`)).status).toBe(200)
    expect(server.output()).not.toMatch(/uncaught|unhandled/i)
  })

  it('processes a delivery once and ignores redelivery of the same id', async () => {
    const body = JSON.stringify({ ref: 'refs/heads/main' })
    const send = () => get(`${server.url}/api/webhook`, {
      method: 'POST',
      body,
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'delivery-123',
        'x-hub-signature-256': sign(body),
        'content-type': 'application/json',
      },
    })
    const first = await (await send()).json()
    expect(first.message).toBe('Content cache invalidated')
    const second = await (await send()).json()
    expect(second.message).toBe('Duplicate delivery ignored')
  })

  it('still rejects an invalid signature', async () => {
    const response = await get(`${server.url}/api/webhook`, {
      method: 'POST',
      body: '{}',
      headers: { 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=deadbeef' },
    })
    expect(response.status).toBe(401)
  })
})
