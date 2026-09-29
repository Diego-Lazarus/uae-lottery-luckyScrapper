export const TIER_KEYS = ['prize1', 'prize2', 'prize3', 'prize4', 'prize5', 'rafflePrize'] as const
export type TierKey = (typeof TIER_KEYS)[number]

export interface TierResult {
  /** Winning tickets in the tier (API `bet`). */
  winners: number | null
  /** Nominal prize per winner in AED (API `prize`), shown even with 0 winners. */
  prize: number | null
  /** Amount actually paid in AED (API `totalPrize`). */
  totalPaid: number | null
}

/** One normalized Lucky Day draw. All fields come from the official API. */
export interface LuckyDayDraw {
  /** Official series number, e.g. "260926". An identifier, never a quantity. */
  drawNo: string
  /** Draw time as a UTC epoch in milliseconds. */
  timestamp: number
  /** Draw date in UAE time (UTC+4), `YYYY-MM-DD`. */
  drawDateUae: string
  /** Draw date/time in UAE time, `YYYY-MM-DD HH:mm`. */
  drawDateTimeUae: string
  weekday: string
  /** Six Day numbers 1-31, sorted ascending (the API does not publish ball order). */
  numbers: number[]
  /** Lucky Month 1-12. */
  luckyMonth: number | null
  tiers: Record<TierKey, TierResult>
  totalWinners: number | null
  luckyChanceIds: string[]
  /** API `configVersion`. */
  rulesVersion: string | null
}

/** A draw as kept in IndexedDB: source fields plus local bookkeeping. */
export interface StoredDraw extends LuckyDayDraw {
  firstSeenAt: string
  updatedAt: string
}

export type RetrievalMode = 'latest' | 'from' | 'range' | 'all'

export interface DateRange {
  from?: string
  to?: string
}

export interface UpsertSummary {
  added: number
  updated: number
  unchanged: number
  total: number
}

export interface DatasetMeta {
  datasetId: 'uae-lottery-lucky-day'
  schemaVersion: number
  createdAt: string
  lastApiCheckAt: string | null
  lastDataChangeAt: string | null
  totalDraws: number
  oldestDraw: { drawNo: string; date: string } | null
  newestDraw: { drawNo: string; date: string } | null
  apiHistoryStart: string | null
  apiHistoryEnd: string | null
  snapshotGeneratedAt: string | null
  lastMode: RetrievalMode | null
  lastRange: DateRange | null
  /** Incremented only when a draw is added or changed. */
  dataRevision: number
  /** `dataRevision` at the time of the last XLSX export. */
  lastExportRevision: number
  /** When the XLSX was last exported (used to count draws changed since). */
  lastExportAt: string | null
}

/** Published snapshot file (public/data/luckyday.json). */
export interface SnapshotFile {
  datasetId: 'uae-lottery-lucky-day'
  schemaVersion: number
  /** Changes only when draw data changes. */
  snapshotGeneratedAt: string
  drawCount: number
  latestDrawNo: string | null
  latestDrawDate: string | null
  historyStart: string | null
  historyEnd: string | null
  draws: LuckyDayDraw[]
}

export interface ProgressInfo {
  page: number
  total: number
  oldest: string | null
}
