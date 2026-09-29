import { fmtDate, fmtInt, plural } from '../format.ts'
import type { DatasetMeta, UpsertSummary } from '../lib/types.ts'

export function SummaryCard({ summary, meta }: { summary: UpsertSummary; meta: DatasetMeta | null }) {
  const items = [
    { n: summary.added, label: plural(summary.added, 'new draw'), tone: summary.added ? 'good' : '' },
    { n: summary.updated, label: plural(summary.updated, 'updated draw'), tone: summary.updated ? 'warn' : '' },
    { n: summary.unchanged, label: plural(summary.unchanged, 'unchanged draw'), tone: '' },
  ]
  return (
    <section className="card summary" aria-label="Retrieval summary">
      <ul className="chips">
        {items.map((i) => (
          <li key={i.label} className={`chip ${i.tone}`}>{i.label}</li>
        ))}
        <li className="chip total">{fmtInt(summary.total)} total stored draws</li>
      </ul>
      {meta?.oldestDraw && meta.newestDraw && (
        <p className="muted small">
          Stored locally in this browser: {fmtDate(meta.oldestDraw.date)} → {fmtDate(meta.newestDraw.date)}
        </p>
      )}
    </section>
  )
}
