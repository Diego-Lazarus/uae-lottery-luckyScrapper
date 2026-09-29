import { fmtDate, fmtInstant, fmtInt } from '../format.ts'
import type { DatasetMeta } from '../lib/types.ts'

export function DatasetStats({ meta, onClear, busy }: { meta: DatasetMeta | null; onClear: () => void; busy: boolean }) {
  const has = !!meta && meta.totalDraws > 0
  return (
    <section className="card stats" aria-label="Local dataset">
      <div className="card-head">
        <h2>Local dataset</h2>
        {has && (
          <button type="button" className="link danger" onClick={onClear} disabled={busy}>
            Clear local data
          </button>
        )}
      </div>
      {!has ? (
        <p className="muted">No results stored in this browser yet. Choose a range and press <b>Get Results</b>.</p>
      ) : (
        <dl className="grid">
          <div><dt>Stored draws</dt><dd className="big">{fmtInt(meta.totalDraws)}</dd></div>
          <div><dt>Oldest stored</dt><dd>{fmtDate(meta.oldestDraw?.date)}<span className="sub">#{meta.oldestDraw?.drawNo}</span></dd></div>
          <div><dt>Newest stored</dt><dd>{fmtDate(meta.newestDraw?.date)}<span className="sub">#{meta.newestDraw?.drawNo}</span></dd></div>
          <div><dt>Last checked</dt><dd>{fmtInstant(meta.lastApiCheckAt)}</dd></div>
          <div><dt>Last changed</dt><dd>{fmtInstant(meta.lastDataChangeAt)}</dd></div>
          <div><dt>Published snapshot</dt><dd>{fmtInstant(meta.snapshotGeneratedAt)}</dd></div>
        </dl>
      )}
    </section>
  )
}
