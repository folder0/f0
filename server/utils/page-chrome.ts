/**
 * =============================================================================
 * F0 - PAGE CHROME (breadcrumbs, previous/next, edit link)
 * =============================================================================
 *
 * Derived from the sidebar, so the reading order is exactly what readers see
 * in the navigation: frontmatter order, then title, folders depth-first.
 * Drafts are not in the sidebar, so they never appear as previous or next.
 */

import { relative, sep } from 'path'
import { buildNavigation, type SidebarItem, type TopNavItem } from './navigation'
import { f0Config } from './f0-config'

export interface PageLink {
  title: string
  /** URL of the page, or null for a folder without its own page */
  path: string | null
}

export interface PageChrome {
  breadcrumbs: PageLink[]
  prev: PageLink | null
  next: PageLink | null
  editUrl: string | null
}

function normalize(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed || '/'
}

/** The top navigation section a URL belongs to (longest matching prefix). */
function sectionFor(topNav: TopNavItem[], path: string): TopNavItem | null {
  let best: TopNavItem | null = null
  for (const item of topNav) {
    if (item.isExternal || item.path === '/') continue
    const base = normalize(item.path)
    if ((path === base || path.startsWith(base + '/')) && (!best || base.length > normalize(best.path).length)) {
      best = item
    }
  }
  return best
}

/** Pages in reading order (depth-first through folders). */
function flatten(items: SidebarItem[], out: { title: string, path: string }[] = []) {
  for (const item of items) {
    if (item.type === 'file') out.push({ title: item.title, path: normalize(item.path) })
    if (item.children?.length) flatten(item.children, out)
  }
  return out
}

/** Folder titles leading to `path` in the sidebar tree. */
function folderTrail(items: SidebarItem[], path: string, trail: SidebarItem[] = []): SidebarItem[] | null {
  for (const item of items) {
    if (item.type === 'file' && normalize(item.path) === path) return trail
    if (item.children?.length) {
      const found = folderTrail(item.children, path, [...trail, item])
      if (found) return found
    }
  }
  return null
}

/**
 * "Edit this page" URL from NUXT_PUBLIC_EDIT_URL / F0_EDIT_URL, a template
 * with {path} for the file's path relative to the content directory, e.g.
 * https://github.com/acme/docs/edit/main/content/{path}
 */
function editUrlFor(contentDir: string, filePath: string): string | null {
  const template = f0Config().editUrl
  if (!template) return null
  const rel = relative(contentDir, filePath).split(sep).join('/')
  if (!rel || rel.startsWith('..')) return null
  return template.replace('{path}', rel.split('/').map(encodeURIComponent).join('/'))
}

/** Breadcrumbs, previous/next and edit link for the page at `urlPath`. */
export async function pageChrome(contentDir: string, urlPath: string, filePath: string): Promise<PageChrome> {
  const path = normalize(urlPath)
  const chrome: PageChrome = { breadcrumbs: [], prev: null, next: null, editUrl: editUrlFor(contentDir, filePath) }

  const nav = await buildNavigation(contentDir)
  const section = sectionFor(nav.topNav, path)
  const items = nav.sidebar.get(section?.path ?? '/') ?? []

  if (section) {
    chrome.breadcrumbs.push({ title: section.title, path: normalize(section.path) })
  }
  for (const folder of folderTrail(items, path) ?? []) {
    chrome.breadcrumbs.push({ title: folder.title, path: null })
  }

  const pages = flatten(items)
  const index = pages.findIndex(page => page.path === path)
  if (index >= 0) {
    chrome.prev = pages[index - 1] ?? null
    chrome.next = pages[index + 1] ?? null
  }
  else if (section && path === normalize(section.path) && pages.length > 0) {
    // A section's landing page leads into its first page
    chrome.next = pages[0] ?? null
  }

  return chrome
}
