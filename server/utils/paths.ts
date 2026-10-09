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

import { realpath, stat } from 'fs/promises'
import { join, resolve, sep } from 'path'

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
  const candidate = segments.length > 0 ? join(root, ...segments) : root
  const rel = segments.join('/')

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

  const isDirectory = await stat(real).then(s => s.isDirectory(), () => false)
  return { ok: true, rel, abs: real, exists: isDirectory }
}
