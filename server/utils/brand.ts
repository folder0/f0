/**
 * =============================================================================
 * F0 - BRAND CONFIGURATION
 * =============================================================================
 * 
 * Reads `_brand.md` from the content root for white-label configuration.
 * All fields are optional. Defaults produce a clean, unbranded f0 instance.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-BRAND-CONTENT-ONLY-011: All branding is expressible through content
 *   directory files and environment variables. No code changes for white-labeling.
 * - C-ARCH-FILESYSTEM-SOT-001: Brand config lives in the content filesystem.
 * - C-OPS-ZERO-CONFIG-DEFAULT-008: Missing _brand.md produces a working site.
 * 
 * DESIGN:
 * - `_brand.md` follows the same convention as `_config.md` — frontmatter-only.
 * - Brand config is per-deployment, not per-environment. A studio might run
 *   the same Docker image for 10 clients, each with a different content volume.
 * - Cached using mtime comparison, same pattern as content cache.
 */

import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { logger } from './logger'
import { readFrontmatter, resolveAssetUrl as resolveContentAssetUrl } from './content-core'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface FooterLink {
  label: string
  url: string
}

export interface BrandConfig {
  /** Path to logo image (relative to content dir, e.g. ./assets/images/logo.svg) */
  logo: string
  /** Path to dark mode logo (falls back to logo) */
  logoDark: string
  /** Path to favicon image */
  favicon: string
  /** Accent color hex (e.g. "#2563eb") */
  accentColor: string
  /** Header display style */
  headerStyle: 'logo_only' | 'logo_and_text' | 'text_only'
  /** Footer copyright/text */
  footerText: string
  /** Footer navigation links */
  footerLinks: FooterLink[]
  /** Path to custom CSS file (relative to content dir) */
  customCss: string
  /** OpenGraph default image path */
  ogImage: string
}

// =============================================================================
// DEFAULTS
// =============================================================================

const DEFAULT_BRAND: BrandConfig = {
  logo: '',
  logoDark: '',
  favicon: '',
  accentColor: '',
  headerStyle: 'text_only',
  footerText: '',
  footerLinks: [],
  customCss: '',
  ogImage: '',
}

// =============================================================================
// CSS COLOUR VALIDATION
// =============================================================================

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNCTIONAL_COLOR = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[-+0-9a-z.,%\s/]*\)$/i
const NAMED_COLOR = /^[a-z]{3,30}$/i

/**
 * Return the value if it is a syntactically valid CSS colour (hex, a colour
 * function, or a named colour), otherwise null. The allowed character sets
 * exclude ; { } < > quotes and backslashes, so the result cannot break out of
 * a CSS declaration or a <style> element.
 */
export function sanitizeCssColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const color = value.trim()
  if (color.length === 0 || color.length > 64) return null
  if (HEX_COLOR.test(color) || FUNCTIONAL_COLOR.test(color) || NAMED_COLOR.test(color)) return color
  return null
}

// =============================================================================
// MTIME-BASED CACHE
// =============================================================================

let brandCache: BrandConfig | null = null
let brandMtime: number = 0

/**
 * Resolve a content-relative path (./assets/images/logo.svg) to an API URL.
 */
function resolveAssetUrl(relativePath: string): string {
  // Same rule as images in Markdown; absolute URLs (a CDN logo) pass through
  return relativePath ? resolveContentAssetUrl(relativePath) : ''
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get the brand configuration, reading from _brand.md with mtime caching.
 * 
 * @param contentDir - Path to the content directory
 * @returns BrandConfig with all fields populated (defaults for missing values)
 */
export function getBrandConfig(contentDir: string): BrandConfig {
  const brandPath = join(contentDir, '_brand.md')

  // Check if _brand.md exists
  if (!existsSync(brandPath)) {
    if (brandCache) return brandCache
    brandCache = { ...DEFAULT_BRAND }
    return brandCache
  }

  // Check mtime for cache validity
  try {
    const stats = statSync(brandPath)
    if (brandCache && stats.mtimeMs === brandMtime) {
      return brandCache
    }

    // Parse _brand.md
    const doc = readFrontmatter(readFileSync(brandPath, 'utf-8'))
    if (!doc.hasFrontmatter) {
      brandCache = { ...DEFAULT_BRAND }
      brandMtime = stats.mtimeMs
      return brandCache
    }

    const fm = doc.data as Record<string, any>

    // Parse footer links
    let footerLinks: FooterLink[] = []
    if (Array.isArray(fm.footer_links)) {
      footerLinks = fm.footer_links
        .filter((l: unknown) => l && typeof l === 'object' && 'label' in (l as object) && 'url' in (l as object))
        .map((l: Record<string, string>) => ({
          label: String(l.label || ''),
          url: String(l.url || ''),
        }))
    }

    // accent_color is interpolated into a <style> block, so only accept values
    // that parse as a CSS colour. Anything else is dropped with a warning.
    let accentColor = ''
    if (fm.accent_color === null) {
      logger.warn('_brand.md accent_color is empty. Quote hex values: accent_color: "#2563eb"', { path: brandPath })
    }
    else if (fm.accent_color !== undefined) {
      const parsed = sanitizeCssColor(fm.accent_color)
      if (parsed) {
        accentColor = parsed
      }
      else {
        logger.warn('_brand.md accent_color is not a valid CSS colour and was ignored', { path: brandPath, value: String(fm.accent_color).slice(0, 64) })
      }
    }

    brandCache = {
      logo: resolveAssetUrl(fm.logo as string || ''),
      logoDark: resolveAssetUrl(fm.logo_dark as string || fm.logo as string || ''),
      favicon: resolveAssetUrl(fm.favicon as string || ''),
      accentColor,
      headerStyle: (['logo_only', 'logo_and_text', 'text_only'].includes(fm.header_style as string)
        ? fm.header_style as BrandConfig['headerStyle']
        : 'text_only'),
      footerText: (fm.footer_text as string) || '',
      footerLinks,
      customCss: resolveAssetUrl(fm.custom_css as string || ''),
      ogImage: resolveAssetUrl(fm.og_image as string || ''),
    }

    brandMtime = stats.mtimeMs
    logger.info('Brand config loaded', { path: brandPath })
    return brandCache

  } catch (error) {
    logger.warn('Failed to read _brand.md', {
      path: brandPath,
      error: error instanceof Error ? error.message : String(error),
    })
    brandCache = { ...DEFAULT_BRAND }
    return brandCache
  }
}

/**
 * Invalidate the brand cache.
 */
export function invalidateBrandCache(): void {
  brandCache = null
  brandMtime = 0
}
