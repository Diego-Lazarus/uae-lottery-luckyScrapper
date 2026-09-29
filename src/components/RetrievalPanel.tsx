import type { RetrievalMode } from '../lib/types.ts'

const MODES: { id: RetrievalMode; label: string; help: string }[] = [
  { id: 'latest', label: 'Latest 10', help: 'Imports the 10 newest published draws.' },
  { id: 'from', label: 'From Date', help: 'Imports every draw from the chosen date onward.' },
  { id: 'range', label: 'Date Range', help: 'Imports draws between the two dates (inclusive, UAE dates).' },
  { id: 'all', label: 'All Results', help: 'Imports the complete Lucky Day history. No dates needed.' },
]

interface Props {
  mode: RetrievalMode
  from: string
  to: string
  minDate?: string | null
  maxDate?: string | null
  busy: boolean
  onMode: (m: RetrievalMode) => void
  onFrom: (v: string) => void
  onTo: (v: string) => void
  onSubmit: () => void
}

export function RetrievalPanel({ mode, from, to, minDate, maxDate, busy, onMode, onFrom, onTo, onSubmit }: Props) {
  const active = MODES.find((m) => m.id === mode)!
  const needsFrom = mode === 'from' || mode === 'range'
  const needsTo = mode === 'range'
  const incomplete = (needsFrom && !from) || (needsTo && !to)

  return (
    <form
      className="card retrieval"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <fieldset className="segmented" disabled={busy}>
        <legend className="label">Draws to retrieve</legend>
        {MODES.map((m) => (
          <label key={m.id} className={m.id === mode ? 'seg active' : 'seg'}>
            <input type="radio" name="mode" value={m.id} checked={m.id === mode} onChange={() => onMode(m.id)} />
            {m.label}
          </label>
        ))}
      </fieldset>
      <p className="help">{active.help}</p>

      {needsFrom && (
        <div className="dates">
          <label>
            <span className="label">From</span>
            <input type="date" value={from} min={minDate ?? undefined} max={maxDate ?? undefined} required
              disabled={busy} onChange={(e) => onFrom(e.target.value)} />
          </label>
          {needsTo && (
            <label>
              <span className="label">To</span>
              <input type="date" value={to} min={from || minDate || undefined} max={maxDate ?? undefined} required
                disabled={busy} onChange={(e) => onTo(e.target.value)} />
            </label>
          )}
        </div>
      )}

      <button type="submit" className="primary" disabled={busy || incomplete}>
        {busy ? 'Working…' : 'Get Results'}
      </button>
    </form>
  )
}
