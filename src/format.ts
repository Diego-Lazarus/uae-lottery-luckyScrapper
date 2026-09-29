const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09-26" -> "26 Sep 2026" (a UAE calendar date, so no timezone conversion). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** A real instant (e.g. last checked), shown in the viewer's local time. */
export function fmtInstant(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const fmtInt = (n: number) => n.toLocaleString('en-US')

export const plural = (n: number, word: string) => `${fmtInt(n)} ${word}${n === 1 ? '' : 's'}`
