import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearAll, closeDb, getAllDraws, getMeta, markExported, upsertDraws } from '../src/lib/db.ts'
import { applyMode } from '../src/lib/filter.ts'
import {
  buildSnapshot, decideSnapshot, needsFullRebuild, parseSnapshot, reconcile, serializeSnapshot, validateDraws, validateMerge,
} from '../src/lib/snapshot.ts'
import type { LuckyDayDraw } from '../src/lib/types.ts'
import { DRAWS } from './helpers.ts'

const older = DRAWS.slice(1) // snapshot missing the newest draw
const latest10 = DRAWS.slice(0, 10)
const T0 = '2026-09-27T00:00:00.000Z'

describe('snapshot reconciliation', () => {
  it('is a no-op when the latest 10 are already stored', () => {
    const prev = buildSnapshot(DRAWS, T0)
    const r = reconcile(prev.draws, latest10)
    expect([r.added.length, r.updated.length, r.unchanged.length]).toEqual([0, 0, 10])
    const d = decideSnapshot(prev, r.merged, '2026-09-30T18:05:00.000Z')
    expect(d.changed).toBe(false)
    expect(d.file.snapshotGeneratedAt).toBe(T0)
    expect(serializeSnapshot(d.file)).toBe(serializeSnapshot(prev))
  })

  it('adds a newly published draw', () => {
    const prev = buildSnapshot(older, T0)
    const r = reconcile(prev.draws, latest10)
    expect(r.added).toEqual(['260926'])
    const d = decideSnapshot(prev, r.merged, '2026-09-30T18:05:00.000Z')
    expect(d.changed).toBe(true)
    expect(d.file.drawCount).toBe(prev.drawCount + 1)
    expect(d.file.latestDrawNo).toBe('260926')
    expect(d.file.snapshotGeneratedAt).toBe('2026-09-30T18:05:00.000Z')
  })

  it('replaces a corrected recent draw', () => {
    const prev = buildSnapshot(DRAWS, T0)
    const fixed = latest10.map((d) => (d.drawNo === '260923' ? { ...d, totalWinners: 1 } : d))
    const r = reconcile(prev.draws, fixed)
    expect(r.updated).toEqual(['260923'])
    expect(r.merged.find((d) => d.drawNo === '260923')!.totalWinners).toBe(1)
    expect(decideSnapshot(prev, r.merged, 'x').changed).toBe(true)
  })

  it('escalates to a full rebuild when more than 10 draws were missed', () => {
    expect(needsFullRebuild(DRAWS.slice(15), latest10)).toMatch(/gap/)
    expect(needsFullRebuild(DRAWS.slice(5), latest10)).toBeNull()
    expect(needsFullRebuild([], latest10)).toMatch(/no existing/)
  })

  it('escalates when the API history starts before the snapshot', () => {
    expect(needsFullRebuild(DRAWS.slice(0, 50), latest10, '2024-12-14')).toMatch(/history starts/)
    expect(needsFullRebuild(DRAWS, latest10, '2024-12-14')).toBeNull()
  })

  it('rejects removals, collapse, duplicates and invalid numbers', () => {
    expect(validateMerge(DRAWS, DRAWS.slice(1), 'incremental').join()).toMatch(/remove draws/)
    expect(validateMerge(DRAWS, DRAWS.slice(0, 50), 'full').join()).toMatch(/collapse/)
    expect(validateMerge(DRAWS, DRAWS.slice(0, 92), 'full')).toEqual([])
    expect(validateDraws([DRAWS[0], DRAWS[0]]).join()).toMatch(/duplicate/)
    expect(validateDraws([{ ...DRAWS[0], numbers: [1, 2, 3, 4, 5, 40] }]).join()).toMatch(/invalid day numbers/)
    expect(validateDraws([{ ...DRAWS[0], luckyMonth: 0 }]).join()).toMatch(/Lucky Month/)
  })

  it('serialises deterministically and round-trips', () => {
    const a = serializeSnapshot(buildSnapshot([...DRAWS].reverse(), T0))
    const b = serializeSnapshot(buildSnapshot(DRAWS, T0))
    expect(a).toBe(b)
    const parsed = parseSnapshot(JSON.parse(a))
    expect(parsed.drawCount).toBe(94)
    expect(parsed.historyStart).toBe('2024-12-14')
    expect(parsed.historyEnd).toBe('2026-09-26')
  })
})

describe('retrieval modes', () => {
  it('filters by mode', () => {
    expect(applyMode(DRAWS, 'latest').map((d) => d.drawNo)).toEqual(latest10.map((d) => d.drawNo))
    expect(applyMode(DRAWS, 'all')).toHaveLength(94)
    expect(applyMode(DRAWS, 'from', { from: '2026-09-01' }).every((d) => d.drawDateUae >= '2026-09-01')).toBe(true)
    const r = applyMode(DRAWS, 'range', { from: '2025-06-01', to: '2025-07-31' })
    expect(r.map((d) => d.drawNo)).toEqual(['250726', '250712', '250628', '250614'])
    expect(() => applyMode(DRAWS, 'range', { from: '2026-01-02', to: '2026-01-01' })).toThrow()
  })
})

describe('IndexedDB upsert', () => {
  beforeEach(async () => {
    await clearAll()
  })

  it('adds, then leaves identical records unchanged without bumping the revision', async () => {
    const first = await upsertDraws(applyMode(DRAWS, 'latest'), { mode: 'latest', now: T0 })
    expect(first.summary).toEqual({ added: 10, updated: 0, unchanged: 0, total: 10 })
    expect(first.meta.dataRevision).toBe(1)

    const again = await upsertDraws(applyMode(DRAWS, 'latest'), { mode: 'latest', now: '2026-09-28T00:00:00.000Z' })
    expect(again.summary).toEqual({ added: 0, updated: 0, unchanged: 10, total: 10 })
    expect(again.meta.dataRevision).toBe(1)
    expect(again.meta.lastDataChangeAt).toBe(T0)
    expect(again.meta.lastApiCheckAt).toBe('2026-09-28T00:00:00.000Z')
  })

  it('merges every mode into one dataset without duplicates', async () => {
    await upsertDraws(applyMode(DRAWS, 'latest'), { mode: 'latest' })
    await upsertDraws(applyMode(DRAWS, 'from', { from: '2025-01-01' }), { mode: 'from', range: { from: '2025-01-01' } })
    const { summary, meta } = await upsertDraws(applyMode(DRAWS, 'all'), { mode: 'all' })
    expect(summary.total).toBe(94)
    expect(summary.unchanged + summary.added).toBe(94)
    expect(meta.oldestDraw).toEqual({ drawNo: '241214', date: '2024-12-14' })
    expect(meta.newestDraw).toEqual({ drawNo: '260926', date: '2026-09-26' })
    expect(meta.dataRevision).toBe(3)
    expect(new Set((await getAllDraws()).map((d) => d.drawNo)).size).toBe(94)
  })

  it('updates changed records, keeps firstSeenAt, and ignores bookkeeping in comparisons', async () => {
    await upsertDraws(DRAWS.slice(0, 3), { mode: 'latest', now: T0 })
    const changed: LuckyDayDraw[] = [{ ...DRAWS[0], totalWinners: 9999 }, DRAWS[1], DRAWS[2]]
    const r = await upsertDraws(changed, { mode: 'latest', now: '2026-09-30T00:00:00.000Z' })
    expect(r.summary).toMatchObject({ added: 0, updated: 1, unchanged: 2 })
    const stored = (await getAllDraws()).find((d) => d.drawNo === DRAWS[0].drawNo)!
    expect(stored.totalWinners).toBe(9999)
    expect(stored.firstSeenAt).toBe(T0)
    expect(stored.updatedAt).toBe('2026-09-30T00:00:00.000Z')
    expect(r.meta.dataRevision).toBe(2)
  })

  it('persists across a reconnect (simulated page reload) and tracks exports', async () => {
    await upsertDraws(DRAWS, { mode: 'all', snapshotGeneratedAt: T0, historyStart: '2024-12-14', historyEnd: '2026-09-26' })
    await closeDb()
    expect(await getAllDraws()).toHaveLength(94)
    const meta = (await getMeta())!
    expect(meta.snapshotGeneratedAt).toBe(T0)
    expect(meta.dataRevision - meta.lastExportRevision).toBe(1)
    const after = (await markExported())!
    expect(after.lastExportRevision).toBe(after.dataRevision)
  })
})
