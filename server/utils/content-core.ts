/**
 * =============================================================================
 * F0 - CONTENT CORE
 * =============================================================================
 *
 * The one implementation of the rules every part of f0 must agree on:
 * how frontmatter is read, what a page is called, which URL a file has, and
 * where an image path points. Before this module these rules were copied into
 * a dozen endpoints and disagreed (dated posts got different URLs in search
 * and the sidebar, CRLF files lost their frontmatter, `draft: yes` published).
 *
 * Framework-free on purpose: no h3, Nuxt or Vue imports, so the rules can be
 * unit-tested and reused by the CLI.
 */

import { basename, extname } from 'path'
import yaml from 'yaml'

// =============================================================================
// FRONTMATTER
// =============================================================================

export interface Frontmatter {
  /** Parsed YAML mapping; always an object (empty when absent or invalid). */
  data: Record<string, unknown>
  /** The document after the frontmatter block, with LF line endings. */
  body: string
  /** True when a frontmatter block was found and parsed as a mapping. */
  hasFrontmatter: boolean
  /** YAML error message when a block was found but could not be parsed. */
  error?: string
}

// Opening `---` on the first line, closing `---` at the start of a line,
// empty blocks allowed, final newline optional.
const FRONTMATTER_BLOCK = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/

/**
 * Read a Markdown document's frontmatter.
 *
 * Handles a UTF-8 BOM, CRLF line endings, empty or comment-only blocks and a
 * missing final newline. A block that does not parse, or parses to something
 * other than a mapping, is treated as content (as before), never as an error
 * page.
 */
export function readFrontmatter(source: string): Frontmatter {
  let text = source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source
  text = text.replace(/\r\n?/g, '\n')

  const match = text.match(FRONTMATTER_BLOCK)
  if (!match) return { data: {}, body: text, hasFrontmatter: false }

  let parsed: unknown
  try {
    parsed = yaml.parse(match[1] ?? '')
  }
  catch (error) {
    return { data: {}, body: text, hasFrontmatter: false, error: error instanceof Error ? error.message : String(error) }
  }

  // Empty or comment-only block: frontmatter with no keys
  if (parsed === null || parsed === undefined) {
    return { data: {}, body: text.slice(match[0].length), hasFrontmatter: true }
  }
  // A scalar or list is not frontmatter (e.g. a page that opens with a rule)
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { data: {}, body: text, hasFrontmatter: false }
  }
  return { data: parsed as Record<string, unknown>, body: text.slice(match[0].length), hasFrontmatter: true }
}

/**
 * True when frontmatter marks the page as a draft. YAML 1.2 only treats
 * `true` as boolean, so `draft: yes` used to publish; the common spellings
 * of "yes" count too.
 */
export function isDraft(data: Record<string, unknown>): boolean {
  const value = data.draft
  if (value === true || value === 1) return true
  return typeof value === 'string' && /^(true|yes|on|y)$/i.test(value.trim())
}

/** A non-empty string value from frontmatter, trimmed; otherwise null. */
export function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// =============================================================================
// TITLES
// =============================================================================

/**
 * The first level-1 ATX heading (`# Title`) outside fenced code blocks, with
 * a closing `#` sequence removed. Shell comments inside code fences are not
 * titles.
 */
export function firstHeading(body: string): string | null {
  let fence: string | null = null
  for (const line of body.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length && !line.slice(line.indexOf(marker) + marker.length).trim()) fence = null
      continue
    }
    if (fence) continue
    const heading = line.match(/^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/)?.[1]?.trim()
    if (heading) return heading
  }
  return null
}

/**
 * A readable title from a file or folder name:
 * "01-getting-started.md" → "Getting Started", "2026-02-11-hello.md" → "Hello",
 * folder "v1.2" → "V1.2".
 */
export function titleFromFileName(fileName: string): string {
  return stripOrderPrefix(stripPageExtension(basename(fileName.replace(/\\/g, '/'))))
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Page title: frontmatter `title`, then the first H1, then the file name. */
export function resolvePageTitle(doc: { data: Record<string, unknown>, body: string }, fileName: string): string {
  return stringField(doc.data, 'title') ?? firstHeading(doc.body) ?? titleFromFileName(fileName)
}

// =============================================================================
// URLS
// =============================================================================

/** File extensions served as Markdown pages. */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'] as const

/** File extensions that are pages (Markdown and API specs). */
export const PAGE_EXTENSIONS = [...MARKDOWN_EXTENSIONS, '.json'] as const

/**
 * Remove the ordering prefix from a file or folder name: a date
 * ("2026-02-11-") and then a number ("01-"). "2026-02-11-hello" → "hello".
 */
export function stripOrderPrefix(name: string): string {
  return name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/^\d+-/, '')
}

/** Strip a page extension (.md, .markdown, .mdx, .json), case-insensitively. */
export function stripPageExtension(name: string): string {
  const ext = extname(name).toLowerCase()
  return (PAGE_EXTENSIONS as readonly string[]).includes(ext) ? name.slice(0, -ext.length) : name
}

/**
 * The canonical URL path of a content file, from its path relative to the
 * content directory ('/'-separated):
 *   guides/01-intro.md           → /guides/intro
 *   01-guides/02-setup.md        → /guides/setup
 *   blog/2026-02-11-hello.md     → /blog/hello
 *   guides/index.md              → /guides
 *   home.md                      → /     (the site root serves home.md;
 *   index.md                     → /index  a root index.md keeps its name)
 */
export function fileToUrlPath(relativePath: string): string {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (segments.length === 0) return '/'

  const last = stripPageExtension(segments.pop()!)
  const parts = segments.map(stripOrderPrefix)
  const isSectionIndex = last === 'index' && parts.length > 0
  const isHome = last === 'home' && parts.length === 0
  if (!isSectionIndex && !isHome) {
    parts.push(stripOrderPrefix(last))
  }
  return '/' + parts.join('/')
}

/**
 * Names a file or folder answers to in a URL, most specific first: its
 * canonical name (prefixes stripped), its literal name, and the name with
 * only a numeric prefix removed (the alias search used to link dated posts
 * with, "02-11-hello").
 */
export function urlNamesFor(name: string): string[] {
  return [...new Set([stripOrderPrefix(name), name, name.replace(/^\d+-/, '')])]
}

// =============================================================================
// ASSET URLS
// =============================================================================

/**
 * Resolve an image or file reference from content (Markdown body, cover_image,
 * hero_image, _brand.md) to the URL that serves it.
 *
 * One convention everywhere: a relative path points into content/assets, with
 * or without a leading "assets/".
 *   ./assets/images/a.png  → /api/content/assets/images/a.png
 *   assets/images/a.png    → /api/content/assets/images/a.png
 *   images/a.png           → /api/content/assets/images/a.png
 * Absolute URLs, data: URIs, /api/ paths and other root paths (served from
 * public/) are returned unchanged. A path that climbs out with ".." is
 * returned unchanged, not rewritten into the assets route.
 */
export function resolveAssetUrl(value: string): string {
  const src = value.trim()
  if (!src) return src
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('/') || src.startsWith('#')) {
    return src
  }
  const relative = src.replace(/^(\.\/)+/, '')
  if (relative.split('/').includes('..')) return src
  return '/api/content/assets/' + relative.replace(/^assets\//, '')
}

// =============================================================================
// CODE
// =============================================================================

/**
 * The document with fenced code blocks and inline code replaced by spaces
 * (newlines kept, so offsets and line numbers still match the source). For
 * checks that must ignore examples, such as image validation.
 */
export function blankOutCode(markdown: string): string {
  const lines = markdown.split('\n')
  let fence: string | null = null
  const out = lines.map((line) => {
    const marker = line.match(/^[ \t]*(`{3,}|~{3,})/)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = null
      return ' '.repeat(line.length)
    }
    if (marker) {
      fence = marker
      return ' '.repeat(line.length)
    }
    return line
  })
  return out.join('\n').replace(/(`+)[^`\n]*?\1/g, match => ' '.repeat(match.length))
}
