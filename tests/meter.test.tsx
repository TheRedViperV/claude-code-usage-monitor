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
    expect(await ui.find({ type: 'Text', text: 'Session' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '17%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '11%' })).toBeDefined()
    await ui.unmount()
  }
})

test('with nothing saved anywhere, Session and Weekly still hold their place', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('store.get', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Session' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Weekly' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'after first reply' })).toBeDefined()
  await ui.unmount()
})
