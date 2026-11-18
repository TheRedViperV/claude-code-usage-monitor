export type Limit = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  kind: string
  /** 0-100, may pass 100 on an exceeded spend limit. */
  percentUsed: number
  /** ISO 8601 reset time. */
  resetsAt: string | null
}

export type Meter = {
  /** Context window fill from the last response. */
  contextTokens: number | null
  contextWindow: number
  contextPercent: number | null
  /** Unused since 0.2; kept so stored values still match. */
  usd: number | null
  limits: Limit[]
  /**
   * When `limits` was read (ms), from this chat or, via `$.store`, another.
   * Optional so meters stored by 0.2 still match.
   */
  limitsAt?: number | null
}

/** Last-known limits shared by every chat through `$.store` under `limits`. */
export type SharedLimits = { limits: Limit[]; savedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { meter: Meter | null }
  }
}
