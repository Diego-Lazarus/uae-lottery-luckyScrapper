/**
 * Client for the official UAE Lottery results API. This mirrors the verified
 * Python reference (luckyday_scraper.py):
 *
 *  - latest page:     prePhases=10 & alreadyDrawn=1 & includeSelf=1
 *  - older pages:     phase=<oldest drawNo so far> & alreadyDrawn=0 & includeSelf=0
 *  - prePhases is never above 10 (the API rejects larger values)
 *
 * Browsers cannot call this API cross-origin (CORS allows only
 * theuaelottery.ae), so production uses it from Node (the snapshot script).
 * In `npm run dev` the Vite proxy makes it same-origin.
 */
import { normalizeDraw, type RawPhase } from './normalize.ts'
import type { LuckyDayDraw, ProgressInfo } from './types.ts'

export const LOTTERY_TYPE = 61
export const PAGE_SIZE = 10
const MAX_PAGES = 100

export interface ApiOptions {
  /** '' for same-origin (dev proxy) or 'https://www.theuaelottery.ae'. */
  baseUrl?: string
  fetchImpl?: typeof fetch
  headers?: Record<string, string>
  sleep?: (ms: number) => Promise<void>
  delayMs?: number
  retries?: number
  onProgress?: (p: ProgressInfo) => void
  log?: (msg: string) => void
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function callApi(command: string, params: Record<string, string | number>, opts: ApiOptions) {
  const { baseUrl = 'https://www.theuaelottery.ae', fetchImpl = fetch, sleep = defaultSleep, retries = 4 } = opts
  const qs = new URLSearchParams({ command, lang: 'en-US', lotteryType: String(LOTTERY_TYPE) })
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
  const url = `${baseUrl}/qapi/command/execute?${qs}`

  let lastError: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json', ...opts.headers } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      if (body?.code !== 0) throw new Error(`API error ${body?.code}: ${body?.message}`)
      return body.data
    } catch (e) {
      lastError = e
      if (attempt < retries) {
        opts.log?.(`  retrying after error: ${(e as Error).message}`)
        await sleep(2000 * attempt)
      }
    }
  }
  throw lastError
}

/** One page of up to 10 raw phases. */
export async function fetchPage(opts: ApiOptions, beforeDrawNo?: string): Promise<RawPhase[]> {
  const params: Record<string, string | number> = { isDesc: 1, prePhases: PAGE_SIZE }
  if (beforeDrawNo) Object.assign(params, { phase: beforeDrawNo, alreadyDrawn: 0, includeSelf: 0 })
  else Object.assign(params, { alreadyDrawn: 1, includeSelf: 1 })
  const data = await callApi('660301', params, opts)
  return (data?.phaseList ?? []) as RawPhase[]
}

/** The official latest 10 published draws. */
export async function fetchLatest(opts: ApiOptions = {}): Promise<LuckyDayDraw[]> {
  return (await fetchPage(opts)).map(normalizeDraw)
}

/**
 * Page back through the full history. `stopBefore` (YYYY-MM-DD, UAE) ends paging
 * once a page reaches draws older than that date.
 */
export async function fetchAllDraws(opts: ApiOptions = {}, stopBefore?: string): Promise<LuckyDayDraw[]> {
  const { sleep = defaultSleep, delayMs = 500 } = opts
  const seen = new Set<string>()
  const draws: LuckyDayDraw[] = []
  let before: string | undefined
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await fetchPage(opts, before)
    const fresh = batch.filter((d) => !seen.has(String(d.phase)))
    if (!fresh.length) break
    for (const raw of fresh) {
      seen.add(String(raw.phase))
      draws.push(normalizeDraw(raw))
    }
    before = String(fresh[fresh.length - 1].phase)
    opts.onProgress?.({ page, total: draws.length, oldest: before })
    opts.log?.(`  fetched ${draws.length} draws (oldest so far: ${before})`)
    if (batch.length < PAGE_SIZE) break
    if (stopBefore && draws[draws.length - 1].drawDateUae < stopBefore) break
    await sleep(delayMs)
  }
  return draws
}

/** History range reported by the site (command 660104). */
export async function fetchHistoryRange(opts: ApiOptions = {}): Promise<{ startDate: string; endDate: string } | null> {
  const data = await callApi('660104', {}, opts)
  const r = data?.lotteryTypePrizeTimeDto
  return r?.startTime && r?.endTime ? { startDate: r.startTime, endDate: r.endTime } : null
}
