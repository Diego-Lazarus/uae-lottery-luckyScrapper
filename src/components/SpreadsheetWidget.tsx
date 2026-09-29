import { plural } from '../format.ts'
import type { DatasetMeta } from '../lib/types.ts'

interface Props {
  meta: DatasetMeta | null
  /** Draws added/changed since the last export; null if never exported. */
  changedSinceExport: number | null
  exporting: boolean
  error: string | null
  onDownload: () => void
}

export function SpreadsheetWidget({ meta, changedSinceExport, exporting, error, onDownload }: Props) {
  const total = meta?.totalDraws ?? 0
  return (
    <aside className="widget" aria-label="Lucky Day Spreadsheet">
      <div className="widget-text">
        <strong>Lucky Day Spreadsheet</strong>
        <span className="muted small">{plural(total, 'locally stored draw')}</span>
        {!!changedSinceExport && (
          <span className="small accent">{plural(changedSinceExport, 'new or changed draw')} since last export</span>
        )}
        {error && <span className="small error-text">{error}</span>}
      </div>
      <button type="button" className="primary" onClick={onDownload} disabled={!total || exporting}>
        {exporting ? 'Building…' : 'Download XLSX'}
      </button>
    </aside>
  )
}
