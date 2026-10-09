/**
 * =============================================================================
 * F0 - CONTENT PATH CONFINEMENT
 * =============================================================================
 *
 * Shared guards for user-supplied paths that address the content directory
 * (query parameters such as /api/blog?path= and /feed.xml?path=, and URL slugs).
 *
 * Rules:
 * - Segments starting with '.' or '_' are never public content ('..', '.',
 *   dotfiles, _config.md, _brand.md, _drafts/ ...).
 * - Backslashes and NUL bytes are rejected outright.
 * - The resolved real path (symlinks followed) must stay inside the real
 *   content directory.
 */

import { readdir, realpath, stat } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { urlNamesFor } from './content-core'

/** True for path segments that never address public content. */
export function isHiddenSegment(segment: string): boolean {
  return segment.startsWith('.') || segment.startsWith('_')
}

/** True when any segment of a '/'-separated slug is hidden ('.' or '_' prefix). */
export function hasHiddenSegment(slug: string): boolean {
  return slug.split('/').some(segment => segment !== '' && isHiddenSegment(segment))
}

export type ContentSubdir =
  | { ok: true, rel: string, abs: string, exists: boolean }
  | { ok: false, reason: string }

/**
 * Resolve a user-supplied directory path (e.g. '/blog', 'guides/changelog')
 * against the content directory.
 *
 * Returns ok:false for anything that is malformed or escapes the content
 * directory. A well-formed path to a directory that does not exist returns
 * ok:true with exists:false, so callers can keep returning an empty listing.
 */
export async function resolveContentSubdir(contentDir: string, raw: unknown): Promise<ContentSubdir> {
  if (raw !== undefined && typeof raw !== 'string') {
    return { ok: false, reason: 'path must be a single string' }
  }
  const value = raw ?? ''
  if (value.includes('\0') || value.includes('\\')) {
    return { ok: false, reason: 'invalid characters' }
  }

  const segments = value.split('/').filter(Boolean)
  if (segments.some(isHiddenSegment)) {
    return { ok: false, reason: 'disallowed path segment' }
  }

  const root = await realpath(resolve(contentDir))
  const rel = segments.join('/')
  // Literal path first; otherwise match numbered folders (?path=/blog finds
  // content/02-blog)
  let candidate = segments.length > 0 ? join(root, ...segments) : root
  if (segments.length > 0 && !(await isDirectory(candidate))) {
    candidate = (await resolveUrlDir(root, segments)) ?? candidate
  }

  let real: string
  try {
    real = await realpath(candidate)
  }
  catch {
    // Does not exist (or is unreadable): well-formed but absent.
    return { ok: true, rel, abs: candidate, exists: false }
  }

  if (real !== root && !real.startsWith(root + sep)) {
    return { ok: false, reason: 'outside content directory' }
  }

  return { ok: true, rel, abs: real, exists: await isDirectory(real) }
}

// =============================================================================
// SYMLINK CONFINEMENT FOR CONTENT FILES
// =============================================================================

/** True when realPath is the content root or inside it. */
async function insideContentRoot(realPath: string, contentDir: string): Promise<boolean> {
  const root = await realpath(resolve(contentDir))
  return realPath === root || realPath.startsWith(root + sep)
}

/**
 * True when a file path may be read as content: its real path (symlinks
 * followed) stays inside the content directory. A symlink such as
 * content/guides/leak.md -> ../../secret.md or -> /app/private/allowlist.json
 * is refused. Missing files return false.
 */
export async function isConfinedPath(filePath: string, contentDir: string): Promise<boolean> {
  try {
    return await insideContentRoot(await realpath(filePath), contentDir)
  }
  catch {
    return false
  }
}

/**
 * For directory walkers: regular entries are always allowed; symbolic links
 * only when their target stays inside the content directory.
 */
export async function isConfinedEntry(
  dir: string,
  entry: { name: string, isSymbolicLink(): boolean },
  contentDir: string,
): Promise<boolean> {
  if (!entry.isSymbolicLink()) return true
  return isConfinedPath(join(dir, entry.name), contentDir)
}

// =============================================================================
// URL → DIRECTORY RESOLUTION
// =============================================================================

/** Directory entries sorted by code point, so resolution is deterministic. */
export async function sortedEntries(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }
  catch {
    return []
  }
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(s => s.isDirectory(), () => false)
}

/**
 * Resolve URL segments to a directory under the content directory. Each
 * segment matches a folder by its literal name first, then by its URL name
 * (number or date prefix removed), so /reference finds content/02-reference.
 * Hidden segments never match. Returns null when nothing matches.
 */
export async function resolveUrlDir(contentDir: string, segments: string[]): Promise<string | null> {
  let dir = resolve(contentDir)
  for (const segment of segments) {
    if (!segment || isHiddenSegment(segment)) return null
    const literal = join(dir, segment)
    if (await isDirectory(literal)) {
      dir = literal
      continue
    }
    let found: string | null = null
    for (const name of await sortedEntries(dir)) {
      if (isHiddenSegment(name) || !urlNamesFor(name).includes(segment)) continue
      if (await isDirectory(join(dir, name))) {
        found = join(dir, name)
        break
      }
    }
    if (!found) return null
    dir = found
  }
  return dir
}
