import { describe, expect, it } from 'vitest'
import { accentStyle, contrastRatio, deriveAccentPalette, parseColor } from '../../server/utils/accent'

const WHITE: [number, number, number] = [255, 255, 255]
const DARK: [number, number, number] = [0x19, 0x19, 0x19]

describe('parseColor', () => {
  it.each([
    ['#2563eb', [37, 99, 235]],
    ['#abc', [170, 187, 204]],
    ['#2563ebcc', [37, 99, 235]],
    ['rgb(37, 99, 235)', [37, 99, 235]],
    ['rgb(37 99 235 / 50%)', [37, 99, 235]],
    ['rgba(100%, 0%, 0%, 0.5)', [255, 0, 0]],
    ['hsl(0 100% 50%)', [255, 0, 0]],
    ['hsl(120deg, 100%, 25%)', [0, 128, 0]],
  ])('%s', (input, rgb) => {
    expect(parseColor(input)).toEqual(rgb)
  })

  it.each(['teal', 'oklch(60% 0.12 180)', 'color(display-p3 0.1 0.6 0.5)', 'rgb(1, 2)'])('does not measure %s', (input) => {
    expect(parseColor(input)).toBeNull()
  })
})

describe('deriveAccentPalette', () => {
  it('keeps an accent that already reads well', () => {
    const palette = deriveAccentPalette('#1d4ed8')
    expect(palette.light.accent).toBe('#1d4ed8')
    expect(contrastRatio(parseColor(palette.dark.accent)!, DARK)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['#f5d90a', '#0d9488', '#60a5fa', '#111111', 'hsl(50 100% 60%)'])('makes %s readable on both backgrounds', (color) => {
    const palette = deriveAccentPalette(color)
    expect(contrastRatio(parseColor(palette.light.accent)!, WHITE)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(parseColor(palette.dark.accent)!, DARK)).toBeGreaterThanOrEqual(4.5)
  })

  it('reports when it adjusted the color, and keeps it with accent_exact', () => {
    expect(deriveAccentPalette('#f5d90a').adjusted).toBe(true)
    const exact = deriveAccentPalette('#f5d90a', true)
    expect(exact.light.accent).toBe('#f5d90a')
    expect(exact.dark.accent).toBe('#f5d90a')
  })

  it('derives a pale tint and a darker hover in light mode', () => {
    const { light } = deriveAccentPalette('#2563eb')
    expect(contrastRatio(parseColor(light.accentLight)!, WHITE)).toBeLessThan(1.5)
    expect(contrastRatio(parseColor(light.accentDark)!, WHITE)).toBeGreaterThan(contrastRatio(parseColor(light.accent)!, WHITE))
  })

  it('uses colors it cannot measure as written, with color-mix tints', () => {
    const palette = deriveAccentPalette('oklch(60% 0.12 180)')
    expect(palette.light.accent).toBe('oklch(60% 0.12 180)')
    expect(palette.light.accentLight).toMatch(/^color-mix\(in srgb, oklch\(60% 0\.12 180\) 18%, #ffffff\)$/)
    expect(palette.adjusted).toBe(false)
  })
})

describe('accentStyle', () => {
  it('outranks the theme rules for both modes', () => {
    const css = accentStyle(deriveAccentPalette('#d9480f'))
    expect(css).toMatch(/^:root:root \{ --color-accent: #[0-9a-f]{6}; --color-accent-light: #[0-9a-f]{6}; --color-accent-dark: #[0-9a-f]{6}; \} :root\[data-theme="dark"\] \{/)
  })
})
