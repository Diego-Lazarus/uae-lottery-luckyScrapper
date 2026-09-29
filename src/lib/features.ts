/**
 * Analysis-ready workbook content, computed as plain tables (no Excel
 * formulas). This is a line-for-line port of build_workbook() in the Python
 * reference (luckyday_scraper.py). `npm run verify:reference` checks both
 * produce identical cells.
 *
 * Every table is derived from the FULL dataset passed in, never from a
 * single request.
 */
import { DAY_MAX, MONTH_MAX, PICKS, WEEKDAYS, uaeParts } from './normalize.ts'
import { TIER_KEYS, type LuckyDayDraw, type TierKey } from './types.ts'

export type Cell = string | number | Date | null

export interface SheetTable {
  name: string
  header: (string | number)[]
  rows: Cell[][]
  /** Column name -> Excel number format. */
  formats?: Record<string, string>
  /** Top-left unfrozen cell, e.g. "B2". */
  freeze: string
  width?: number
  hidden?: boolean
}

export const TIERS: { key: TierKey; label: string; rule: string }[] = [
  { key: 'prize1', label: 'Jackpot', rule: '6 numbers + Lucky Month (6+1); shared prize' },
  { key: 'prize2', label: 'Second', rule: '6 numbers, month wrong (6+0)' },
  { key: 'prize3', label: 'Third', rule: '5 numbers + month (5+1)' },
  { key: 'prize4', label: 'Fourth', rule: '5+0 or 4+1' },
  { key: 'prize5', label: 'Fifth', rule: '3+1, 2+1, 1+1 or 0+1' },
  { key: 'rafflePrize', label: 'Lucky Chance', rule: 'Lucky Chance ID raffle' },
]
const LOW_MAX = 15
export const FMT_DATE = 'yyyy-mm-dd'
export const FMT_INT = '#,##0'
export const FMT_PCT = '0.00%'
export const SOURCE_URL = 'https://www.theuaelottery.ae/lottery/luckyday/results'

/**
 * Python-compatible round(x, d). Both round the exact binary value correctly.
 * They differ only on exact ties: Python goes half-to-even, toFixed goes up.
 * Ties are detected from the exact decimal expansion, not from x * 10^d,
 * which can itself round (12.0635 is really 12.06349999...).
 */
export function pyRound(x: number, d: number): number {
  const exact = x.toFixed(d + 30) // exact decimal digits of the double
  const dot = exact.indexOf('.')
  const kept = exact.slice(0, dot + 1 + d) // truncated towards zero to d places
  const isTie = /^50*$/.test(exact.slice(dot + 1 + d))
  const lastKeptDigit = Number(kept.replace('.', '').slice(-1))
  if (isTie && lastKeptDigit % 2 === 0) return Number(kept)
  return Number(x.toFixed(d)) // correctly rounded; toFixed breaks ties away from zero
}

/**
 * Excel date serials carry no timezone, and exceljs converts a JS Date using
 * its UTC fields. So we build the Date from the UAE wall-clock parts via
 * Date.UTC. The cell then shows the UAE date on any machine, in any timezone.
 * Never use local-time Date constructors here.
 */
export function uaeExcelDate(draw: LuckyDayDraw, withTime = false): Date {
  const p = uaeParts(draw.timestamp)
  return new Date(Date.UTC(p.year, p.month - 1, p.day, withTime ? p.hour : 0, withTime ? p.minute : 0))
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)

export function drawFeatures(d: LuckyDayDraw, prev: LuckyDayDraw | null): Record<string, number | null> {
  const n = d.numbers
  const gaps = n.slice(1).map((x, i) => x - n[i])
  const p = uaeParts(d.timestamp)
  return {
    Sum: sum(n),
    Mean: pyRound(sum(n) / n.length, 2),
    Min: n[0],
    Max: n[n.length - 1],
    Range: n[n.length - 1] - n[0],
    'Odd Count': n.filter((x) => x % 2 === 1).length,
    'Even Count': n.filter((x) => x % 2 === 0).length,
    'Low Count 1 to 15': n.filter((x) => x <= LOW_MAX).length,
    'High Count 16 to 31': n.filter((x) => x > LOW_MAX).length,
    'Count 1 to 10': n.filter((x) => x >= 1 && x <= 10).length,
    'Count 11 to 20': n.filter((x) => x >= 11 && x <= 20).length,
    'Count 21 to 31': n.filter((x) => x >= 21 && x <= 31).length,
    'Consecutive Pairs': gaps.filter((g) => g === 1).length,
    'Max Gap': Math.max(...gaps),
    'Repeats From Previous Draw': prev ? n.filter((x) => prev.numbers.includes(x)).length : null,
    'Contains Draw Day': n.includes(p.day) ? 1 : 0,
    'Lucky Month Equals Draw Month': d.luckyMonth ? (d.luckyMonth === p.month ? 1 : 0) : null,
  }
}

/** Frequency / expectation / recency stats. `chrono` is oldest -> newest. */
export function numberStats(
  chrono: LuckyDayDraw[],
  valuesOf: (d: LuckyDayDraw) => number[],
  universe: number[],
  pHit: number,
): [number, Record<string, Cell>][] {
  const nDraws = chrono.length
  const weekdays = [...new Set(chrono.map((d) => uaeParts(d.timestamp).isoWeekday))].sort((a, b) => a - b)
  const versions = [...new Set(chrono.map((d) => d.rulesVersion).filter((v): v is string => !!v))].sort()
  return universe.map((v) => {
    const seqs: number[] = []
    chrono.forEach((d, i) => valuesOf(d).includes(v) && seqs.push(i + 1))
    const hits = seqs.length
    const expected = nDraws * pHit
    const sd = Math.sqrt(nDraws * pHit * (1 - pHit))
    const gaps = seqs.slice(1).map((s, i) => s - seqs[i])
    const row: Record<string, Cell> = {
      'Times Drawn': hits,
      'Pct Of Draws': nDraws ? hits / nDraws : null,
      Expected: pyRound(expected, 3),
      Deviation: pyRound(hits - expected, 3),
      'Z Score': sd ? pyRound((hits - expected) / sd, 3) : null,
    }
    for (const wd of weekdays) {
      row[`${WEEKDAYS[wd - 1]} Count`] = seqs.filter((s) => uaeParts(chrono[s - 1].timestamp).isoWeekday === wd).length
    }
    for (const ver of versions) {
      row[`Rules ${ver} Count`] = seqs.filter((s) => chrono[s - 1].rulesVersion === ver).length
    }
    row['Last Drawn Date'] = hits ? uaeExcelDate(chrono[seqs[hits - 1] - 1]) : null
    row['Draws Since Last Seen'] = hits ? nDraws - seqs[hits - 1] : null
    row['Longest Gap Draws'] = gaps.length ? Math.max(...gaps) : null
    row['Average Gap Draws'] = gaps.length ? pyRound(sum(gaps) / gaps.length, 3) : null
    return [v, row]
  })
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

export interface WorkbookInfo {
  generatedAt: string
  generator: string
  snapshotGeneratedAt?: string | null
}

export function buildWorkbookTables(draws: LuckyDayDraw[], info: WorkbookInfo): SheetTable[] {
  const chrono = [...draws].sort((a, b) => a.timestamp - b.timestamp || a.drawNo.localeCompare(b.drawNo))
  const seq = new Map(chrono.map((d, i) => [d.drawNo, i + 1]))
  const prev = new Map(chrono.map((d, i) => [d.drawNo, i ? chrono[i - 1] : null]))
  const newestFirst = [...chrono].reverse()
  const nDraws = chrono.length
  const tables: SheetTable[] = []
  const dictionary: Cell[][] = []
  const doc = (sheet: string, cols: [string, string, string][]) => cols.forEach((c) => dictionary.push([sheet, ...c]))
  const date = (d: LuckyDayDraw) => uaeExcelDate(d)

  // 1. Results
  const header: string[] = ['Draw No', 'Draw Seq', 'Draw Date', 'Draw Time UAE', 'Year', 'Month', 'Day',
    'Weekday', 'Weekday Num', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'Lucky Month']
  for (const t of TIERS) header.push(`${t.label} Winners`, `${t.label} Prize AED`)
  header.push('Total Winners', 'Total Paid AED', 'Lucky Chance IDs', 'Rules Version')
  const resultsFormats: Record<string, string> = { 'Draw Date': FMT_DATE, 'Total Winners': FMT_INT, 'Total Paid AED': FMT_INT }
  for (const t of TIERS) {
    resultsFormats[`${t.label} Prize AED`] = FMT_INT
    resultsFormats[`${t.label} Winners`] = FMT_INT
  }
  tables.push({
    name: 'Results',
    header,
    freeze: 'B2',
    formats: resultsFormats,
    rows: newestFirst.map((d) => {
      const p = uaeParts(d.timestamp)
      const paid = TIER_KEYS.map((k) => d.tiers[k].totalPaid).filter((x): x is number => x !== null)
      return [
        d.drawNo, seq.get(d.drawNo)!, date(d), d.drawDateTimeUae.slice(11), p.year, p.month, p.day,
        d.weekday, p.isoWeekday, ...d.numbers, d.luckyMonth,
        ...TIERS.flatMap((t) => [d.tiers[t.key].winners, d.tiers[t.key].prize]),
        d.totalWinners, paid.length ? sum(paid) : null, d.luckyChanceIds.join(', '), d.rulesVersion,
      ]
    }),
  })
  doc('Results', [
    ['Draw No', 'text', 'Official draw identifier (series number, YYMMDD). Stored as text.'],
    ['Draw Seq', 'integer', 'Chronological index, 1 = oldest draw in this file. Use for ordering / lags.'],
    ['Draw Date', 'date', 'Draw date in UAE time (UTC+4).'],
    ['Draw Time UAE', 'text', 'Draw time HH:MM in UAE time. Changed from 20:30 to 21:30 in rules 1.0.2.'],
    ['Year / Month / Day', 'integer', 'Parts of Draw Date.'],
    ['Weekday / Weekday Num', 'text / integer', 'Day of week of the draw; ISO number Monday=1 ... Sunday=7.'],
    ['N1-N6', 'integer 1-31', 'The six Day numbers SORTED ASCENDING (the API does not publish ball-draw order). ' +
      'N1 is the smallest, N6 the largest - treat as order statistics, not draw positions.'],
    ['Lucky Month', 'integer 1-12', 'The Month number drawn.'],
    ['<Tier> Winners', 'integer', 'Number of winning tickets in the tier.'],
    ['<Tier> Prize AED', 'integer', 'NOMINAL prize per winner for that draw (advertised amount - shown even when ' +
      'there are 0 winners). Not the amount actually paid.'],
    ['Total Winners', 'integer', 'Total winning tickets across all tiers incl. Lucky Chance.'],
    ['Total Paid AED', 'integer', 'Sum of the actual amounts paid across all tiers (API totalPrize).'],
    ['Lucky Chance IDs', 'text', 'Comma-separated winning Lucky Chance IDs. Count varies by rules version.'],
    ['Rules Version', 'text', 'Game configuration version. Schedule, draw time, jackpot and Lucky Chance ' +
      'count/prize differ between versions - segment by this when comparing periods.'],
    ...TIERS.map((t): [string, string, string] => [`${t.label} Winners/Prize AED`, 'tier', t.rule]),
  ])

  // 2. Draw Features
  const feats = newestFirst.map((d) => [d, drawFeatures(d, prev.get(d.drawNo) ?? null)] as const)
  const fcols = feats.length ? Object.keys(feats[0][1]) : []
  tables.push({
    name: 'Draw Features',
    header: ['Draw No', 'Draw Seq', 'Draw Date', 'Rules Version', ...fcols],
    freeze: 'B2',
    formats: { 'Draw Date': FMT_DATE },
    rows: feats.map(([d, f]) => [d.drawNo, seq.get(d.drawNo)!, date(d), d.rulesVersion, ...Object.values(f)]),
  })
  doc('Draw Features', [
    ['Sum / Mean / Min / Max / Range', 'number', 'Of the six Day numbers.'],
    ['Odd Count / Even Count', 'integer', 'How many of the six numbers are odd / even.'],
    ['Low Count 1 to 15 / High Count 16 to 31', 'integer', 'Numbers in the low / high half.'],
    ['Count 1 to 10 / 11 to 20 / 21 to 31', 'integer', 'Numbers per band.'],
    ['Consecutive Pairs', 'integer', 'Adjacent sorted numbers differing by exactly 1 (e.g. 21,22 = 1 pair).'],
    ['Max Gap', 'integer', 'Largest difference between adjacent sorted numbers.'],
    ['Repeats From Previous Draw', 'integer', 'Day numbers shared with the chronologically previous draw ' +
      '(blank for the first draw).'],
    ['Contains Draw Day', '0/1', "1 if the draw's own day-of-month is among the six numbers."],
    ['Lucky Month Equals Draw Month', '0/1', '1 if the Lucky Month equals the calendar month of the draw.'],
  ])

  // 3. Numbers Long
  const longRows: Cell[][] = []
  for (const d of newestFirst) {
    const p = uaeParts(d.timestamp)
    const base: Cell[] = [d.drawNo, seq.get(d.drawNo)!, date(d), p.year, p.month, d.weekday, d.rulesVersion]
    d.numbers.forEach((n, i) => longRows.push([...base, 'Day', i + 1, n]))
    if (d.luckyMonth !== null) longRows.push([...base, 'Month', null, d.luckyMonth])
  }
  tables.push({
    name: 'Numbers Long',
    header: ['Draw No', 'Draw Seq', 'Draw Date', 'Year', 'Month', 'Weekday', 'Rules Version', 'Ball Type',
      'Sorted Position', 'Number'],
    freeze: 'A2',
    formats: { 'Draw Date': FMT_DATE },
    rows: longRows,
  })
  doc('Numbers Long', [
    ['(sheet)', 'tidy', 'One row per drawn number - best for pivot tables, pandas, R.'],
    ['Ball Type', 'text', "'Day' (1-31, six per draw) or 'Month' (1-12, one per draw)."],
    ['Sorted Position', 'integer', '1-6 rank of a Day number within its draw (ascending). Blank for Month.'],
  ])

  // 4. Number Matrix
  tables.push({
    name: 'Number Matrix',
    header: ['Draw No', 'Draw Seq', 'Draw Date', ...range(1, DAY_MAX).map((i) => `D${i}`),
      ...range(1, MONTH_MAX).map((i) => `M${i}`)],
    freeze: 'D2',
    formats: { 'Draw Date': FMT_DATE },
    rows: newestFirst.map((d) => [d.drawNo, seq.get(d.drawNo)!, date(d),
      ...range(1, DAY_MAX).map((i) => (d.numbers.includes(i) ? 1 : 0)),
      ...range(1, MONTH_MAX).map((i) => (i === d.luckyMonth ? 1 : 0))]),
  })
  doc('Number Matrix', [
    ['D1-D31', '0/1', 'One-hot: 1 if that Day number was drawn. Each row sums to 6.'],
    ['M1-M12', '0/1', 'One-hot: 1 if that Lucky Month was drawn. Each row sums to 1.'],
  ])

  // 5 & 6. Day Number Stats / Month Stats
  const statSpecs: [string, number[], (d: LuckyDayDraw) => number[], number, string][] = [
    ['Day Number Stats', range(1, DAY_MAX), (d) => d.numbers, PICKS / DAY_MAX, 'Number'],
    ['Month Stats', range(1, MONTH_MAX), (d) => (d.luckyMonth ? [d.luckyMonth] : []), 1 / MONTH_MAX, 'Month'],
  ]
  for (const [name, universe, valuesOf, pHit, label] of statSpecs) {
    const stats = numberStats(chrono, valuesOf, universe, pHit)
    const cols = stats.length ? Object.keys(stats[0][1]) : []
    tables.push({
      name,
      header: [label, ...cols],
      freeze: 'A2',
      formats: { 'Pct Of Draws': FMT_PCT, 'Last Drawn Date': FMT_DATE },
      rows: stats.map(([v, s]) => [v, ...Object.values(s)]),
    })
  }
  doc('Day Number Stats', [
    ['Times Drawn', 'integer', 'Draws containing the number (whole dataset).'],
    ['Pct Of Draws', 'fraction', 'Times Drawn / total draws.'],
    ['Expected', 'number', 'Expected count if uniform: draws x 6/31 (Day) or draws x 1/12 (Month).'],
    ['Deviation', 'number', 'Times Drawn - Expected.'],
    ['Z Score', 'number', 'Deviation / sqrt(draws x p x (1-p)); |Z| > 2 is unusual for ONE number, but with ' +
      '31 numbers ~1-2 such values are expected by chance.'],
    ['<Weekday> Count', 'integer', 'Times drawn on that weekday.'],
    ['Rules <version> Count', 'integer', 'Times drawn under that rules version.'],
    ['Last Drawn Date', 'date', 'Most recent draw containing the number.'],
    ['Draws Since Last Seen', 'integer', 'Draws since it last appeared (0 = in the latest draw).'],
    ['Longest Gap Draws / Average Gap Draws', 'number', 'Gap in draws between consecutive appearances.'],
  ])
  doc('Month Stats', [['(sheet)', 'sheet', 'Same columns as Day Number Stats, for the Lucky Month (p = 1/12).']])

  // 7. Pair Frequency (diagonal = single-number count)
  const pair = range(0, DAY_MAX).map(() => new Array<number>(DAY_MAX + 1).fill(0))
  for (const d of chrono) for (const a of d.numbers) for (const b of d.numbers) pair[a][b]++
  tables.push({
    name: 'Pair Frequency',
    header: ['Number', ...range(1, DAY_MAX)],
    freeze: 'B2',
    width: 6,
    rows: range(1, DAY_MAX).map((a) => [a, ...pair[a].slice(1)]),
  })
  doc('Pair Frequency', [
    ['(matrix)', 'integer', 'Draws in which row number and column number both appeared. Symmetric; the ' +
      'diagonal is the single-number count. Expected count per pair if uniform = ' +
      `draws x (6x5)/(31x30) = draws/31 = ${(nDraws / 31).toFixed(2)}.`],
  ])

  // 8. Lucky Chance
  tables.push({
    name: 'Lucky Chance',
    header: ['Draw No', 'Draw Date', 'Rules Version', 'Lucky Chance ID', 'Prize AED'],
    freeze: 'A2',
    formats: { 'Draw Date': FMT_DATE, 'Prize AED': FMT_INT },
    rows: newestFirst.flatMap((d) =>
      d.luckyChanceIds.map((id) => [d.drawNo, date(d), d.rulesVersion, id, d.tiers.rafflePrize.prize])),
  })
  doc('Lucky Chance', [['(sheet)', 'sheet', 'One row per winning Lucky Chance ID; prize is per ID.']])

  // 9. Data Dictionary
  tables.push({ name: 'Data Dictionary', header: ['Sheet', 'Column', 'Type', 'Description'], freeze: 'A2', rows: dictionary })

  // 10. Metadata (hidden)
  const oldest = chrono[0]
  const latest = chrono[nDraws - 1]
  tables.push({
    name: 'Metadata',
    header: ['Key', 'Value'],
    freeze: 'A2',
    hidden: true,
    rows: [
      ['Dataset ID', 'uae-lottery-lucky-day'],
      ['Generated At UTC', info.generatedAt],
      ['Total Draws', nDraws],
      ['Oldest Draw', oldest ? `${oldest.drawNo} (${oldest.drawDateUae})` : ''],
      ['Latest Draw', latest ? `${latest.drawNo} (${latest.drawDateUae})` : ''],
      ['Source URL', SOURCE_URL],
      ['Generator', info.generator],
      ...(info.snapshotGeneratedAt ? [['Snapshot Generated At', info.snapshotGeneratedAt] as Cell[]] : []),
    ],
  })
  return tables
}
