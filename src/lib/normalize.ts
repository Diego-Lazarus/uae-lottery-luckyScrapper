import { TIER_KEYS, type LuckyDayDraw, type TierKey, type TierResult } from './types.ts'

export const DAY_MAX = 31
export const MONTH_MAX = 12
export const PICKS = 6
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * UAE time is UTC+4 all year (no daylight saving). We shift the UTC epoch by
 * four hours and read it with UTC getters, which gives UAE wall-clock parts
 * that never depend on the timezone of the machine running this code.
 */
const UAE_OFFSET_MS = 4 * 60 * 60 * 1000

export interface UaeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** ISO weekday, Monday = 1 ... Sunday = 7. */
  isoWeekday: number
}

export function uaeParts(timestamp: number): UaeParts {
  const d = new Date(timestamp + UAE_OFFSET_MS)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    isoWeekday: ((d.getUTCDay() + 6) % 7) + 1,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Raw shapes from command 660301 (only the fields we use). */
export interface RawPhase {
  phase: string
  expectedPrizeTimestamp: string | number
  configVersion?: string
  result?: { key: string; data?: string[] }[]
  resultDetail?: { key: string; bet?: string | number | null; prize?: number | null; totalPrize?: number | null }[]
  totalWinningBetCount?: number | null
}

const toInt = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number.parseInt(String(v), 10)

/** Convert one API phase into a validated LuckyDayDraw. Throws on invalid data. */
export function normalizeDraw(raw: RawPhase): LuckyDayDraw {
  const result = new Map((raw.result ?? []).map((r) => [r.key, r.data ?? []]))
  const detail = new Map((raw.resultDetail ?? []).map((r) => [r.key, r]))
  const timestamp = Number(raw.expectedPrizeTimestamp)
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error(`draw ${raw.phase}: invalid timestamp ${raw.expectedPrizeTimestamp}`)
  }
  const numbers = (result.get('day') ?? []).map((x) => Number.parseInt(x, 10)).sort((a, b) => a - b)
  if (numbers.length !== PICKS || !numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= DAY_MAX)) {
    throw new Error(`draw ${raw.phase}: invalid day numbers ${JSON.stringify(result.get('day'))}`)
  }
  if (new Set(numbers).size !== PICKS) throw new Error(`draw ${raw.phase}: duplicate day numbers`)
  const monthRaw = result.get('month') ?? []
  const luckyMonth = monthRaw.length ? Number.parseInt(monthRaw[0], 10) : null
  if (luckyMonth !== null && !(luckyMonth >= 1 && luckyMonth <= MONTH_MAX)) {
    throw new Error(`draw ${raw.phase}: invalid Lucky Month ${monthRaw[0]}`)
  }

  const tiers = {} as Record<TierKey, TierResult>
  for (const key of TIER_KEYS) {
    const t = detail.get(key)
    tiers[key] = {
      winners: toInt(t?.bet),
      prize: t?.prize ?? null,
      totalPaid: t?.totalPrize ?? null,
    }
  }

  const p = uaeParts(timestamp)
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`
  return {
    drawNo: String(raw.phase),
    timestamp,
    drawDateUae: date,
    drawDateTimeUae: `${date} ${pad(p.hour)}:${pad(p.minute)}`,
    weekday: WEEKDAYS[p.isoWeekday - 1],
    numbers,
    luckyMonth,
    tiers,
    totalWinners: raw.totalWinningBetCount ?? null,
    luckyChanceIds: [...(result.get('raffle') ?? [])],
    rulesVersion: raw.configVersion ?? null,
  }
}

/** Newest first, by draw time then draw number. */
export function sortNewestFirst<T extends LuckyDayDraw>(draws: T[]): T[] {
  return [...draws].sort((a, b) => b.timestamp - a.timestamp || b.drawNo.localeCompare(a.drawNo))
}
