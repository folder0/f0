/**
 * =============================================================================
 * F0 - HTML SANITIZER
 * =============================================================================
 *
 * Markdown is rendered with allowDangerousHtml, so raw HTML written by authors
 * (or uploaded through the admin API) reaches readers. Two layers keep script
 * out of the rendered page:
 *
 * 1. stripDangerous(), a denylist applied to the parsed tree. It removes:
 *    - elements: script, object, embed, applet, base, meta, link, frame,
 *      frameset, template, noscript
 *    - SVG animation elements that retarget href (animate/set attributeName=href)
 *    - attributes: event handlers (onclick, onerror, ...), iframe srcdoc
 *    - URLs: javascript: and vbscript: anywhere; data: except images in image
 *      contexts (img/source src, SVG image/feImage href, video poster)
 *
 * 2. stabilizeHtml(), a parse/sanitize round trip. A denylist alone is not
 *    enough: markup can serialize into something the browser parses
 *    differently (mutation XSS: noscript, MathML/SVG namespace confusion,
 *    raw-text elements). The serialized HTML is re-parsed exactly as the
 *    browser will parse it (a fragment in a <div>, scripting enabled) and
 *    sanitized again until the output stops changing, so what the browser
 *    builds is what was sanitized.
 *
 * It is a denylist on purpose: it must not change legitimate output (callouts,
 * embeds, picture/srcset, code blocks, author styling, forms, inline SVG).
 * It runs after heading ids and the TOC are computed, so anchors cannot move.
 */

import type { Element, Root, RootContent } from 'hast'
import { fromParse5 } from 'hast-util-from-parse5'
import { toHtml } from 'hast-util-to-html'
import { parseFragment } from 'parse5'
import { SKIP, visit } from 'unist-util-visit'

const REMOVED_ELEMENTS = new Set([
  'script', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'frame', 'frameset',
  // template content is not part of the tree's children (and declarative
  // shadow DOM makes it live); noscript content is raw text that re-parses
  // differently depending on scripting. Neither belongs in docs content.
  'template', 'noscript',
])

const SVG_ANIMATION_ELEMENTS = new Set(['animate', 'set', 'animatemotion', 'animatetransform'])

/** hast property names that hold a URL. */
const URL_PROPERTIES = [
  'href', 'src', 'cite', 'background', 'poster', 'data', 'xLinkHref',
  'longDesc', 'codeBase', 'manifest', 'dynsrc', 'lowsrc', 'ping', 'action', 'formAction',
]

/** (element, property) pairs where a data:image URL is just an image. */
const DATA_IMAGE_CONTEXTS: Record<string, string[]> = {
  img: ['src', 'srcSet'],
  source: ['src', 'srcSet'],
  image: ['href', 'xLinkHref'],
  feimage: ['href', 'xLinkHref'],
  video: ['poster'],
}

/**
 * Event handler attributes that hast does not convert to camelCase (it only
 * knows a fixed list). Lowercase so they can be compared after toLowerCase().
 */
const EXTRA_EVENT_HANDLERS = new Set([
  'onbeforetoggle', 'ontoggle', 'onbeforematch', 'oncommand', 'oncontentvisibilityautostatechange',
  'onscrollend', 'onscrollsnapchange', 'onscrollsnapchanging', 'onpagereveal', 'onpageswap',
  'onpointerrawupdate', 'onsecuritypolicyviolation', 'onformdata', 'onslotchange', 'onbeforeinput',
  'onanimationcancel', 'ontransitioncancel', 'ontransitionrun', 'ontransitionstart',
  'onbegin', 'onend', 'onrepeat', 'onfocusin', 'onfocusout', 'onsearch', 'onwebkitanimationend',
])

/** True for attributes that browsers run as script. */
function isEventHandler(name: string): boolean {
  // Known handlers are camelCase in hast: onClick, onError, onLoad ...
  if (/^on[A-Z]/.test(name)) return true
  return EXTRA_EVENT_HANDLERS.has(name.toLowerCase())
}

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
    const imageContext = DATA_IMAGE_CONTEXTS[tagName.toLowerCase()]?.includes(property) ?? false
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
    if (isEventHandler(name) || (tag === 'iframe' && name === 'srcDoc')) {
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

/** Remove script-capable elements, attributes and URLs from a tree in place. */
export function stripDangerous(tree: Root): void {
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

/** rehype plugin form of stripDangerous. */
export function rehypeStripDangerous() {
  return (tree: Root) => stripDangerous(tree)
}

// =============================================================================
// ROUND TRIP: SANITIZE WHAT THE BROWSER WILL ACTUALLY PARSE
// =============================================================================

const DIV_CONTEXT = parseFragment('<div></div>').childNodes[0]
const MAX_PASSES = 4

/** Parse an HTML fragment the way a browser parses div.innerHTML / SSR body content. */
function parseLikeBrowser(html: string): Root {
  const fragment = parseFragment(DIV_CONTEXT as Parameters<typeof parseFragment>[0], html, { scriptingEnabled: true })
  return fromParse5(fragment) as Root
}

/**
 * Re-parse sanitized HTML as the browser will and sanitize again until the
 * output is stable. Returns HTML that parses to an already-sanitized tree.
 * If it does not converge (pathological input), returns the text escaped.
 */
export function stabilizeHtml(html: string): string {
  let current = html
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const tree = parseLikeBrowser(current)
    stripDangerous(tree)
    const next = toHtml(tree)
    if (next === current) return current
    current = next
  }
  // Did not converge: never return markup we could not prove stable.
  return toHtml({ type: 'root', children: [{ type: 'element', tagName: 'pre', properties: {}, children: [{ type: 'text', value: html }] as RootContent[] }] } as Root)
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
