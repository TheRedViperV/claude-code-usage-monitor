import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Limit, Meter, ResetStyle, SharedLimits } from '../types'

import { CHIP_H, DIVIDER, chipSvg, ringSvg } from './art'
import type { IconName } from './art'

// The live figures, refreshed by `session.measure`; a meter stored by an older
// version may lack fields, which `sane` repairs.
const meter = atom({ plugin: 'usage-monitor', key: 'meter' } as const, null)

/** `$.store` key (shared by every chat) for the account's last-known limits. */
const SHARED = 'limits'
/** `$.store` key for how the reset reads: a clock time or a countdown. */
const STYLE = 'resetStyle'

type Api = EngineInterface

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A limit as stored or heard, or null when it is unusable. */
function saneLimit(v: unknown): Limit | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const pct = num(o.percentUsed)
  if (typeof o.kind !== 'string' || pct == null) return null
  const at = typeof o.resetsAt === 'string' && Number.isFinite(Date.parse(o.resetsAt)) ? o.resetsAt : null
  return { kind: o.kind, percentUsed: pct, resetsAt: at }
}

/** Any stored meter, from any version, in today's shape (null if hopeless). */
export function sane(v: unknown): Meter | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const limits = Array.isArray(o.limits) ? o.limits.map(saneLimit).filter((l): l is Limit => !!l) : []
  return {
    contextTokens: num(o.contextTokens),
    contextWindow: num(o.contextWindow) ?? 0,
    contextPercent: num(o.contextPercent),
    usd: null,
    limits,
    limitsAt: num(o.limitsAt),
  }
}

function toMeter(context: SessionContextUsage, rateLimits: readonly SessionRateLimit[], now: number): Meter {
  const limits = rateLimits
    .map(r => saneLimit({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null }))
    .filter((l): l is Limit => !!l)
  return {
    contextTokens: num(context.tokens),
    contextWindow: num(context.window) ?? 0,
    contextPercent: num(context.percent),
    usd: null,
    limits,
    limitsAt: limits.length ? now : null,
  }
}

async function readShared($: Api): Promise<SharedLimits | null> {
  try {
    const v = (await $.store.get(SHARED)) as Partial<SharedLimits> | undefined
    const savedAt = num(v?.savedAt)
    if (!v || !Array.isArray(v.limits) || savedAt == null) return null
    return { limits: v.limits.map(saneLimit).filter((l): l is Limit => !!l), savedAt }
  } catch {
    return null
  }
}

async function readStyle($: Api): Promise<ResetStyle> {
  try {
    return (await $.store.get(STYLE)) === 'countdown' ? 'countdown' : 'clock'
  } catch {
    return 'clock'
  }
}

/**
 * Rate limits belong to the account, not the chat, but a chat only hears them
 * in its own API responses. So a chat that has them saves them for the others,
 * and a chat without fresh ones takes the newest saved.
 */
async function reconcile($: Api, m: Meter): Promise<Meter> {
  const shared = await readShared($)
  const own = m.limits.length ? (m.limitsAt ?? 0) : -1
  if (own >= 0 && (!shared || own > shared.savedAt)) {
    try {
      await $.store.set(SHARED, { limits: m.limits, savedAt: own } satisfies SharedLimits)
    } catch {
      // Sharing is a nicety: this chat still shows its own figures.
    }
    return m
  }
  if (shared && shared.limits.length && shared.savedAt > own) return { ...m, limits: shared.limits, limitsAt: shared.savedAt }
  return m
}

/** Signed in with an API key or a cloud provider: no plan limits exist to show. */
async function hasNoPlan($: Api): Promise<boolean> {
  try {
    const id = await $.session.identity()
    if (!id.kind) return false
    return !['claude.ai', 'oauth-token', 'none'].includes(id.kind)
  } catch {
    return false
  }
}

/** Percent used now: a window whose reset has passed has started over at 0. */
export function live(l: Limit, now: number): number {
  if (l.resetsAt && Date.parse(l.resetsAt) <= now) return 0
  return l.percentUsed
}

/** 950, 12.5k, 171k, 1M, 1.5M. */
export function fmt(n: number): string {
  const trim = (s: string) => s.replace(/\.0$/, '')
  if (n >= 1_000_000) return `${trim((n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1))}M`
  if (n >= 1_000) return `${trim((n / 1_000).toFixed(n >= 100_000 ? 0 : 1))}k`
  return String(Math.round(n))
}

/** `<1m`, `26m`, `1h 26m`, `2d 14h`; `now` once due. */
export function countdown(iso: string, now: number): string | null {
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms)) return null
  if (ms <= 0) return 'now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '<1m'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 ? `${h}h ${min % 60}m` : `${h}h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`
}

/**
 * When it resets, in the person's own time zone on a 12-hour clock: `4:30 PM`
 * today, `Sat 9:00 AM` within the week, `Nov 21` further out.
 */
export function clockTime(iso: string, now: number): string | null {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  if (at <= now) return 'now'
  const d = new Date(at)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (d.toDateString() === new Date(now).toDateString()) return time
  if (at - now < 6 * 86_400_000) return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Green under 60%, amber under 85%, red above. */
function tone(pct: number): 'success' | 'warning' | 'error' {
  return pct >= 85 ? 'error' : pct >= 60 ? 'warning' : 'success'
}

/** The three things the bar shows: the 5-hour and weekly limits, then context. */
const ORDER = ['five_hour', 'seven_day']
const LABELS: Record<string, string> = { five_hour: '5-hour limit', seven_day: 'Weekly' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const u = await $.session.usage()
      const m = await reconcile($, toMeter(u.context, u.rateLimits, await $.clock.now()))
      await update($, meter, () => m)
    } catch {
      // The bar reads the figures itself while nothing is stored.
    }
    // Pick up limits another chat heard, and let the countdown move.
    $.clock.every(60_000, () => {
      void (async () => {
        try {
          const cur = sane(await read($, meter))
          if (cur) {
            const n = await reconcile($, cur)
            if (n !== cur) await update($, meter, () => n)
          }
        } catch {
          // Try again on the next tick.
        }
        $.ui.invalidate('ui.render')
      })()
    })
    return next(e)
  })

  // Fires whenever context fill or rate limits move: keeps the bar live.
  on('session.measure', async ($, e, next) => {
    try {
      const prev = sane(await read($, meter))
      let m = toMeter(e.context, e.rateLimits, await $.clock.now())
      // A context-only measure keeps the limits already shown.
      if (!m.limits.length && prev?.limits.length) m = { ...m, limits: prev.limits, limitsAt: prev.limitsAt ?? null }
      m = await reconcile($, m)
      await update($, meter, () => m)
    } catch {
      // Keep the last figures; the next measure tries again.
    }
    return next(e)
  })

  // The bar above the chat box, as wide as it, always shown.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const now = await $.clock.now()
    let m = sane(await read($, meter).catch(() => null))
    if (!m) {
      // Nothing measured since a (re)load: read the figures now. Drawing may
      // not write state (the engine skips the whole bar if it does), so these
      // stay local until the next measure or tick stores them.
      try {
        const u = await $.session.usage()
        m = toMeter(u.context, u.rateLimits, now)
      } catch {
        m = { contextTokens: null, contextWindow: 0, contextPercent: null, usd: null, limits: [], limitsAt: null }
      }
    }
    if (!m.limits.length) {
      // No reply in this chat yet: show what another chat last heard.
      const shared = await readShared($)
      if (shared?.limits.length) m = { ...m, limits: shared.limits, limitsAt: shared.savedAt }
    }
    const noPlan = !m.limits.length && (await hasNoPlan($))
    const style = await readStyle($)

    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // The terminal's table names Svg but draws it as nothing, so images are
    // for the graphical surfaces only; click layers for the desktop app.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const Client = e.surface === 'desktop' && 'Client' in els ? els.Client : null

    // Responsive: wide shows everything, medium shortens the context figure,
    // narrow drops the labels, tiny keeps just ring and percent.
    const cols = e.props.bodyColumns
    const fit: 'wide' | 'medium' | 'narrow' | 'tiny' = cols >= 100 ? 'wide' : cols >= 72 ? 'medium' : cols >= 48 ? 'narrow' : 'tiny'

    const ring = (p: number) =>
      Svg ? <Svg source={ringSvg(p, tone(p))} alt={`${Math.round(p)}% used`} width={20} height={20} /> : null

    // A pill drawn as one image (icon and text), so the app shows it exactly
    // as designed; the terminal, with no images, gets plain text.
    const chip = (icon: IconName, text: string) => {
      if (!Svg) return <Text key="chip" size="footnote" weight="medium" tabular wrap="end">{text}</Text>
      const c = chipSvg(icon, text)
      return <Svg key="chip" source={c.source} alt={text} width={c.width} height={CHIP_H} />
    }

    /**
     * A reset time: a pill with a swap arrow, and a click on it switches every
     * reset between clock time and countdown. Images take no presses, so on
     * the desktop app a transparent click layer (`./hit.ts`) lies over it; the
     * terminal gets a plain Button.
     */
    const resetChip = (key: string, text: string) => {
      const other = style === 'clock' ? 'countdown' : 'clock time'
      if (!Svg || !Client) {
        return (
          <Button key={`swap-${key}`} plain onPress={() => toggleStyle($)}>
            <Text size="footnote" weight="medium" tabular>{`${text} ⇄`}</Text>
          </Button>
        )
      }
      const c = chipSvg(style, text, { swap: true })
      return (
        <Box key={`swap-${key}`} position="relative" flexShrink={0}>
          <Svg source={c.source} alt={`${text}, click to show ${other}`} width={c.width} height={CHIP_H} />
          <Box key={`swap-${key}-hit`} position="absolute" top={0} left={0} right={0} bottom={0}>
            <Client key={`hit-swap-${key}`} module="./hit.ts" props={{ action: 'swap' }} width="100%" height="100%" />
          </Box>
        </Box>
      )
    }

    // One meter at its own width, on one line.
    const item = (key: string, name: string, pct: number | null, extra: RenderChildren) => {
      const p = Math.max(0, Math.min(100, pct ?? 0))
      return (
        <Box key={key} flexDirection="row" flexWrap="nowrap" flexShrink={1} minWidth={0} alignItems="center" columnGap="sm">
          {ring(p)}
          {fit === 'wide' || fit === 'medium' ? <Text size="footnote" weight="medium" color="subtle" wrap="end">{name}</Text> : null}
          <Text size="footnote" weight="semibold" tabular color={pct == null ? 'subtle' : tone(p)} wrap="end">
            {pct == null ? '–' : `${Math.round(pct)}%`}
          </Text>
          {fit === 'tiny' ? null : extra}
        </Box>
      )
    }

    const items: RenderChildren[] = []
    if (!noPlan) {
      // Both limits always hold their place; a dash until a reading exists.
      for (const kind of ORDER) {
        const l = m.limits.find(x => x.kind === kind)
        const pct = l ? live(l, now) : null
        const due = !!l?.resetsAt && Date.parse(l.resetsAt) <= now
        const when = l?.resetsAt && !due ? (style === 'countdown' ? countdown(l.resetsAt, now) : clockTime(l.resetsAt, now)) : null
        const extra = due
          ? chip(style, 'reset')
          : when
            ? resetChip(kind, when)
            : !l && fit === 'wide'
              ? <Text key="wait" size="footnote" color="subtle" wrap="end">after first reply</Text>
              : null
        items.push(item(`lim-${kind}`, LABELS[kind] ?? kind, pct, extra))
      }
    }
    // Context: the fill, worked out from the tokens when the percent is missing.
    const win = m.contextWindow > 0 ? m.contextWindow : null
    const ctxPct = m.contextPercent ?? (m.contextTokens != null && win ? (m.contextTokens / win) * 100 : null)
    const used = m.contextTokens == null ? null : fit === 'wide' && win ? `${fmt(m.contextTokens)} / ${fmt(win)}` : fmt(m.contextTokens)
    items.push(item('ctx', 'Context', ctxPct, used ? chip('context', used) : null))

    // Meters at their own width with equal gaps between them, each divider
    // in the middle of its gap, and the same gap at each end.
    const gap = (key: string, divider: boolean) => (
      <Box key={key} flexGrow={1} flexShrink={1} minWidth={2} flexDirection="row" justifyContent="center" alignItems="center">
        {divider
          ? Svg
            ? <Svg source={DIVIDER} alt="divider" width={1} height={22} />
            : <Text size="footnote" color="subtle">{'│'}</Text>
          : null}
      </Box>
    )
    const row: RenderChildren[] = [gap('sep-start', false)]
    items.forEach((it, i) => {
      if (i > 0) row.push(gap(`sep-${i}`, true))
      row.push(it)
    })
    row.push(gap('sep-end', false))

    return (
      <Box key="usage-bar" width="100%" flexDirection="row" flexWrap="nowrap" alignItems="center" overflow="hidden">
        {row}
      </Box>
    )
  })

  // A click on a reset time (`./hit.ts` posts it).
  on('ui.message', async ($, e, next) => {
    if ((e.data as { action?: unknown } | null)?.action === 'swap') await toggleStyle($)
    return next(e)
  })
}

/** Switches every reset between clock time and countdown, for every chat. */
async function toggleStyle($: Api): Promise<void> {
  const s: ResetStyle = (await readStyle($)) === 'clock' ? 'countdown' : 'clock'
  try {
    await $.store.set(STYLE, s)
  } catch {
    // Not saved; the bar keeps the style it had.
  }
  $.ui.invalidate('ui.render')
}
