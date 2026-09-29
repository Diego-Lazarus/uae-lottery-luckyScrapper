/**
 * Where "Get Results" gets its draws from.
 *
 * - SnapshotSource (production): the same-origin data/luckyday.json that the
 *   GitHub Action publishes. The official API cannot be called from other
 *   origins because of CORS.
 * - LiveApiSource (dev only): the official API through the Vite dev proxy,
 *   running the same paging code as the snapshot script.
 */
import { fetchAllDraws, fetchHistoryRange, fetchLatest } from './api.ts'
import { applyMode } from './filter.ts'
import { parseSnapshot } from './snapshot.ts'
import type { DateRange, LuckyDayDraw, ProgressInfo, RetrievalMode } from './types.ts'

export type SourceStep = { step: 'fetching' } | { step: 'page'; info: ProgressInfo }

export interface SourceResult {
  draws: LuckyDayDraw[]
  historyStart: string | null
  historyEnd: string | null
  snapshotGeneratedAt: string | null
}

export interface DrawSource {
  kind: 'snapshot' | 'live'
  label: string
  getDraws(mode: RetrievalMode, range: DateRange, onStep: (s: SourceStep) => void): Promise<SourceResult>
}

export class SnapshotSource implements DrawSource {
  kind = 'snapshot' as const
  label = 'Published snapshot'
  private url: string
  constructor(url: string) {
    this.url = url
  }

  async getDraws(mode: RetrievalMode, range: DateRange, onStep: (s: SourceStep) => void): Promise<SourceResult> {
    onStep({ step: 'fetching' })
    const res = await fetch(this.url, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`Could not load the results snapshot (HTTP ${res.status}).`)
    const snap = parseSnapshot(await res.json())
    return {
      draws: applyMode(snap.draws, mode, range),
      historyStart: snap.historyStart,
      historyEnd: snap.historyEnd,
      snapshotGeneratedAt: snap.snapshotGeneratedAt,
    }
  }
}

export class LiveApiSource implements DrawSource {
  kind = 'live' as const
  label = 'Live API (dev proxy)'

  async getDraws(mode: RetrievalMode, range: DateRange, onStep: (s: SourceStep) => void): Promise<SourceResult> {
    const opts = { baseUrl: '', onProgress: (info: ProgressInfo) => onStep({ step: 'page', info }) }
    onStep({ step: 'fetching' })
    const history = await fetchHistoryRange(opts)
    let draws: LuckyDayDraw[]
    if (mode === 'latest') draws = await fetchLatest(opts)
    else draws = await fetchAllDraws(opts, mode === 'all' ? undefined : range.from)
    return {
      draws: applyMode(draws, mode, range),
      historyStart: history?.startDate ?? null,
      historyEnd: history?.endDate ?? null,
      snapshotGeneratedAt: null,
    }
  }
}
