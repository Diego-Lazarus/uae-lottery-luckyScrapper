export type Status =
  | { kind: 'idle' }
  | { kind: 'fetching'; text: string; progress?: number }
  | { kind: 'processing' }
  | { kind: 'saving' }
  | { kind: 'complete'; text: string }
  | { kind: 'error'; text: string }

const LABEL: Record<Status['kind'], string> = {
  idle: 'Idle',
  fetching: 'Fetching results',
  processing: 'Processing results',
  saving: 'Saving locally',
  complete: 'Complete',
  error: 'Error',
}

export function StatusBar({ status }: { status: Status }) {
  const busy = status.kind === 'fetching' || status.kind === 'processing' || status.kind === 'saving'
  const detail = 'text' in status ? status.text : null
  const progress = status.kind === 'fetching' ? status.progress : undefined
  return (
    <div className={`status status-${status.kind}`} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <strong>{LABEL[status.kind]}</strong>
      {detail && <span className="status-detail">{detail}</span>}
      {busy && (
        <div className="bar" aria-hidden="true">
          <div className={progress === undefined ? 'bar-fill indeterminate' : 'bar-fill'}
            style={progress === undefined ? undefined : { width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  )
}
