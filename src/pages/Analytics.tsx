import { useMemo } from 'react'
import { FilterBar } from '../components/Shared'
import { Callout } from '../components/ui'
import { PALETTE, filterSessions, pct, rangeLabel, sessionStatus } from '../lib/analytics'
import { useStore } from '../lib/store'

/** Overview numbers for the calls in the current filter. */
export default function Analytics() {
  const { state, index, clock, setDrill } = useStore()
  const sessions = useMemo(() => filterSessions(state, index, clock), [state, index, clock])

  const overview = useMemo(() => {
    const analysed: string[] = []
    const attention: string[] = []
    const noTranscript: string[] = []
    let ok = 0
    let finished = 0
    let confSum = 0
    let confN = 0
    for (const s of sessions) {
      const res = index.resultsBySession.get(s.id) ?? []
      const st = sessionStatus(res)
      if (st === 'attention') attention.push(s.id)
      if (st === 'no_transcript') noTranscript.push(s.id)
      if (res.some((r) => r.status === 'success')) analysed.push(s.id)
      for (const r of res) {
        if (r.status === 'success') ok += 1
        if (r.status === 'success' || r.status === 'failed' || r.status === 'invalid') finished += 1
        if (r.confidence !== null) {
          confSum += r.confidence
          confN += 1
        }
      }
    }
    return { analysed, attention, noTranscript, ok, finished, conf: confN ? confSum / confN : null }
  }, [sessions, index])

  const range = rangeLabel(state.filters)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p>How your calls are going. Click any number to see the calls behind it.</p>
        </div>
      </div>

      <FilterBar />

      {state.sessions.length === 0 ? (
        <Callout>No calls yet. Analytics fill in as calls finish.</Callout>
      ) : (
        <div className="grid metrics">
          <Metric label="Calls" value={sessions.length.toLocaleString()} foot={range} onClick={() => setDrill({ title: 'All calls', subtitle: range, sessionIds: sessions.map((s) => s.id) })} />
          <Metric
            label="Calls analysed"
            value={`${pct(overview.analysed.length, sessions.length)}%`}
            foot={`${overview.analysed.length} of ${sessions.length} calls`}
            bar={pct(overview.analysed.length, sessions.length)}
            color={PALETTE[5]}
            onClick={() => setDrill({ title: 'Calls analysed', subtitle: 'At least one topic extracted', sessionIds: overview.analysed })}
          />
          <Metric
            label="Extraction success"
            value={overview.finished ? `${pct(overview.ok, overview.finished)}%` : '—'}
            foot={`${overview.ok.toLocaleString()} of ${overview.finished.toLocaleString()} topic values`}
            bar={overview.finished ? pct(overview.ok, overview.finished) : 0}
            color="#1d3a8a"
            onClick={() => setDrill({ title: 'Calls analysed', sessionIds: overview.analysed })}
          />
          <Metric label="Avg confidence" value={overview.conf === null ? '—' : `${Math.round(overview.conf * 100)}%`} foot="Across extracted values" onClick={() => setDrill({ title: 'Calls analysed', sessionIds: overview.analysed })} />
          <Metric
            label="Needs attention"
            value={overview.attention.length.toLocaleString()}
            foot={`Failed or invalid · ${overview.noTranscript.length} without transcript`}
            onClick={() => setDrill({ title: 'Needs attention', subtitle: 'A topic failed or returned an invalid value', sessionIds: overview.attention })}
          />
        </div>
      )}

    </>
  )
}

function Metric({ label, value, foot, bar, color, onClick }: { label: string; value: string; foot: string; bar?: number; color?: string; onClick: () => void }) {
  return (
    <button className="card metric" onClick={onClick} title="See the calls behind this number">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {bar !== undefined && (
        <span className="tickbar" style={{ ['--fill' as string]: color }}>
          <i style={{ width: `${bar}%` }} />
        </span>
      )}
      <span className="foot">{foot}</span>
    </button>
  )
}
