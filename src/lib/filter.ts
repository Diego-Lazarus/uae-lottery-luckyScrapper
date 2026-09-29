import { sortNewestFirst } from './normalize.ts'
import type { DateRange, LuckyDayDraw, RetrievalMode } from './types.ts'

export const LATEST_COUNT = 10

/** Select the draws a retrieval mode asks for. Dates are UAE `YYYY-MM-DD`. */
export function applyMode(draws: LuckyDayDraw[], mode: RetrievalMode, range: DateRange = {}): LuckyDayDraw[] {
  const sorted = sortNewestFirst(draws)
  switch (mode) {
    case 'latest':
      return sorted.slice(0, LATEST_COUNT)
    case 'from':
      if (!range.from) throw new Error('Choose a start date')
      return sorted.filter((d) => d.drawDateUae >= range.from!)
    case 'range':
      if (!range.from || !range.to) throw new Error('Choose both a From and a To date')
      if (range.from > range.to) throw new Error('The From date must be on or before the To date')
      return sorted.filter((d) => d.drawDateUae >= range.from! && d.drawDateUae <= range.to!)
    case 'all':
      return sorted
  }
}
