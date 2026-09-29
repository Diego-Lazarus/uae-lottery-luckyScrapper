import { fmtDate } from '../format.ts'
import type { LuckyDayDraw } from '../lib/types.ts'

/** The newest loaded draw, shown as number balls: six gold Day balls and a red Lucky Month ball. */
export function LatestDraw({ draw }: { draw: LuckyDayDraw | null }) {
  if (!draw) {
    return (
      <section className="card latest empty" aria-label="Latest draw">
        <div className="balls" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <span key={i} className="ball ghost" />)}
          <span className="ball ghost month" />
        </div>
        <p className="muted small">Press <b>Get Results</b> to load draws. The newest one appears here.</p>
      </section>
    )
  }
  const [date, time] = draw.drawDateTimeUae.split(' ')
  return (
    <section className="card latest" aria-label="Latest draw">
      <div className="latest-head">
        <div>
          <div className="draw-no">Draw No.: {draw.drawNo}</div>
          <div className="muted small">{draw.weekday} {time}, {fmtDate(date)}</div>
        </div>
        <span className="tag">Latest loaded</span>
      </div>
      <div className="balls" aria-label={`Numbers ${draw.numbers.join(', ')}, Lucky Month ${draw.luckyMonth ?? 'none'}`}>
        {draw.numbers.map((n) => <span key={n} className="ball">{n}</span>)}
        {draw.luckyMonth !== null && <span className="ball month" title="Lucky Month">{draw.luckyMonth}</span>}
      </div>
    </section>
  )
}
