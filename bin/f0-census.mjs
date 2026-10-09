#!/usr/bin/env node
/**
 * =============================================================================
 * F0 CENSUS — what this release changes for one site
 * =============================================================================
 *
 * Read-only. Point it at a site's content folder before merging the release
 * into that site (fork), and review each section:
 *
 *   node bin/f0-census.mjs ./content
 *   node bin/f0-census.mjs ../voe-builder-docs/content --json
 *
 * It uses the same rules as the server (server/utils/content-core.ts and
 * accent.ts), so what it reports is what the site will do. Exit code 0 always
 * (it reports, it does not judge); 2 for usage errors.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  fileToUrlPath,
  firstHeading,
  isDraft,
  readFrontmatter,
  resolveAssetUrl,
  resolvePageTitle,
  stripOrderPrefix,
} from '../server/utils/content-core.ts'
import { deriveAccentPalette } from '../server/utils/accent.ts'

const PAGE = /\.(md|markdown|mdx|json)$/i
const MARKDOWN = /\.(md|markdown|mdx)$/i

function walk(dir, root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    if (entry.name === 'assets' || entry.name === 'images' || entry.name === 'nav.md') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, root, out)
    else if (PAGE.test(entry.name)) out.push(relative(root, full).split(sep).join('/'))
  }
  return out
}

/** Bodies of fenced code blocks (``` or ~~~), unclosed blocks running to the end. */
function fencedBlocks(body) {
  const blocks = []
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^[ \t]*(`{3,}|~{3,})/)
    if (!open) continue
    const fence = open[1]
    let end = i + 1
    while (end < lines.length && !new RegExp(`^[ \\t]*\\${fence[0]}{${fence.length},}[ \\t]*$`).test(lines[end])) end++
    blocks.push(lines.slice(i + 1, end).join('\n'))
    i = end
  }
  return blocks
}

/** True when the previous release's preprocessors rewrote this code block text. */
function rewrittenBefore(code) {
  return /^:::(info|warning|error|success|tip|note|danger)[ \t]*\n[\s\S]*?\n:::[ \t]*$/m.test(code)
    || /^::(embed|mermaid)\b/m.test(code)
    || /^:::api\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\S/im.test(code)
}

/** The URL the old sitemap used: folder names as written, file prefixes stripped. */
function oldSitemapUrl(rel) {
  const parts = rel.split('/')
  const file = parts.pop().replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/^\d+-/, '').replace(/\.[^.]+$/, '')
  if (parts.length === 0 && file === 'home') return '/'
  return '/' + [...parts, file].join('/')
}

/**
 * The page title the previous release showed: frontmatter only with LF line
 * endings and no BOM, then the first "# " line anywhere (code blocks
 * included), else 'Untitled'. Comment-only frontmatter made the page an error.
 */
function oldTitle(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/)
  let data = {}
  if (match) {
    try {
      data = parseYaml(match[1])
    }
    catch {
      data = {}
    }
    if (data === null) return null
  }
  if (data && typeof data.title === 'string' && data.title) return data.title
  const body = match ? source.slice(match[0].length) : source
  const h1 = body.match(/^#\s+(.+)$/m)
  return h1 ? h1[1].trim() : 'Untitled'
}

function census(contentDir) {
  const root = resolve(contentDir)
  const report = {
    contentDir: root,
    pages: 0,
    draftsNowHidden: [],
    draftsNowRespected: [],
    nestedConfigs: [],
    sitemapUrlChanges: [],
    titleChanges: [],
    pagesThatErrored: [],
    oneLineCallouts: [],
    contentAfterCallouts: [],
    directivesInCode: [],
    coverImageFixes: [],
    brand: {},
    numberedFolders: [],
    mdxPages: [],
  }

  const files = walk(root, root)
  report.pages = files.length

  for (const rel of files) {
    const full = join(root, rel)
    if (!MARKDOWN.test(rel)) continue
    const source = readFileSync(full, 'utf-8')
    const doc = readFrontmatter(source)
    const url = fileToUrlPath(rel)

    // Drafts: listed nowhere now (before: only blog listings skipped draft: true)
    if (isDraft(doc.data)) {
      report.draftsNowHidden.push({ file: rel, url, draft: doc.data.draft })
      if (doc.data.draft !== true) report.draftsNowRespected.push({ file: rel, draft: doc.data.draft })
    }

    // Sitemap and search URLs
    const before = oldSitemapUrl(rel)
    if (before !== url) report.sitemapUrlChanges.push({ file: rel, before, after: url })

    // Titles (BOM, CRLF, empty frontmatter, code-fence comments, no title)
    const was = oldTitle(source)
    const now = resolvePageTitle(doc, rel)
    if (was !== now) report.titleChanges.push({ file: rel, before: was ?? '(error page)', after: now })

    // Pages that rendered as an error before
    const fm = source.match(/^---\n([\s\S]*?)\n---\n/)
    if (fm && /^\s*(#[^\n]*\s*)*$/.test(fm[1])) report.pagesThatErrored.push({ file: rel, reason: 'comment-only frontmatter' })
    if (/^:::(info|warning|error|success|tip|note|danger)\s+\S.*:::\s*$/m.test(doc.body)) {
      report.oneLineCallouts.push({ file: rel })
    }

    // Headings, images and paragraphs right after a callout rendered as raw
    // Markdown text (the callout swallowed the blank line after it)
    if (/^:::(info|warning|error|success|tip|note|danger)[ \t]*\n[\s\S]*?\n:::[ \t]*\n\s*\n\s*\S/m.test(doc.body)) {
      report.contentAfterCallouts.push({ file: rel })
    }

    // Code examples showing :::/:: syntax were rewritten instead of shown
    if (fencedBlocks(doc.body).some(rewrittenBefore)) {
      report.directivesInCode.push({ file: rel })
    }

    // cover_image paths that 404ed (./assets/... was doubled to assets/assets)
    const cover = typeof doc.data.cover_image === 'string' ? doc.data.cover_image : ''
    if (cover.startsWith('./assets/') || cover.startsWith('assets/')) {
      report.coverImageFixes.push({ file: rel, cover_image: cover, now: resolveAssetUrl(cover) })
    }

    if (/\.(mdx|markdown)$/i.test(rel)) report.mdxPages.push({ file: rel, url })
    if (firstHeading(doc.body) === null && !doc.data.title) {
      // nothing: covered by titleChanges
    }
  }

  // Nested _config.md files now apply to their folder (before: only top level)
  const configs = []
  ;(function findConfigs(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory() && entry.name !== 'assets') findConfigs(full)
      else if (entry.name === '_config.md') configs.push(relative(root, full).split(sep).join('/'))
    }
  })(root)
  for (const rel of configs) {
    const depth = rel.split('/').length - 1
    const data = readFrontmatter(readFileSync(join(root, rel), 'utf-8')).data
    if (depth === 0) report.nestedConfigs.push({ file: rel, layout: data.layout ?? 'docs', note: 'root config now applies to root-level pages' })
    if (depth > 1) report.nestedConfigs.push({ file: rel, layout: data.layout ?? 'docs', note: 'now applies to its folder (was ignored)' })
  }

  // Numbered folders: now reachable by URL name
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && /^\d+-/.test(entry.name)) {
      report.numberedFolders.push({ folder: entry.name, url: '/' + stripOrderPrefix(entry.name) })
    }
  }

  // Brand: accent now applies (and may be adjusted), custom_css now wins
  const brandPath = join(root, '_brand.md')
  if (existsSync(brandPath)) {
    const brand = readFrontmatter(readFileSync(brandPath, 'utf-8')).data
    if (typeof brand.accent_color === 'string' && brand.accent_color.trim()) {
      const palette = deriveAccentPalette(brand.accent_color.trim(), brand.accent_exact === true)
      report.brand.accent = {
        accent_color: brand.accent_color,
        nowApplies: true,
        light: palette.light.accent,
        dark: palette.dark.accent,
        adjustedForContrast: palette.adjusted,
      }
    }
    if (typeof brand.custom_css === 'string' && brand.custom_css.trim()) {
      report.brand.customCss = { custom_css: brand.custom_css, note: 'now loads after the theme and wins ties' }
    }
    for (const key of ['logo', 'logo_dark', 'og_image', 'favicon']) {
      if (typeof brand[key] === 'string' && /^https?:\/\//.test(brand[key])) {
        report.brand[key] = { value: brand[key], note: 'absolute URL now passes through (was broken)' }
      }
    }
  }

  return report
}

function print(report) {
  const section = (title, items, line) => {
    console.log(`\n${title} (${items.length})`)
    if (items.length === 0) console.log('  none')
    for (const item of items.slice(0, 50)) console.log('  ' + line(item))
    if (items.length > 50) console.log(`  ... and ${items.length - 50} more`)
  }
  console.log(`f0 census: ${report.contentDir}`)
  console.log(`${report.pages} pages`)
  section('Drafts now left out of the sidebar, sitemap, search and llms.txt', report.draftsNowHidden, d => `${d.file} (draft: ${JSON.stringify(d.draft)}) → ${d.url} stays reachable, noindex`)
  section('Drafts written as yes/on/1 that used to publish', report.draftsNowRespected, d => `${d.file} (draft: ${JSON.stringify(d.draft)})`)
  section('Folder configs that now take effect', report.nestedConfigs, c => `${c.file} (layout ${c.layout}): ${c.note}`)
  section('Sitemap/search URLs that change (old URLs keep working)', report.sitemapUrlChanges, u => `${u.file}: ${u.before} → ${u.after}`)
  section('Page titles that change', report.titleChanges, t => `${t.file}: "${t.before}" → "${t.after}"`)
  section('Pages that rendered as an error and now render', [...report.pagesThatErrored, ...report.oneLineCallouts.map(c => ({ ...c, reason: 'one-line callout' }))], p => `${p.file} (${p.reason})`)
  section('Pages with content after a callout that showed as raw Markdown and now renders', report.contentAfterCallouts, p => p.file)
  section('Code examples of :::/:: syntax that were rewritten and now show as written', report.directivesInCode, p => p.file)
  section('cover_image paths that 404ed and now load', report.coverImageFixes, c => `${c.file}: ${c.cover_image} → ${c.now}`)
  section('Numbered folders now reachable by their URL name', report.numberedFolders, f => `${f.folder}/ → ${f.url}`)
  section('.mdx/.markdown pages that now load', report.mdxPages, p => `${p.file} → ${p.url}`)
  console.log('\nBrand')
  if (report.brand.accent) {
    const a = report.brand.accent
    console.log(`  accent_color ${a.accent_color} now applies${a.adjustedForContrast ? ` (adjusted for contrast: light ${a.light}, dark ${a.dark}; accent_exact: true keeps it as written)` : ''}`)
  }
  if (report.brand.customCss) console.log(`  custom_css ${report.brand.customCss.custom_css} ${report.brand.customCss.note}`)
  for (const key of ['logo', 'logo_dark', 'og_image', 'favicon']) {
    if (report.brand[key]) console.log(`  ${key} ${report.brand[key].value}: ${report.brand[key].note}`)
  }
  if (Object.keys(report.brand).length === 0) console.log('  no brand changes')
}

export { census }

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const dir = args.find(arg => !arg.startsWith('--'))
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error('Usage: node bin/f0-census.mjs <content-dir> [--json]')
    process.exit(2)
  }
  const report = census(dir)
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else print(report)
}
