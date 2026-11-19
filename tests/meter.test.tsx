import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'token-meter',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 3,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-11-18T22:00:00Z')

/** The alt texts of every image drawn: what each chip and pill says. */
async function alts(ui: { findAll: (q: { type: string }) => Promise<readonly unknown[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Svg' })).map(el => String((el as { props?: { alt?: unknown } }).props?.alt))
}

test('a chat with no reply yet shows the limits another chat saved', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 114_000, window: 1_000_000, percent: 11 }, rateLimits: [] } }))
  on('store.get', (_, e) => ({
    value: e.key === 'limits'
      ? { savedAt: NOW - 60_000, limits: [
          { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-18T23:30:00Z' },
          { kind: 'seven_day', percentUsed: 17, resetsAt: '2026-11-21T08:00:00Z' },
        ] }
      : undefined,
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '5-hour limit' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '17%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '11%' })).toBeDefined()
    await ui.unmount()
  }
})

test('with nothing saved anywhere, the 5-hour and weekly limits still hold their place', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('store.get', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '5-hour limit' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Weekly' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'after first reply' })).toBeDefined()
  await ui.unmount()
})

import { clockTime, countdown, fmt, live, sane } from '../hooks/register'

test('countdown reads in plain units', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString()
  expect(countdown(at(30_000), NOW)).toBe('<1m')
  expect(countdown(at(26 * 60_000), NOW)).toBe('26m')
  expect(countdown(at(86 * 60_000), NOW)).toBe('1h 26m')
  expect(countdown(at(120 * 60_000), NOW)).toBe('2h')
  expect(countdown(at((2 * 24 + 14) * 3_600_000), NOW)).toBe('2d 14h')
  expect(countdown(at(-1), NOW)).toBe('now')
  expect(countdown('not a date', NOW)).toBe(null)
})

test('clock time names the day only when it is not today', () => {
  const later = new Date(NOW + 30 * 60_000)
  const today = clockTime(later.toISOString(), NOW)
  expect(today).toBe(later.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }))
  expect(/ (AM|PM)$/.test(today ?? '')).toBe(true)
  const inThreeDays = clockTime(new Date(NOW + 3 * 86_400_000).toISOString(), NOW) ?? ''
  expect(inThreeDays.split(' ').length > 1).toBe(true)
  expect(clockTime('garbage', NOW)).toBe(null)
})

test('token counts drop a trailing .0', () => {
  expect(fmt(1_000_000)).toBe('1M')
  expect(fmt(1_500_000)).toBe('1.5M')
  expect(fmt(171_000)).toBe('171k')
  expect(fmt(12_500)).toBe('12.5k')
  expect(fmt(200_000)).toBe('200k')
  expect(fmt(950)).toBe('950')
})

test('a window past its reset counts as started over', () => {
  expect(live({ kind: 'five_hour', percentUsed: 80, resetsAt: new Date(NOW - 1).toISOString() }, NOW)).toBe(0)
  expect(live({ kind: 'five_hour', percentUsed: 80, resetsAt: null }, NOW)).toBe(80)
})

test('a meter stored by any older version is repaired, not trusted', () => {
  expect(sane(null)).toBe(null)
  expect(sane('x')).toBe(null)
  const m = sane({ contextTokens: 'lots', contextWindow: 200_000, limits: [{ kind: 'five_hour', percentUsed: 'NaN' }, { kind: 'seven_day', percentUsed: 12, resetsAt: 'junk' }] })
  expect(m?.contextTokens).toBe(null)
  expect(m?.limits.length).toBe(1)
  expect(m?.limits[0]?.resetsAt).toBe(null)
})

test('a passed reset shows 0% and a reset chip', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 50_000, window: 200_000 }, rateLimits: [
    { kind: 'five_hour', percentUsed: 90, resetsAt: new Date(NOW - 60_000).toISOString() },
  ] } }))
  on('store.get', () => ({ value: undefined }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '0%' })).toBeDefined()
  expect(await alts(ui)).toContain('reset')
  // Context worked out from tokens when the percent is missing: 50k of 200k.
  expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
  expect(await alts(ui)).toContain('50k / 200k')
  await ui.unmount()
})

test('with an API key the plan limits are left out', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 10_000, window: 200_000, percent: 5 }, rateLimits: [] } }))
  on('session.identity', () => ({ value: { kind: 'api-key', isVerified: false } }))
  on('store.get', () => ({ value: undefined }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '5-hour limit' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'Context' })).toBeDefined()
  await ui.unmount()
})

test('the countdown style is used once chosen', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [
    { kind: 'five_hour', percentUsed: 40, resetsAt: new Date(NOW + 86 * 60_000).toISOString() },
  ] } }))
  on('store.get', (_, e) => ({ value: e.key === 'resetStyle' ? 'countdown' : undefined }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    if (surface === 'desktop') expect((await alts(ui)).some(a => a.startsWith('1h 26m'))).toBe(true)
    else expect(await ui.find({ type: 'Text', text: /^1h 26m/ })).toBeDefined()
    await ui.unmount()
  }
})

test('clicking a reset time switches every reset between clock time and countdown', async ($, on) => {
  let saved: unknown
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [
    { kind: 'five_hour', percentUsed: 40, resetsAt: new Date(NOW + 86 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(NOW + 30 * 3_600_000).toISOString() },
  ] } }))
  on('store.get', (_, e) => ({ value: e.key === 'resetStyle' ? saved : undefined }))
  on('store.set', (_, e) => { if (e.key === 'resetStyle') saved = e.value; return { value: undefined } })

  // Terminal: each reset time is a plain button.
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'swap-five_hour' })
  expect(saved).toBe('countdown')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: '1h 26m ⇄' })).toBeDefined()
  await ui.unmount()

  // Desktop: drawn pills with a swap arrow, clicked through their click layers.
  const dk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await alts(dk)).some(a => a.startsWith('1h 26m, click to show clock time'))).toBe(true)
  await dk.post({ action: 'swap' }, { in: 'hit-swap-seven_day' })
  expect(saved).toBe('clock')
  await dk.redraw()
  expect((await alts(dk)).some(a => / (AM|PM), click to show countdown$/.test(a))).toBe(true)
  await dk.unmount()
})

test('the click layer switches on a left click only', async ($, on) => {
  let saved: unknown
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [
    { kind: 'five_hour', percentUsed: 40, resetsAt: new Date(NOW + 86 * 60_000).toISOString() },
  ] } }))
  on('store.get', (_, e) => ({ value: e.key === 'resetStyle' ? saved : undefined }))
  on('store.set', (_, e) => { if (e.key === 'resetStyle') saved = e.value; return { value: undefined } })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'right', in: 'hit-swap-five_hour' } as never)
  expect(saved).toBe(undefined)
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'hit-swap-five_hour' } as never)
  expect(saved).toBe('countdown')
  await ui.unmount()
})

test('the context figure is not a switch', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 50_000, window: 200_000 }, rateLimits: [] } }))
  on('store.get', () => ({ value: undefined }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await alts(ui)).toContain('50k / 200k')
  expect((await alts(ui)).some(a => a.includes('click to show'))).toBe(false)
  await ui.unmount()
})
