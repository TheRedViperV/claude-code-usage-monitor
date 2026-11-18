import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Limit, Meter, SharedLimits } from '../types'

// The live figures, refreshed by `session.measure`; a meter stored by an older
// version may lack `limits`, which the render guards.
const meter = atom({ plugin: 'token-meter', key: 'meter' } as const, null)

/** `$.store` key (shared by every chat) for the account's last-known limits. */
const SHARED = 'limits'

function toMeter(context: SessionContextUsage, rateLimits: readonly SessionRateLimit[], now: number): Meter {
  return {
    contextTokens: context.tokens ?? null,
    contextWindow: context.window,
    contextPercent: context.percent ?? null,
    usd: null,
    limits: rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
    limitsAt: rateLimits.length ? now : null,
  }
}

type Api = EngineInterface

async function readShared($: Api): Promise<SharedLimits | null> {
  const v = (await $.store.get(SHARED)) as SharedLimits | undefined
  return v && Array.isArray(v.limits) && typeof v.savedAt === 'number' ? v : null
}

/**
 * Rate limits belong to the account, not the chat, but a chat only hears them
 * in its own API responses. So a chat that has them saves them for the others,
 * and a chat without fresh ones takes the newest saved.
 */
async function reconcile($: Api, m: Meter): Promise<Meter> {
  const shared = await readShared($)
  const own = m.limits?.length ? (m.limitsAt ?? 0) : -1
  if (own >= 0 && (!shared || own > shared.savedAt)) {
    await $.store.set(SHARED, { limits: m.limits, savedAt: own } satisfies SharedLimits)
    return m
  }
  if (shared && shared.savedAt > own) return { ...m, limits: shared.limits, limitsAt: shared.savedAt }
  return m
}

/** A window whose reset has passed no longer tells its use: shown as unknown. */
function live(l: Limit, now: number): number | null {
  if (l.resetsAt && Date.parse(l.resetsAt) <= now) return null
  return l.percentUsed
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

function untilReset(iso: string | null, now: number): string | null {
  if (!iso) return null
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms)) return null
  if (ms <= 0) return 'now'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}m`
  return `${Math.round(h / 24)}d`
}

/** Green under 60%, amber under 85%, red above. */
function tone(pct: number): 'success' | 'warning' | 'error' {
  return pct >= 85 ? 'error' : pct >= 60 ? 'warning' : 'success'
}

/**
 * Ring gradients, dark at 12 o'clock to bright at the tip, as Apple's activity
 * rings run. The SVG is drawn isolated, so raw colours, not theme keys.
 */
const RING = {
  success: ['#00B85C', '#B4FF3C'],
  warning: ['#FF6A00', '#FFD60A'],
  error: ['#E0003C', '#FF6A8A'],
} as const

/**
 * A 3D activity ring: a tinted track; an arc whose colour runs along it (small
 * segments, since SVG has no conic gradient) into a round tip that casts a soft
 * shadow; and tube shading over the whole ring, dark edges and a gloss line.
 */
function ringSvg(pct: number, level: keyof typeof RING): string {
  const [from, to] = RING[level]
  const p = Math.max(0, Math.min(100, pct))
  const cx = 18
  const r = 12.5
  const w = 7
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
  parts.push(`<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="url(#t)" stroke-width="${w}"/></svg>`)
  return parts.join('')
}

/** `#rrggbb` between `a` and `b`, `t` from 0 to 1. */
function mix(a: string, b: string, t: number): string {
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [A, B] = [rgb(a), rgb(b)]
  return '#' + A.map((v, i) => Math.round(v + ((B[i] ?? v) - v) * t).toString(16).padStart(2, '0')).join('')
}

/** The three things the bar shows: Session (5h) and Weekly limits, then Context. */
const ORDER = ['five_hour', 'seven_day']
const LABELS: Record<string, string> = { five_hour: 'Session', seven_day: 'Weekly' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const u = await $.session.usage()
    const m = await reconcile($, toMeter(u.context, u.rateLimits, await $.clock.now()))
    await update($, meter, () => m)
    // Pick up limits another chat heard, and let the reset countdown move.
    $.clock.every(60_000, () => {
      void (async () => {
        const cur = await read($, meter)
        if (cur) {
          const n = await reconcile($, cur)
          if (n !== cur) await update($, meter, () => n)
        }
        $.ui.invalidate('ui.render')
      })()
    })
    return next(e)
  })

  // Fires whenever context fill or rate limits move: keeps the bar live.
  on('session.measure', async ($, e, next) => {
    const prev = await read($, meter)
    let m = toMeter(e.context, e.rateLimits, await $.clock.now())
    // A context-only measure keeps the limits already shown.
    if (!m.limits.length && prev?.limits?.length) m = { ...m, limits: prev.limits, limitsAt: prev.limitsAt ?? null }
    m = await reconcile($, m)
    await update($, meter, () => m)
    return next(e)
  })

  // The bar above the chat box, as wide as it, always shown.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const now = await $.clock.now()
    let m = await read($, meter)
    if (!m || !m.limits) {
      // Nothing measured since a (re)load: read the figures now. Drawing may
      // not write state (the engine skips the whole bar if it does), so these
      // stay local until the next measure or tick stores them.
      const u = await $.session.usage()
      m = toMeter(u.context, u.rateLimits, now)
    }
    if (!m.limits.length) {
      // No reply in this chat yet: show what another chat last heard.
      const shared = await readShared($)
      if (shared) m = { ...m, limits: shared.limits, limitsAt: shared.savedAt }
    }
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Svg = 'Svg' in els ? els.Svg : null

    // Responsive: wide shows everything, medium shortens the details, narrow keeps ring and percent.
    const cols = e.props.bodyColumns
    const fit: 'wide' | 'medium' | 'narrow' = cols >= 96 ? 'wide' : cols >= 64 ? 'medium' : 'narrow'

    const label = (s: string) => (
      <Text size="footnote" weight="medium" color="subtle" wrap="end">{s}</Text>
    )
    const value = (s: string, color?: string) => (
      <Text size="footnote" weight="semibold" tabular color={color} wrap="end">{s}</Text>
    )
    const detail = (s: string) => (
      <Text size="footnote" tabular color="subtle" wrap="end">{s}</Text>
    )

    const ring = (p: number) =>
      Svg ? <Svg source={ringSvg(p, tone(p))} alt={`${Math.round(p)}% used`} width={20} height={20} /> : null

    // One item, sharing the row's width equally with the others, on one line.
    const item = (key: string, name: string, pct: number | null, long: string | null, short: string | null) => {
      const p = Math.max(0, Math.min(100, pct ?? 0))
      const extra = fit === 'wide' ? long : fit === 'medium' ? short : null
      return (
        <Box key={key} flexDirection="row" flexWrap="nowrap" flexGrow={1} flexShrink={1} width={0} minWidth={0} alignItems="center" justifyContent="center" columnGap="xs">
          {ring(p)}
          {fit !== 'narrow' ? label(name) : null}
          {value(pct == null ? '-' : `${Math.round(pct)}%`, pct == null ? 'subtle' : tone(p))}
          {extra ? detail(extra) : null}
        </Box>
      )
    }

    const items: RenderChildren[] = []
    // Session and Weekly always hold their place; '-' until a reading exists.
    for (const kind of ORDER) {
      const l = m.limits.find(x => x.kind === kind)
      const pct = l ? live(l, now) : null
      const reset = l && pct != null ? untilReset(l.resetsAt, now) : null
      const long = reset ? `resets in ${reset}` : l ? 'reset' : 'after first reply'
      items.push(item(`lim-${kind}`, LABELS[kind] ?? kind, pct, long, reset))
    }
    const used = m.contextTokens == null ? null : `${fmt(m.contextTokens)}/${fmt(m.contextWindow)}`
    items.push(item('ctx', 'Context', m.contextPercent, used, m.contextTokens == null ? null : fmt(m.contextTokens)))

    const row: RenderChildren[] = []
    items.forEach((it, i) => {
      if (i > 0) row.push(<Text key={`sep-${i}`} size="footnote" color="subtle">{'│'}</Text>)
      row.push(it)
    })

    return (
      <Box key="usage-bar" width="100%" flexDirection="row" flexWrap="nowrap" alignItems="center" columnGap="sm" overflow="hidden">
        {row}
      </Box>
    )
  })
}
