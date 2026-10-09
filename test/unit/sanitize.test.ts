import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../../server/utils/markdown'
import { isDangerousUrl } from '../../server/utils/sanitize'

const render = async (md: string) => (await parseMarkdown(md)).html

describe('isDangerousUrl', () => {
  it.each([
    ['javascript:alert(1)', 'a', 'href'],
    ['JaVaScRiPt:alert(1)', 'a', 'href'],
    ['java\tscript:alert(1)', 'a', 'href'],
    [' \njavascript:alert(1)', 'a', 'href'],
    ['vbscript:msgbox(1)', 'a', 'href'],
    ['data:text/html,<script>alert(1)</script>', 'a', 'href'],
    ['data:text/html;base64,PHNjcmlwdD4=', 'iframe', 'src'],
    ['data:image/svg+xml,<svg/>', 'a', 'href'],
  ])('flags %s on <%s %s>', (url, tag, prop) => {
    expect(isDangerousUrl(url, tag, prop)).toBe(true)
  })

  it.each([
    ['https://example.com', 'a', 'href'],
    ['/guides/intro#setup', 'a', 'href'],
    ['#anchor', 'a', 'href'],
    ['mailto:hello@example.com', 'a', 'href'],
    ['data:image/png;base64,iVBORw0KGgo=', 'img', 'src'],
    ['https://www.youtube.com/embed/abc', 'iframe', 'src'],
  ])('allows %s on <%s %s>', (url, tag, prop) => {
    expect(isDangerousUrl(url, tag, prop)).toBe(false)
  })
})

describe('markdown pipeline strips script-capable HTML', () => {
  it('removes event handlers from raw HTML', async () => {
    const html = await render('<img src="x.png" onerror="alert(1)" alt="x">\n')
    expect(html).not.toMatch(/onerror/i)
    expect(html).toContain('alt="x"')
  })

  it('removes script elements', async () => {
    const html = await render('Before\n\n<script>alert(2)</script>\n\nAfter\n')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toContain('alert(2)')
    expect(html).toContain('After')
  })

  it('drops javascript: hrefs from markdown links and raw anchors', async () => {
    const html = await render('[click](javascript:alert(3)) and <a href="JaVaScRiPt:alert(4)">raw</a>\n')
    expect(html).not.toMatch(/javascript:/i)
    expect(html).toContain('click')
    expect(html).toContain('raw')
  })

  it('removes iframe srcdoc, object, embed, base and meta', async () => {
    const html = await render([
      '<iframe srcdoc="<script>alert(5)</script>"></iframe>',
      '<object data="evil.swf"></object>',
      '<embed src="evil.swf">',
      '<base href="https://evil.test/">',
      '<meta http-equiv="refresh" content="0;url=https://evil.test">',
      '',
    ].join('\n'))
    expect(html).not.toMatch(/srcdoc|<object|<embed|<base|<meta/i)
  })

  it('neutralises SVG vectors', async () => {
    const html = await render('<svg><a xlink:href="javascript:alert(6)"><text>x</text></a><animate attributeName="href" values="javascript:alert(7)"/></svg>\n')
    expect(html).not.toMatch(/javascript:/i)
    expect(html).not.toMatch(/<animate/i)
  })

  it('removes script-capable form actions', async () => {
    const html = await render('<form action="javascript:alert(7)"><button formaction="javascript:alert(8)">go</button></form>\n')
    expect(html).not.toMatch(/javascript:/i)
    expect(html).not.toMatch(/action=/i)
  })
})

describe('markdown pipeline keeps legitimate output', () => {
  it('keeps embeds, callouts and data images', async () => {
    const html = await render([
      '::embed[Walkthrough]{url=https://www.loom.com/share/abc123}',
      '',
      ':::tip',
      'A **tip**.',
      ':::',
      '',
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot">',
      '',
    ].join('\n'))
    expect(html).toContain('src="https://www.loom.com/embed/abc123"')
    expect(html).toContain('class="callout callout-tip"')
    expect(html).toContain('<strong>tip</strong>')
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="')
  })

  it('keeps author styling and safe links', async () => {
    const html = await render('<style>.x { color: red }</style>\n\n[docs](https://example.com) and <span class="note">hi</span>\n')
    expect(html).toContain('<style>.x { color: red }</style>')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('<span class="note">hi</span>')
  })

  it('renders tables with the same layout as before', async () => {
    const html = await render('| A | B |\n|---|---|\n| 1 | 2 |\n')
    expect(html).toContain('<table>\n<thead>\n<tr>\n<th>A</th>\n<th>B</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody>\n</table>')
  })
})

// -----------------------------------------------------------------------------
// Findings from the adversarial review
// -----------------------------------------------------------------------------

/** Parse rendered HTML exactly as the browser does (div context, scripting on). */
async function liveDangers(html: string): Promise<string[]> {
  const { parseFragment } = await import('parse5')
  const { fromParse5 } = await import('hast-util-from-parse5')
  const { visit } = await import('unist-util-visit')
  const context = parseFragment('<div></div>').childNodes[0]
  const tree = fromParse5(parseFragment(context as never, html, { scriptingEnabled: true }))
  const found: string[] = []
  visit(tree, 'element', (node: { tagName: string, properties?: Record<string, unknown> }) => {
    if (['script', 'template', 'noscript', 'object', 'embed'].includes(node.tagName)) found.push(`<${node.tagName}>`)
    for (const [name, value] of Object.entries(node.properties ?? {})) {
      if (/^on[A-Z]/.test(name)) found.push(`${node.tagName}[${name}]`)
      if (typeof value === 'string' && /^\s*javascript:/i.test(value)) found.push(`${node.tagName}[${name}=javascript:]`)
    }
  })
  return found
}

describe('mutation XSS (re-parsed as the browser does)', () => {
  it.each([
    '<noscript><style></noscript><img src=x onerror=alert(document.cookie)>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
    '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
    '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
    '<div><template shadowrootmode="open"><img src=x onerror=alert(2)></template></div>',
    '<template><script>alert(1)</script></template>',
  ])('leaves nothing live for %s', async (payload) => {
    const html = await render(`${payload}\n`)
    expect(await liveDangers(html)).toEqual([])
  })
})

describe('legitimate markup the first sanitizer broke', () => {
  it('keeps data: images inside inline SVG diagrams and video posters', async () => {
    const html = await render('<svg><image href="data:image/png;base64,iVBORw0KGgo=" width="100" height="50"/><filter><feImage href="data:image/png;base64,iVBORw0KGgo="/></filter></svg>\n\n<video poster="data:image/png;base64,iVBORw0KGgo="></video>\n')
    expect(html.match(/data:image\/png;base64,iVBORw0KGgo=/g)?.length).toBe(3)
  })

  it('keeps newsletter form actions but drops javascript: actions', async () => {
    const html = await render('<form action="https://buttondown.email/api/emails/embed-subscribe/acme" method="post"><input name="email"><button formaction="javascript:alert(1)">Go</button></form>\n')
    expect(html).toContain('action="https://buttondown.email/api/emails/embed-subscribe/acme"')
    expect(html).not.toMatch(/javascript:/i)
  })

  it('keeps custom-element attributes that merely start with "on"', async () => {
    const html = await render('<my-widget one="1" only="x" onboarding-step="2" onclick="alert(1)" data-x="y"></my-widget>\n')
    expect(html).toContain('one="1"')
    expect(html).toContain('only="x"')
    expect(html).toContain('onboarding-step="2"')
    expect(html).not.toMatch(/onclick/i)
  })

  it('still removes handlers hast does not know by name', async () => {
    const html = await render('<details ontoggle="alert(1)"><summary>x</summary></details> <div onscrollend="alert(2)">y</div>\n')
    expect(html).not.toMatch(/ontoggle|onscrollend/i)
  })
})
