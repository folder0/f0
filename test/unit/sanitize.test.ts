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

  it('removes form actions', async () => {
    const html = await render('<form action="https://evil.test"><button formaction="javascript:alert(8)">go</button></form>\n')
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
