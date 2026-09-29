import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildWorkbookTables, drawFeatures, numberStats, pyRound, uaeExcelDate } from '../src/lib/features.ts'
import { buildWorkbookBuffer } from '../src/lib/xlsx.ts'
import type { LuckyDayDraw } from '../src/lib/types.ts'
import { DRAWS, byNo } from './helpers.ts'

const INFO = { generatedAt: '2026-09-29 00:00:00', generator: 'test' }
const SHEETS = ['Results', 'Draw Features', 'Numbers Long', 'Number Matrix', 'Day Number Stats', 'Month Stats',
  'Pair Frequency', 'Lucky Chance', 'Data Dictionary', 'Metadata']

describe('derived features', () => {
  it('matches the verified values for draw 260926', () => {
    const f = drawFeatures(byNo('260926'), byNo('260923'))
    expect(f).toMatchObject({
      Sum: 72, Mean: 12, Min: 2, Max: 22, Range: 20, 'Odd Count': 2, 'Even Count': 4, 'Low Count 1 to 15': 4,
      'High Count 16 to 31': 2, 'Consecutive Pairs': 1, 'Max Gap': 9, 'Repeats From Previous Draw': 0,
      'Contains Draw Day': 0, 'Lucky Month Equals Draw Month': 0,
    })
    expect(drawFeatures(byNo('260926'), null)['Repeats From Previous Draw']).toBeNull()
  })

  it('computes gap and recency stats on a hand-built dataset', () => {
    const mk = (i: number, numbers: number[]): LuckyDayDraw => ({
      ...byNo('260926'), drawNo: `D${i}`, timestamp: Date.UTC(2026, 0, i, 17, 30), numbers,
    })
    const chrono = [mk(1, [1, 2, 3, 4, 5, 6]), mk(2, [1, 7, 8, 9, 10, 11]), mk(3, [2, 7, 8, 9, 10, 11]),
      mk(4, [2, 7, 8, 9, 10, 12]), mk(5, [1, 7, 8, 9, 10, 13])]
    const stats = new Map(numberStats(chrono, (d) => d.numbers, [1, 2, 3, 31], 6 / 31))
    expect(stats.get(1)).toMatchObject({ 'Times Drawn': 3, 'Draws Since Last Seen': 0, 'Longest Gap Draws': 3, 'Average Gap Draws': 2 })
    expect(stats.get(2)).toMatchObject({ 'Times Drawn': 3, 'Draws Since Last Seen': 1, 'Longest Gap Draws': 2, 'Average Gap Draws': 1.5 })
    expect(stats.get(3)).toMatchObject({ 'Times Drawn': 1, 'Draws Since Last Seen': 4, 'Longest Gap Draws': null })
    expect(stats.get(31)).toMatchObject({ 'Times Drawn': 0, 'Last Drawn Date': null, 'Draws Since Last Seen': null })
  })

  it('rounds like Python (half-to-even on exact ties)', () => {
    // expected values produced by Python's round()
    expect(pyRound(12.0625, 3)).toBe(12.062) // exact tie -> even
    expect(pyRound(12.0875, 3)).toBe(12.088) // exact tie -> even
    expect(pyRound(12.0635, 3)).toBe(12.063) // not a tie: binary value is below .0635
    expect(pyRound(0.5, 0)).toBe(0)
    expect(pyRound(1.5, 0)).toBe(2)
    expect(pyRound(-2.5, 0)).toBe(-2)
    expect(pyRound(18.193548387, 3)).toBe(18.194)
    expect(pyRound(-0.4375, 3)).toBe(-0.438)
  })

  it('produces rectangular, analysis-friendly tables', () => {
    const tables = buildWorkbookTables(DRAWS, INFO)
    expect(tables.map((t) => t.name)).toEqual(SHEETS)
    for (const t of tables) {
      expect(new Set(t.header.map(String)).size, `${t.name} duplicate headers`).toBe(t.header.length)
      expect(t.header.every((h) => String(h).trim() !== ''), `${t.name} blank header`).toBe(true)
      expect(t.header.every((h) => !/[(),+]/.test(String(h))), `${t.name} special chars`).toBe(true)
      for (const r of t.rows) expect(r.length, `${t.name} ragged row`).toBe(t.header.length)
    }
  })

  it('keeps pair matrix symmetric with the diagonal equal to single counts', () => {
    const tables = buildWorkbookTables(DRAWS, INFO)
    const pair = tables.find((t) => t.name === 'Pair Frequency')!.rows.map((r) => r.slice(1) as number[])
    const day = tables.find((t) => t.name === 'Day Number Stats')!
    const timesIdx = day.header.indexOf('Times Drawn')
    for (let a = 0; a < 31; a++) {
      expect(pair[a][a]).toBe(day.rows[a][timesIdx])
      for (let b = 0; b < 31; b++) expect(pair[a][b]).toBe(pair[b][a])
    }
  })

  it('writes UAE wall-clock time regardless of the machine timezone', () => {
    const original = process.env.TZ
    try {
      for (const tz of ['America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = tz
        expect(uaeExcelDate(byNo('260926'), true).toISOString()).toBe('2026-09-26T21:30:00.000Z')
        expect(uaeExcelDate(byNo('260926')).toISOString()).toBe('2026-09-26T00:00:00.000Z')
      }
    } finally {
      process.env.TZ = original
    }
  })
})

describe('xlsx export round-trip', async () => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await buildWorkbookBuffer(DRAWS, INFO))
  const rows = (name: string) => {
    const out: unknown[][] = []
    wb.getWorksheet(name)!.eachRow((r) => out.push((r.values as unknown[]).slice(1)))
    return out
  }
  const header = (name: string) => rows(name)[0] as string[]
  const col = (name: string, h: string) => rows(name).slice(1).map((r) => r[header(name).indexOf(h)])

  it('has the expected sheets, with Metadata hidden', () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual(SHEETS)
    expect(wb.getWorksheet('Metadata')!.state).toBe('hidden')
    expect(wb.getWorksheet('Results')!.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
  })

  it('contains the verified 260926 row with a real date cell', () => {
    const h = header('Results')
    const r = rows('Results')[1]
    const get = (k: string) => r[h.indexOf(k)]
    expect(get('Draw No')).toBe('260926')
    expect((get('Draw Date') as Date).toISOString().slice(0, 10)).toBe('2026-09-26')
    expect(get('Draw Time UAE')).toBe('21:30')
    expect(['N1', 'N2', 'N3', 'N4', 'N5', 'N6'].map(get)).toEqual([2, 5, 10, 12, 21, 22])
    expect([get('Lucky Month'), get('Fourth Winners'), get('Fifth Winners'), get('Total Winners')]).toEqual([1, 33, 4591, 4627])
    expect(get('Lucky Chance IDs')).toBe('CC5320391, AZ2412688, DT9663576')
  })

  it('derives row counts and frequencies from the data', () => {
    const idCount = DRAWS.reduce((s, d) => s + d.luckyChanceIds.length, 0)
    expect(rows('Lucky Chance').length - 1).toBe(idCount)
    const sum = (a: unknown[]) => a.reduce<number>((s, x) => s + Number(x), 0)
    expect(sum(col('Day Number Stats', 'Times Drawn'))).toBe(6 * DRAWS.length)
    expect(sum(col('Month Stats', 'Times Drawn'))).toBe(DRAWS.filter((d) => d.luckyMonth !== null).length)
    expect(rows('Numbers Long').length - 1).toBe(DRAWS.length * 6 + DRAWS.filter((d) => d.luckyMonth !== null).length)
  })

  it('uses only static values (no formulas)', () => {
    for (const ws of wb.worksheets) {
      ws.eachRow((r) => r.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)))
    }
  })
})
