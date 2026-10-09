import { describe, expect, it } from 'vitest'
import { sanitizeCssColor } from '../../server/utils/brand'
import { parseImageOptions } from '../../server/utils/image-processor'

describe('sanitizeCssColor', () => {
  it.each(['#0d9488', '#abc', '#0d9488cc', 'rgb(13 148 136)', 'rgba(13, 148, 136, 0.5)', 'hsl(174 84% 32%)', 'oklch(60% 0.12 180)', 'color(display-p3 0.1 0.6 0.5)', 'teal', ' #2563eb '])(
    'accepts %s',
    (value) => {
      expect(sanitizeCssColor(value)).toBe(value.trim())
    },
  )

  it.each([
    'red;}body{display:none}',
    '#0d9488;</style><script>alert(1)</script>',
    'url(https://evil.test/x)',
    'expression(alert(1))',
    '#12',
    'rgb(1,2,3);color:red',
    '"#fff"',
    '',
    'x'.repeat(65),
  ])('rejects %s', (value) => {
    expect(sanitizeCssColor(value)).toBeNull()
  })

  it('rejects non-strings', () => {
    expect(sanitizeCssColor(null)).toBeNull()
    expect(sanitizeCssColor(123)).toBeNull()
  })
})

describe('parseImageOptions', () => {
  it('returns null without processing parameters', () => {
    expect(parseImageOptions({})).toBeNull()
  })

  it('keeps documented sizes and qualities unchanged', () => {
    expect(parseImageOptions({ w: '800', f: 'webp' })).toEqual({ width: 800, format: 'webp' })
    expect(parseImageOptions({ w: '400', q: '80' })).toEqual({ width: 400, quality: 80 })
    expect(parseImageOptions({ w: '1200' })).toEqual({ width: 1200 })
  })

  it('snaps sizes up to the allowed steps and caps them', () => {
    expect(parseImageOptions({ w: '500' })).toEqual({ width: 800 })
    expect(parseImageOptions({ w: '1' })).toEqual({ width: 96 })
    expect(parseImageOptions({ w: '10000' })).toEqual({ width: 2400 })
    expect(parseImageOptions({ h: '600' })).toEqual({ height: 800 })
  })

  it('snaps quality up to the allowed steps', () => {
    expect(parseImageOptions({ q: '1' })).toEqual({ quality: 60 })
    expect(parseImageOptions({ q: '81' })).toEqual({ quality: 85 })
    expect(parseImageOptions({ q: '100' })).toEqual({ quality: 90 })
  })

  it('ignores invalid values', () => {
    expect(parseImageOptions({ w: '-5', q: '0' })).toBeNull()
    expect(parseImageOptions({ f: 'bmp' })).toBeNull()
  })
})
