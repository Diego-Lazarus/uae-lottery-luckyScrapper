/**
 * Render SheetTables into an .xlsx workbook with exceljs. Values are static
 * (no formulas), so pandas, R and Power Query read every cell. Date cells hold
 * UAE wall-clock dates (see uaeExcelDate in features.ts).
 */
import type ExcelJSNS from 'exceljs'
import { buildWorkbookTables, type SheetTable, type WorkbookInfo } from './features.ts'
import type { LuckyDayDraw } from './types.ts'

export const XLSX_FILENAME = 'uae_lottery_luckyday_results.xlsx'
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type ExcelJS = typeof ExcelJSNS

/** exceljs is large, so it is loaded only when a workbook is actually built. */
async function loadExcelJS(): Promise<ExcelJS> {
  const mod = (await import('exceljs')) as unknown as { default?: ExcelJS } & ExcelJS
  return mod.default ?? mod
}

function colIndex(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!
  const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
  return { col, row: Number(m[2]) }
}

function renderTable(wb: ExcelJSNS.Workbook, t: SheetTable) {
  const { col, row } = colIndex(t.freeze)
  const ws = wb.addWorksheet(t.name, {
    views: [{ state: 'frozen', xSplit: col - 1, ySplit: row - 1 }],
    state: t.hidden ? 'hidden' : 'visible',
  })
  ws.addRow(t.header)
  for (const r of t.rows) ws.addRow(r)

  const headerRow = ws.getRow(1)
  headerRow.height = 32
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  for (const [name, fmt] of Object.entries(t.formats ?? {})) {
    const idx = t.header.indexOf(name)
    if (idx >= 0) ws.getColumn(idx + 1).eachCell((cell, rowNo) => { if (rowNo > 1) cell.numFmt = fmt })
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.header.length } }

  t.header.forEach((h, i) => {
    let width = t.width
    if (!width) {
      let longest = 0
      for (const r of t.rows.slice(0, 200)) {
        const v = r[i]
        const len = v instanceof Date ? 10 : String(v ?? '').length
        longest = Math.max(longest, len)
      }
      width = Math.max(8, Math.min(40, Math.max(longest + 2, Math.floor(String(h).length / 2) + 3)))
    }
    ws.getColumn(i + 1).width = width
  })
  if (t.name === 'Data Dictionary') {
    ws.getColumn(4).width = 110
    ws.getColumn(4).eachCell((cell, rowNo) => {
      if (rowNo > 1) cell.alignment = { wrapText: true, vertical: 'top' }
    })
  }
}

/** Build the analysis workbook from the full dataset and return its bytes. */
export async function buildWorkbookBuffer(draws: LuckyDayDraw[], info: WorkbookInfo): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'UAE Lottery Lucky Day Results'
  wb.created = new Date(info.generatedAt.replace(' ', 'T') + 'Z')
  for (const t of buildWorkbookTables(draws, info)) renderTable(wb, t)
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

/** Browser-only: build the workbook and trigger a download. */
export async function downloadWorkbook(draws: LuckyDayDraw[], info: WorkbookInfo): Promise<void> {
  const buf = await buildWorkbookBuffer(draws, info)
  const url = URL.createObjectURL(new Blob([buf], { type: XLSX_MIME }))
  const a = document.createElement('a')
  a.href = url
  a.download = XLSX_FILENAME
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function utcStamp(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
