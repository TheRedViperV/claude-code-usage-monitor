// Drawings for the usage bar, each a self-contained SVG string. The desktop
// app draws an Svg as an image: exactly as written, at the size given, in
// the system's own UI font, following its light or dark mode through the
// `prefers-color-scheme` rule below.

/** Chip text and icon colours for dark mode, then light. */
const STYLE =
  `<style>.f{fill:rgba(150,147,139,.17)}.t{fill:#E9E6DD}.i{stroke:#A19E95}.s{fill:#9C998F}.k{stroke:#7EE84A}` +
  `@media (prefers-color-scheme: light){.f{fill:rgba(60,58,52,.08)}.t{fill:#3B3934}.i{stroke:#77746C}.s{fill:#7A776F}.k{stroke:#2E9B3A}}</style>`

const FONT = `font-family="Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"`

/** Chip height in CSS pixels. */
export const CHIP_H = 20

/** 12px line icons, drawn on a 12-unit grid. */
const ICONS = {
  clock: `<circle cx="6" cy="6" r="4.7"/><path d="M6 3.5V6l1.7 1.1"/>`,
  countdown: `<path d="M3 1.4h6M3 10.6h6M3.7 1.4c0 2.6 4.6 2.4 4.6 4.6S3.7 8 3.7 10.6M8.3 1.4c0 2.6-4.6 2.4-4.6 4.6s4.6 2 4.6 4.6"/>`,
  context: `<path d="M6 1.4 10.6 3.9 6 6.4 1.4 3.9z"/><path d="M1.4 6.2 6 8.7l4.6-2.5"/><path d="M1.4 8.4 6 10.9l4.6-2.5" opacity=".6"/>`,
  swap: `<path d="M2 4.2h7.6M7.4 2 9.6 4.2 7.4 6.4M10 7.8H2.4M4.6 5.6 2.4 7.8l2.2 2.2"/>`,
} as const
export type IconName = keyof typeof ICONS

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Width of `s` at 12px in Segoe UI semibold, a shade generous so the pill never
 * clips: digits are tabular, the rest by rough class.
 */
export function textWidth(s: string): number {
  let w = 0
  for (const c of s) {
    if (/[0-9]/.test(c)) w += 6.9
    else if (c === ' ') w += 3.3
    else if (/[:.,]/.test(c)) w += 3.2
    else if (c === '/') w += 4.6
    else if (/[ilIjt!|'’]/.test(c)) w += 3.6
    else if (/[mwMW]/.test(c)) w += 10.4
    else if (/[A-Z]/.test(c)) w += 8
    else if (c === '<') w += 7.6
    else w += 6.3
  }
  return Math.ceil(w)
}

/** A pill: icon, then text. Returns the markup and its width. */
export function chipSvg(icon: IconName, text: string, opts: { sub?: string; check?: boolean; swap?: boolean } = {}): { source: string; width: number } {
  const subW = opts.sub ? 5 + textWidth(opts.sub) : 0
  const tw = textWidth(text) + subW
  const check = opts.check ? 20 : 0
  const swap = opts.swap ? 17 : 0
  const width = 8 + 12 + 5 + tw + check + swap + 9
  const h = CHIP_H
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${STYLE}` +
    `<rect class="f" x="0" y="0" width="${width}" height="${h}" rx="${h / 2}"/>` +
    `<g class="i" transform="translate(8 4)" fill="none" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g>` +
    `<text class="t" x="25" y="14.2" ${FONT} font-size="12" font-weight="600" style="font-variant-numeric:tabular-nums">${esc(text)}${opts.sub ? `<tspan class="s" dx="5" font-weight="500">${esc(opts.sub)}</tspan>` : ''}</text>` +
    (opts.check
      ? `<path class="k" transform="translate(${25 + tw + 7} 4)" d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
      : '') +
    (opts.swap
      ? `<g class="i" transform="translate(${25 + tw + 6} 4)" fill="none" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" opacity=".75">${ICONS.swap}</g>`
      : '') +
    `</svg>`
  return { source, width }
}

/** A divider that fades out at both ends. */
export const DIVIDER =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="22" viewBox="0 0 1 22"><defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#8E8B83" stop-opacity="0"/><stop offset=".5" stop-color="#8E8B83" stop-opacity=".6"/><stop offset="1" stop-color="#8E8B83" stop-opacity="0"/>` +
  `</linearGradient></defs><rect width="1" height="22" fill="url(#d)"/></svg>`

/**
 * Ring gradients, dark at 12 o'clock to bright at the tip, as Apple's activity
 * rings run. The SVG is drawn isolated, so raw colours, not theme keys.
 */
export const RING = {
  success: ['#00B85C', '#B4FF3C'],
  warning: ['#FF6A00', '#FFD60A'],
  error: ['#E0003C', '#FF6A8A'],
} as const

/** Neutral grey that reads on light and dark themes alike. */
const INK = '#8E8B83'

/**
 * A 3D activity ring: a tinted track; an arc whose colour runs along it (small
 * segments, since SVG has no conic gradient) into a round tip that casts a soft
 * shadow; and tube shading over the whole ring, dark edges and a gloss line.
 */
export function ringSvg(pct: number, level: keyof typeof RING, mark?: RingMark): string {
  const [from, to] = RING[level]
  const p = Math.max(0, Math.min(100, pct))
  const cx = 18
  // A marked ring is thinner, to leave room for its mark in the middle.
  const r = mark ? 13.8 : 12.5
  const w = mark ? 5 : 7
  const pt = (a: number) => [(cx + r * Math.sin(a)).toFixed(2), (cx - r * Math.cos(a)).toFixed(2)]
  const total = (p / 100) * 2 * Math.PI
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><defs>`,
    `<filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0" stdDeviation="1.3" flood-color="#000" flood-opacity="0.6"/></filter>`,
    `<radialGradient id="t" cx="${cx}" cy="${cx}" r="${r + w / 2}" gradientUnits="userSpaceOnUse">`,
    `<stop offset="${((r - w / 2) / (r + w / 2)).toFixed(4)}" stop-color="#000" stop-opacity="0.38"/>`,
    `<stop offset="0.70" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.80" stop-color="#fff" stop-opacity="0"/>`,
    `<stop offset="1" stop-color="#000" stop-opacity="0.32"/></radialGradient></defs>`,
    `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${from}" stroke-opacity="0.22" stroke-width="${w}"/>`,
  ]
  if (p > 0) {
    const n = Math.max(2, Math.ceil((p / 100) * 64))
    const [sx, sy] = pt(0)
    parts.push(`<circle cx="${sx}" cy="${sy}" r="${w / 2}" fill="${from}"/>`)
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pt((total * i) / n)
      const [x1, y1] = pt(Math.min(total, (total * (i + 1)) / n + 0.02))
      parts.push(`<path d="M${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}" fill="none" stroke="${mix(from, to, (i + 0.5) / n)}" stroke-width="${w}"/>`)
    }
    const [tx, ty] = pt(total)
    parts.push(`<circle cx="${tx}" cy="${ty}" r="${w / 2}" fill="${to}" filter="url(#s)"/>`)
  }
  parts.push(`<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="url(#t)" stroke-width="${w}"/>`)
  if (mark === 'context') {
    parts.push(`${STYLE}<g class="i" transform="translate(11.4 11.4) scale(1.1)" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS.context}</g>`)
  } else if (mark) {
    parts.push(`${STYLE}<text class="t" x="${cx}" y="22" text-anchor="middle" ${FONT} font-size="11.5" font-weight="700">${mark === 'five_hour' ? '5h' : '7d'}</text>`)
  }
  parts.push(`</svg>`)
  return parts.join('')
}

/** What a marked ring shows in its middle, when there is no room for a label. */
export type RingMark = 'five_hour' | 'seven_day' | 'context'

/** Rendered size of a ring: plain, then marked. */
export const RING_PX = 20
export const MARKED_RING_PX = 28

/** `#rrggbb` between `a` and `b`, `t` from 0 to 1. */
function mix(a: string, b: string, t: number): string {
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [A, B] = [rgb(a), rgb(b)]
  return '#' + A.map((v, i) => Math.round(v + ((B[i] ?? v) - v) * t).toString(16).padStart(2, '0')).join('')
}

