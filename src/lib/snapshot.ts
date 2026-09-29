/**
 * Pure snapshot logic shared by scripts/snapshot.ts, the app and the tests:
 * canonical form, validation, latest-10 reconciliation, escalation checks and
 * deterministic serialisation.
 */
import { DAY_MAX, MONTH_MAX, PICKS, sortNewestFirst } from './normalize.ts'
import { TIER_KEYS, type LuckyDayDraw, type SnapshotFile } from './types.ts'

export const DATASET_ID = 'uae-lottery-lucky-day'
export const SNAPSHOT_SCHEMA_VERSION = 1

/**
 * The source fields of a draw in a fixed key order. Local bookkeeping such as
 * firstSeenAt/updatedAt is intentionally dropped.
 */
export function toCanonical(d: LuckyDayDraw): LuckyDayDraw {
  const tiers = {} as LuckyDayDraw['tiers']
  for (const k of TIER_KEYS) {
    const t = d.tiers[k]
    tiers[k] = { winners: t?.winners ?? null, prize: t?.prize ?? null, totalPaid: t?.totalPaid ?? null }
  }
  return {
    drawNo: d.drawNo,
    timestamp: d.timestamp,
    drawDateUae: d.drawDateUae,
    drawDateTimeUae: d.drawDateTimeUae,
    weekday: d.weekday,
    numbers: [...d.numbers],
    luckyMonth: d.luckyMonth,
    tiers,
    totalWinners: d.totalWinners,
    luckyChanceIds: [...d.luckyChanceIds],
    rulesVersion: d.rulesVersion,
  }
}

/** Stable string of the source fields only, used for equality checks. */
export const canonicalSourceFields = (d: LuckyDayDraw): string => JSON.stringify(toCanonical(d))

/** Returns a list of problems; empty means valid. */
export function validateDraws(draws: LuckyDayDraw[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const d of draws) {
    if (seen.has(d.drawNo)) errors.push(`duplicate draw number ${d.drawNo}`)
    seen.add(d.drawNo)
    if (d.numbers.length !== PICKS || new Set(d.numbers).size !== PICKS ||
        !d.numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= DAY_MAX)) {
      errors.push(`draw ${d.drawNo}: invalid day numbers ${JSON.stringify(d.numbers)}`)
    }
    if (d.luckyMonth !== null && !(Number.isInteger(d.luckyMonth) && d.luckyMonth >= 1 && d.luckyMonth <= MONTH_MAX)) {
      errors.push(`draw ${d.drawNo}: invalid Lucky Month ${d.luckyMonth}`)
    }
    if (!Number.isFinite(d.timestamp) || !/^\d{4}-\d{2}-\d{2}$/.test(d.drawDateUae)) {
      errors.push(`draw ${d.drawNo}: invalid timestamp/date`)
    }
  }
  return errors
}

export interface ReconcileResult {
  merged: LuckyDayDraw[]
  added: string[]
  updated: string[]
  unchanged: string[]
}

/** Merge fetched draws into existing ones by drawNo. Existing draws are never removed. */
export function reconcile(existing: LuckyDayDraw[], fetched: LuckyDayDraw[]): ReconcileResult {
  const byNo = new Map(existing.map((d) => [d.drawNo, toCanonical(d)]))
  const res: ReconcileResult = { merged: [], added: [], updated: [], unchanged: [] }
  for (const f of fetched) {
    const cur = byNo.get(f.drawNo)
    if (!cur) res.added.push(f.drawNo)
    else if (canonicalSourceFields(cur) !== canonicalSourceFields(f)) res.updated.push(f.drawNo)
    else {
      res.unchanged.push(f.drawNo)
      continue
    }
    byNo.set(f.drawNo, toCanonical(f))
  }
  res.merged = sortNewestFirst([...byNo.values()])
  return res
}

/**
 * Should an incremental run escalate to a full rebuild? Returns a reason, or
 * null when latest-10 reconciliation is enough.
 */
export function needsFullRebuild(
  existing: LuckyDayDraw[],
  latest: LuckyDayDraw[],
  apiHistoryStart?: string | null,
): string | null {
  if (!existing.length) return 'no existing snapshot'
  const newestExisting = sortNewestFirst(existing)[0]
  const oldestExisting = sortNewestFirst(existing)[existing.length - 1]
  if (latest.length) {
    const inWindow = latest.some((d) => d.drawNo === newestExisting.drawNo)
    const oldestFetched = sortNewestFirst(latest)[latest.length - 1]
    if (!inWindow && oldestFetched.timestamp > newestExisting.timestamp) {
      return `gap: snapshot newest ${newestExisting.drawNo} is older than the latest-10 window (oldest ${oldestFetched.drawNo})`
    }
  }
  if (apiHistoryStart && apiHistoryStart < oldestExisting.drawDateUae) {
    return `API history starts ${apiHistoryStart}, before snapshot oldest ${oldestExisting.drawDateUae}`
  }
  return null
}

/** Merged-set safety checks. Returns problems; empty means OK. */
export function validateMerge(previous: LuckyDayDraw[], merged: LuckyDayDraw[], mode: 'incremental' | 'full'): string[] {
  const errors = validateDraws(merged)
  const mergedNos = new Set(merged.map((d) => d.drawNo))
  const missing = previous.filter((d) => !mergedNos.has(d.drawNo)).map((d) => d.drawNo)
  if (mode === 'incremental') {
    if (missing.length) errors.push(`incremental update would remove draws: ${missing.join(', ')}`)
    if (merged.length < previous.length) errors.push(`draw count fell from ${previous.length} to ${merged.length}`)
  } else if (merged.length < Math.floor(previous.length * 0.95)) {
    errors.push(`suspected collapse: full rebuild has ${merged.length} draws, previous snapshot had ${previous.length}`)
  }
  return errors
}

export function buildSnapshot(draws: LuckyDayDraw[], snapshotGeneratedAt: string): SnapshotFile {
  const sorted = sortNewestFirst(draws).map(toCanonical)
  return {
    datasetId: DATASET_ID,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotGeneratedAt,
    drawCount: sorted.length,
    latestDrawNo: sorted[0]?.drawNo ?? null,
    latestDrawDate: sorted[0]?.drawDateUae ?? null,
    historyStart: sorted[sorted.length - 1]?.drawDateUae ?? null,
    historyEnd: sorted[0]?.drawDateUae ?? null,
    draws: sorted,
  }
}

export const serializeSnapshot = (s: SnapshotFile): string => JSON.stringify(s, null, 1) + '\n'

/** True when both lists hold exactly the same draws with the same source fields. */
export function sameDraws(a: LuckyDayDraw[], b: LuckyDayDraw[]): boolean {
  if (a.length !== b.length) return false
  const sa = sortNewestFirst(a).map(canonicalSourceFields)
  const sb = sortNewestFirst(b).map(canonicalSourceFields)
  return sa.every((x, i) => x === sb[i])
}

/**
 * Decide the snapshot to publish. If draw data is unchanged, the previous file
 * is returned untouched, including its snapshotGeneratedAt, so nothing gets
 * rewritten or redeployed.
 */
export function decideSnapshot(previous: SnapshotFile | null, merged: LuckyDayDraw[], now: string) {
  if (previous && sameDraws(previous.draws, merged)) return { changed: false as const, file: previous }
  return { changed: true as const, file: buildSnapshot(merged, now) }
}

/** Parse and validate a snapshot file loaded from disk or over HTTP. */
export function parseSnapshot(json: unknown): SnapshotFile {
  const s = json as SnapshotFile
  if (!s || s.datasetId !== DATASET_ID || !Array.isArray(s.draws)) throw new Error('not a Lucky Day snapshot file')
  const errors = validateDraws(s.draws)
  if (errors.length) throw new Error(`snapshot is invalid: ${errors.slice(0, 5).join('; ')}`)
  return s
}
