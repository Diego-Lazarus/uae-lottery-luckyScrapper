import { describe, expect, it } from 'vitest'
import { fetchAllDraws, fetchHistoryRange, fetchLatest } from '../src/lib/api.ts'
import { normalizeDraw, uaeParts } from '../src/lib/normalize.ts'
import { validateDraws } from '../src/lib/snapshot.ts'
import { DRAWS, RAW, byNo, fakeApi, noSleep } from './helpers.ts'

describe('normalizeDraw', () => {
  it('parses draw 260926 exactly', () => {
    const d = byNo('260926')
    expect(d.drawDateUae).toBe('2026-09-26')
    expect(d.drawDateTimeUae).toBe('2026-09-26 21:30')
    expect(d.weekday).toBe('Saturday')
    expect(d.numbers).toEqual([2, 5, 10, 12, 21, 22])
    expect(d.luckyMonth).toBe(1)
    expect(d.tiers.prize4.winners).toBe(33)
    expect(d.tiers.prize5.winners).toBe(4591)
    expect(d.totalWinners).toBe(4627)
    expect(d.luckyChanceIds).toEqual(['CC5320391', 'AZ2412688', 'DT9663576'])
    expect(d.rulesVersion).toBe('1.0.2')
    expect(typeof d.drawNo).toBe('string')
  })

  it('keeps the nominal prize separate from the amount paid', () => {
    const j = byNo('260926').tiers.prize1
    expect(j).toEqual({ winners: 0, prize: 30000000, totalPaid: 0 })
  })

  it('handles the full history: 94 valid, unique draws with 6 sorted numbers', () => {
    expect(DRAWS).toHaveLength(94)
    expect(validateDraws(DRAWS)).toEqual([])
    for (const d of DRAWS) expect([...d.numbers].sort((a, b) => a - b)).toEqual(d.numbers)
    expect(DRAWS.at(-1)!.drawDateUae).toBe('2024-12-14')
    expect(DRAWS.at(-1)!.drawDateTimeUae).toBe('2024-12-14 20:30') // earlier rules drew at 20:30
  })

  it('computes UAE dates independently of the machine timezone', () => {
    const original = process.env.TZ
    try {
      for (const tz of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
        process.env.TZ = tz
        const d = normalizeDraw(RAW[0])
        expect(d.drawDateTimeUae).toBe('2026-09-26 21:30')
      }
    } finally {
      process.env.TZ = original
    }
    // 23:59 UAE is still the same UAE day even though it is 19:59 UTC
    expect(uaeParts(Date.UTC(2026, 0, 1, 19, 59))).toMatchObject({ year: 2026, month: 1, day: 1, hour: 23 })
    expect(uaeParts(Date.UTC(2026, 0, 1, 20, 0))).toMatchObject({ day: 2, hour: 0 })
  })

  it('rejects malformed draws', () => {
    const bad = structuredClone(RAW[0])
    bad.result = bad.result!.map((r) => (r.key === 'day' ? { ...r, data: ['01', '02', '03'] } : r))
    expect(() => normalizeDraw(bad)).toThrow(/invalid day numbers/)
    const badMonth = structuredClone(RAW[0])
    badMonth.result = badMonth.result!.map((r) => (r.key === 'month' ? { ...r, data: ['13'] } : r))
    expect(() => normalizeDraw(badMonth)).toThrow(/Lucky Month/)
  })
})

describe('API paging', () => {
  it('latest uses prePhases=10, alreadyDrawn=1, includeSelf=1', async () => {
    const api = fakeApi()
    const latest = await fetchLatest({ fetchImpl: api.fetchImpl, sleep: noSleep })
    expect(latest.map((d) => d.drawNo)).toEqual(RAW.slice(0, 10).map((p) => p.phase))
    const q = api.calls[0]
    expect([q.get('prePhases'), q.get('alreadyDrawn'), q.get('includeSelf'), q.get('phase')]).toEqual(['10', '1', '1', null])
  })

  it('pages back through the whole history using the oldest draw number', async () => {
    const api = fakeApi()
    const pages: number[] = []
    const all = await fetchAllDraws({ fetchImpl: api.fetchImpl, sleep: noSleep, onProgress: (p) => pages.push(p.page) })
    expect(all).toHaveLength(94)
    expect(new Set(all.map((d) => d.drawNo)).size).toBe(94)
    expect(pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const second = api.calls[1]
    expect(second.get('phase')).toBe(RAW[9].phase)
    expect([second.get('alreadyDrawn'), second.get('includeSelf'), second.get('prePhases')]).toEqual(['0', '0', '10'])
    expect(api.calls.every((q) => Number(q.get('prePhases')) <= 10)).toBe(true)
  })

  it('stops when a page returns no new draws (duplicate page)', async () => {
    const dupes = [...RAW.slice(0, 10)]
    const fetchImpl = (async () => Response.json({ code: 0, data: { phaseList: dupes } })) as unknown as typeof fetch
    const all = await fetchAllDraws({ fetchImpl, sleep: noSleep })
    expect(all).toHaveLength(10)
  })

  it('stops paging early once past a requested start date', async () => {
    const api = fakeApi()
    const some = await fetchAllDraws({ fetchImpl: api.fetchImpl, sleep: noSleep }, '2026-08-01')
    expect(api.calls.length).toBeLessThan(10)
    expect(some.at(-1)!.drawDateUae < '2026-08-01').toBe(true)
  })

  it('retries transient errors and then succeeds', async () => {
    const api = fakeApi(RAW, { failTimes: 2 })
    const waits: number[] = []
    const latest = await fetchLatest({ fetchImpl: api.fetchImpl, sleep: async (ms) => { waits.push(ms) } })
    expect(latest).toHaveLength(10)
    expect(waits).toEqual([2000, 4000])
  })

  it('gives up after 4 attempts', async () => {
    const api = fakeApi(RAW, { failTimes: 10 })
    await expect(fetchLatest({ fetchImpl: api.fetchImpl, sleep: noSleep })).rejects.toThrow(/HTTP 503/)
    expect(api.calls).toHaveLength(4)
  })

  it('reads the history range', async () => {
    const api = fakeApi()
    expect(await fetchHistoryRange({ fetchImpl: api.fetchImpl, sleep: noSleep })).toEqual({ startDate: '2024-12-14', endDate: '2026-09-26' })
  })
})
