/**
 * =============================================================================
 * F0 - HTML SANITIZER (STOPGAP DENYLIST)
 * =============================================================================
 *
 * Markdown is rendered with allowDangerousHtml, so raw HTML written by authors
 * (or uploaded through the admin API) reaches readers. This rehype plugin runs
 * after rehype-raw has parsed that raw HTML into real nodes, and removes the
 * constructs that execute script:
 *
 * - elements: script, object, embed, applet, base, meta, link, frame, frameset
 * - SVG animation elements that retarget href (animate/set ... attributeName=href)
 * - attributes: every on* event handler, iframe srcdoc, form action, formaction
 * - URLs: javascript: and vbscript: anywhere; data: except images in img/source
 *
 * It is a denylist on purpose: it must not change legitimate output (callouts,
 * embeds, picture/srcset, code blocks, author styling). It runs after heading
 * ids and the TOC are computed, so anchors cannot move. The full allowlist
 * schema arrives with the unified mdast pipeline.
 */

import type { Element, Root } from 'hast'
import { SKIP, visit } from 'unist-util-visit'

const REMOVED_ELEMENTS = new Set([
  'script', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'frame', 'frameset',
])

const SVG_ANIMATION_ELEMENTS = new Set(['animate', 'set', 'animatemotion', 'animatetransform'])

/** hast property names that hold a single URL. */
const URL_PROPERTIES = [
  'href', 'src', 'cite', 'background', 'poster', 'data', 'xLinkHref',
  'longDesc', 'codeBase', 'manifest', 'dynsrc', 'lowsrc', 'ping',
]

/** Elements whose src/srcset may legitimately use a data:image URL. */
const DATA_IMAGE_ELEMENTS = new Set(['img', 'source'])

/**
 * True when a URL would execute script or embed an arbitrary document.
 * Browsers ignore ASCII whitespace and control characters inside the scheme
 * ("java\tscript:"), so those are stripped before checking.
 */
export function isDangerousUrl(value: string, tagName: string, property: string): boolean {
  // eslint-disable-next-line no-control-regex
  const normalized = value.replace(/[\u0000- \u007F]/g, '').toLowerCase()
  if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) return true
  if (normalized.startsWith('data:')) {
    const imageContext = DATA_IMAGE_ELEMENTS.has(tagName) && (property === 'src' || property === 'srcSet')
    return !(imageContext && normalized.startsWith('data:image/'))
  }
  return false
}

function propertyAsStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (value === null || value === undefined || typeof value === 'boolean') return []
  return [String(value)]
}

function cleanElement(node: Element): void {
  const props = node.properties ?? {}
  const tag = node.tagName.toLowerCase()

  for (const name of Object.keys(props)) {
    // Event handler attributes: onclick, onerror, onload, ... (hast: onClick, onError)
    if (/^on/i.test(name)) {
      delete props[name]
      continue
    }
    if (name === 'formAction' || (tag === 'form' && name === 'action') || (tag === 'iframe' && name === 'srcDoc')) {
      delete props[name]
    }
  }

  for (const name of URL_PROPERTIES) {
    if (!(name in props)) continue
    if (propertyAsStrings(props[name]).some(url => isDangerousUrl(url, tag, name))) {
      delete props[name]
    }
  }

  if ('srcSet' in props) {
    const candidates = propertyAsStrings(props.srcSet).join(',').split(',')
    const urls = candidates.map(candidate => candidate.trim().split(/\s+/)[0]).filter(Boolean)
    if (urls.some(url => isDangerousUrl(url, tag, 'srcSet'))) {
      delete props.srcSet
    }
  }
}

/** rehype plugin: remove script-capable elements, attributes and URLs. */
export function rehypeStripDangerous() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      const tag = node.tagName.toLowerCase()
      const retargetsHref = SVG_ANIMATION_ELEMENTS.has(tag)
        && propertyAsStrings(node.properties?.attributeName).some(v => /href/i.test(v))

      if ((REMOVED_ELEMENTS.has(tag) || retargetsHref) && parent && index !== undefined) {
        parent.children.splice(index, 1)
        return [SKIP, index]
      }

      cleanElement(node)
    })
  }
}

// =============================================================================
// TABLE WHITESPACE AROUND rehype-raw
// =============================================================================

const TABLE_STRUCTURE = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr'])

/**
 * Run before rehype-raw. hast-util-raw foster-parents whitespace text nodes
 * found inside table structure, which piles every newline from a table in
 * front of the <table> tag. Those nodes are insignificant, so drop them.
 */
export function rehypeDropTableWhitespace() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (!TABLE_STRUCTURE.has(node.tagName)) return
      node.children = node.children.filter(child => !(child.type === 'text' && child.value.trim() === ''))
    })
  }
}

/**
 * Run after rehype-raw. Restore the newline layout remark-rehype emits for
 * tables ("<table>\n<thead>\n<tr>\n<th>..."), so table HTML is unchanged.
 */
export function rehypeRestoreTableWhitespace() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (!TABLE_STRUCTURE.has(node.tagName) || node.children.length === 0) return
      const spaced: Element['children'] = [{ type: 'text', value: '\n' }]
      for (const child of node.children) {
        spaced.push(child, { type: 'text', value: '\n' })
      }
      node.children = spaced
    })
  }
}
