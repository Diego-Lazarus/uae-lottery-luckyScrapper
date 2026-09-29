import { useCallback, useEffect, useMemo, useState } from 'react'
import { DatasetStats } from './components/DatasetStats.tsx'
import { RetrievalPanel } from './components/RetrievalPanel.tsx'
import { SpreadsheetWidget } from './components/SpreadsheetWidget.tsx'
import { StatusBar, type Status } from './components/StatusBar.tsx'
import { SummaryCard } from './components/SummaryCard.tsx'
import { fmtInt, plural } from './format.ts'
import { clearAll, countChangedSince, getAllDraws, getMeta, markExported, upsertDraws } from './lib/db.ts'
import { validateDraws } from './lib/snapshot.ts'
import { LiveApiSource, SnapshotSource, type DrawSource } from './lib/sources.ts'
import type { DatasetMeta, DateRange, RetrievalMode, UpsertSummary } from './lib/types.ts'
import { downloadWorkbook, utcStamp } from './lib/xlsx.ts'

const PAGE_ESTIMATE = 10 // pages of 10 for the full history, used for live progress only

export default function App() {
  const snapshotSource = useMemo(() => new SnapshotSource(`${import.meta.env.BASE_URL}data/luckyday.json`), [])
  const liveSource = useMemo(() => (import.meta.env.DEV ? new LiveApiSource() : null), [])
  const [useLive, setUseLive] = useState(false)
  const source: DrawSource = useLive && liveSource ? liveSource : snapshotSource

  const [meta, setMeta] = useState<DatasetMeta | null>(null)
  const [changedSinceExport, setChangedSinceExport] = useState<number | null>(null)
  const [mode, setMode] = useState<RetrievalMode>('latest')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [summary, setSummary] = useState<UpsertSummary | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const busy = status.kind === 'fetching' || status.kind === 'processing' || status.kind === 'saving'

  const refresh = useCallback(async () => {
    const [m, draws] = await Promise.all([getMeta(), getAllDraws()])
    setMeta(m)
    setChangedSinceExport(countChangedSince(draws, m?.lastExportAt ?? null))
  }, [])

  /**
   * Results only live while the page is open: stored data is cleared when the
   * page opens (covering reloads, and closes whose cleanup didn't finish) and,
   * best-effort, when it is closed.
   */
  useEffect(() => {
    clearAll()
      .then(refresh)
      .catch((e) => setStatus({ kind: 'error', text: `Could not open local storage: ${(e as Error).message}` }))
    const onHide = (e: PageTransitionEvent) => {
      if (!e.persisted) void clearAll()
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [refresh])

  async function getResults() {
    const range: DateRange = mode === 'from' ? { from } : mode === 'range' ? { from, to } : {}
    setSummary(null)
    try {
      setStatus({ kind: 'fetching', text: source.kind === 'live' ? 'Contacting the official API…' : 'Loading the published results…' })
      const res = await source.getDraws(mode, range, (s) => {
        if (s.step === 'page') {
          setStatus({
            kind: 'fetching',
            text: `Fetching historical page ${s.info.page} · ${plural(s.info.total, 'draw')} so far`,
            progress: Math.min(0.95, s.info.page / PAGE_ESTIMATE),
          })
        }
      })
      setStatus({ kind: 'processing' })
      const errors = validateDraws(res.draws)
      if (errors.length) throw new Error(`Received invalid data: ${errors.slice(0, 3).join('; ')}`)
      setStatus({ kind: 'saving' })
      const { summary: s } = await upsertDraws(res.draws, {
        mode,
        range: mode === 'from' || mode === 'range' ? range : null,
        historyStart: res.historyStart,
        historyEnd: res.historyEnd,
        snapshotGeneratedAt: res.snapshotGeneratedAt,
      })
      await refresh()
      setSummary(s)
      setStatus({
        kind: 'complete',
        text: res.draws.length
          ? `${plural(res.draws.length, 'draw')} retrieved and stored in this browser.`
          : 'No draws matched the selected dates.',
      })
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  async function download() {
    setExporting(true)
    setExportError(null)
    try {
      const draws = await getAllDraws() // always the full local dataset
      await downloadWorkbook(draws, {
        generatedAt: utcStamp(),
        generator: 'UAE Lottery Lucky Day web utility',
        snapshotGeneratedAt: meta?.snapshotGeneratedAt ?? null,
      })
      await markExported()
      await refresh()
    } catch (e) {
      setExportError(`Export failed: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  async function clearLocal() {
    if (!window.confirm('Remove the Lucky Day results currently loaded in this page? You can retrieve them again at any time.')) return
    await clearAll()
    setSummary(null)
    setStatus({ kind: 'idle' })
    await refresh()
  }

  return (
    <>
      <main className="shell">
        <header className="page-head">
          <h1>UAE Lottery Lucky Day Results</h1>
          <p className="muted">
            Retrieve official draw results and download them as an analysis-ready spreadsheet.
            Results are kept in this browser only while the page is open, and cleared automatically when you
            close or reload it.
          </p>
        </header>

        <RetrievalPanel
          mode={mode} from={from} to={to} busy={busy}
          minDate={meta?.apiHistoryStart} maxDate={meta?.apiHistoryEnd}
          onMode={setMode} onFrom={setFrom} onTo={setTo} onSubmit={getResults}
        />

        <StatusBar status={status} />
        {summary && <SummaryCard summary={summary} meta={meta} />}
        <DatasetStats meta={meta} onClear={clearLocal} busy={busy} />

        <details className="card about">
          <summary>What's in the spreadsheet?</summary>
          <p className="small">
            Every download is rebuilt from all {meta ? fmtInt(meta.totalDraws) : ''} draws stored in this browser.
            It contains 9 visible sheets, each a single table with no formulas, ready for Excel, pandas or R:
          </p>
          <ul className="small">
            <li><b>Results</b>: one row per draw, with date parts, sorted numbers N1–N6, Lucky Month, winners and prizes per tier, and rules version.</li>
            <li><b>Draw Features</b>: sum, range, odd/even, low/high, consecutive pairs, gaps, repeats from the previous draw.</li>
            <li><b>Numbers Long</b>: one row per drawn number (tidy format for pivots).</li>
            <li><b>Number Matrix</b>: 0/1 one-hot encoding for clustering and co-occurrence.</li>
            <li><b>Day Number Stats</b> / <b>Month Stats</b>: frequency, expected count, z-score, gaps and recency.</li>
            <li><b>Pair Frequency</b>: 31×31 co-occurrence counts.</li>
            <li><b>Lucky Chance</b>: one row per winning ID.</li>
            <li><b>Data Dictionary</b>: what every column means, plus caveats.</li>
          </ul>
          <p className="small muted">
            Numbers are published sorted (not in draw order). The game's schedule, draw time and prizes changed
            between rules versions, so use the <i>Rules Version</i> column when comparing periods.
          </p>
        </details>

        <footer className="foot small muted">
          <span>
            Source: {source.kind === 'live' ? 'official API via dev proxy' : 'published snapshot of the official results'}
            {' · '}
            <a href="https://www.theuaelottery.ae/lottery/luckyday/results" target="_blank" rel="noreferrer">theuaelottery.ae</a>
          </span>
          {liveSource && (
            <label className="dev-toggle">
              <input type="checkbox" checked={useLive} disabled={busy} onChange={(e) => setUseLive(e.target.checked)} />
              Dev: use live API
            </label>
          )}
        </footer>
      </main>

      <SpreadsheetWidget meta={meta} changedSinceExport={changedSinceExport} exporting={exporting} error={exportError} onDownload={download} />
    </>
  )
}
