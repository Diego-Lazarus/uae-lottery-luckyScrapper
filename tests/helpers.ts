import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeDraw, type RawPhase } from '../src/lib/normalize.ts'
import type { LuckyDayDraw } from '../src/lib/types.ts'

/** Full raw history captured by the verified Python scraper (newest first). */
export const RAW: RawPhase[] = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/raw-history.json'), 'utf8'))
export const DRAWS: LuckyDayDraw[] = RAW.map(normalizeDraw)
export const byNo = (no: string, list: LuckyDayDraw[] = DRAWS) => list.find((d) => d.drawNo === no)!

/** Fake fetch that serves RAW exactly like command 660301 / 660104 do. */
export function fakeApi(raw: RawPhase[] = RAW, opts: { failTimes?: number } = {}) {
  const calls: URLSearchParams[] = []
  let failures = opts.failTimes ?? 0
  const fetchImpl = (async (url: string) => {
    const qs = new URL(url).searchParams
    calls.push(qs)
    if (failures > 0) {
      failures--
      return new Response('oops', { status: 503 })
    }
    if (qs.get('command') === '660104') {
      const dates = raw.map((p) => normalizeDraw(p).drawDateUae).sort()
      return Response.json({ code: 0, data: { lotteryTypePrizeTimeDto: { startTime: dates[0], endTime: dates.at(-1) } } })
    }
    const size = Number(qs.get('prePhases'))
    if (size > 10) return Response.json({ code: 403000949, message: 'prePhases too large' })
    const phase = qs.get('phase')
    const start = phase ? raw.findIndex((p) => p.phase === phase) + 1 : 0
    return Response.json({ code: 0, message: 'ok', data: { phaseList: raw.slice(start, start + size) } })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

export const noSleep = async () => {}
