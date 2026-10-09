/**
 * =============================================================================
 * F0 - BRAND ACCENT PALETTE
 * =============================================================================
 *
 * Turns _brand.md accent_color into the variables the theme uses, for light
 * and dark mode: --color-accent (links, buttons), --color-accent-light (tinted
 * backgrounds) and --color-accent-dark (hover and pressed states).
 *
 * The accent is used for link text, so it is nudged until it has WCAG AA
 * contrast (4.5:1) against each theme's background: darker on white, lighter
 * on dark grey. accent_exact: true in _brand.md keeps the color as written.
 *
 * Framework-free and dependency-free: hex, rgb() and hsl() are understood;
 * other valid CSS colors (named, oklch(), color()) are used as written, with
 * tints from color-mix().
 */

export interface AccentShades {
  accent: string
  accentLight: string
  accentDark: string
}

export interface AccentPalette {
  light: AccentShades
  dark: AccentShades
  /** True when the accent was changed to meet contrast. */
  adjusted: boolean
}

type Rgb = [number, number, number]

/** Theme backgrounds (assets/css/main.css --color-bg-primary). */
const LIGHT_BACKGROUND: Rgb = [255, 255, 255]
const DARK_BACKGROUND: Rgb = [0x19, 0x19, 0x19]
const MIN_CONTRAST = 4.5

// =============================================================================
// PARSING
// =============================================================================

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/** Parse a channel: a number, or a percentage of 255. */
function channel(token: string): number | null {
  const match = token.trim().match(/^(-?\d*\.?\d+)(%)?$/)
  if (!match) return null
  const value = Number(match[1])
  return clampByte(match[2] ? (value / 100) * 255 : value)
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360 / 360
  const sat = Math.max(0, Math.min(1, s))
  const lig = Math.max(0, Math.min(1, l))
  if (sat === 0) return [clampByte(lig * 255), clampByte(lig * 255), clampByte(lig * 255)]
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat
  const p = 2 * lig - q
  const convert = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [clampByte(convert(hue + 1 / 3) * 255), clampByte(convert(hue) * 255), clampByte(convert(hue - 1 / 3) * 255)]
}

/** Parse hex, rgb()/rgba() and hsl()/hsla(); null for anything else. Alpha is ignored. */
export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase()

  const hex = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)?.[1]
  if (hex) {
    const digits = hex.length <= 4 ? hex.split('').map(d => d + d).join('') : hex
    return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16)) as Rgb
  }

  const fn = value.match(/^(rgba?|hsla?)\(([^)]*)\)$/)
  const [, kind = '', args = ''] = fn ?? []
  if (!kind) return null
  const [h = '', s = '', l = ''] = (args.split(/\s*\/\s*/)[0] ?? '').split(/[\s,]+/).filter(Boolean)
  if (!l) return null

  if (kind.startsWith('rgb')) {
    const rgb = [h, s, l].map(channel)
    return rgb.every(c => c !== null) ? rgb as Rgb : null
  }

  const hue = Number(h.replace(/deg$/, ''))
  const sat = s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : NaN
  const lig = l.endsWith('%') ? Number(l.slice(0, -1)) / 100 : NaN
  return [hue, sat, lig].every(Number.isFinite) ? hslToRgb(hue, sat, lig) : null
}

// =============================================================================
// CONTRAST AND MIXING
// =============================================================================

function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG contrast ratio between two colors (1 to 21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Mix `amount` (0 to 1) of `other` into `base`. */
function mix(base: Rgb, other: Rgb, amount: number): Rgb {
  return base.map((c, i) => clampByte(c + ((other[i] ?? c) - c) * amount)) as Rgb
}

function toHex(rgb: Rgb): string {
  return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('')
}

/** Move toward `target` in small steps until the contrast against `background` is enough. */
function withContrast(color: Rgb, background: Rgb, target: Rgb): Rgb {
  let current = color
  for (let step = 0; step < 50 && contrastRatio(current, background) < MIN_CONTRAST; step++) {
    current = mix(current, target, 0.04)
  }
  return current
}

// =============================================================================
// PALETTE
// =============================================================================

/**
 * Build the accent palette for a sanitized CSS color.
 * @param exact - keep the accent as written (no contrast adjustment)
 */
export function deriveAccentPalette(color: string, exact = false): AccentPalette {
  const rgb = parseColor(color)
  if (!rgb) {
    // A valid color f0 cannot measure (named, oklch(), color()): as written,
    // tints mixed by the browser
    const shades = (base: string): AccentShades => ({
      accent: color,
      accentLight: `color-mix(in srgb, ${color} 18%, ${base})`,
      accentDark: `color-mix(in srgb, ${color} 80%, ${base === '#ffffff' ? '#000000' : '#ffffff'})`,
    })
    return { light: shades('#ffffff'), dark: shades('#191919'), adjusted: false }
  }

  const white: Rgb = [255, 255, 255]
  const black: Rgb = [0, 0, 0]
  const lightAccent = exact ? rgb : withContrast(rgb, LIGHT_BACKGROUND, black)
  const darkAccent = exact ? rgb : withContrast(rgb, DARK_BACKGROUND, white)

  return {
    light: {
      accent: toHex(lightAccent),
      accentLight: toHex(mix(lightAccent, LIGHT_BACKGROUND, 0.85)),
      accentDark: toHex(mix(lightAccent, black, 0.18)),
    },
    dark: {
      accent: toHex(darkAccent),
      accentLight: toHex(mix(darkAccent, DARK_BACKGROUND, 0.72)),
      accentDark: toHex(mix(darkAccent, white, 0.3)),
    },
    adjusted: toHex(lightAccent) !== toHex(rgb) || toHex(darkAccent) !== toHex(rgb),
  }
}

/**
 * The <style> that applies a palette. `:root:root` and `:root[data-theme]`
 * outrank the theme's own `:root` and `[data-theme="dark"]` rules whatever
 * the order of stylesheets in the page (the theme loads after this style, and
 * used to win).
 */
export function accentStyle(palette: AccentPalette): string {
  const vars = (s: AccentShades) => `--color-accent: ${s.accent}; --color-accent-light: ${s.accentLight}; --color-accent-dark: ${s.accentDark};`
  return `:root:root { ${vars(palette.light)} } :root[data-theme="dark"] { ${vars(palette.dark)} }`
}
