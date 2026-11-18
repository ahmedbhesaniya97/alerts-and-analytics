import { useMemo, useState } from 'react'
import { ChartEditor, ChartsSection, type ChartEditorTarget } from '../components/ChartsSection'
import { FilterBar } from '../components/Shared'
import { TopicsSection, type TopicEditorTarget } from '../components/TopicsSection'
import { Callout } from '../components/ui'
import { PALETTE, filterSessions, pct, rangeLabel, sessionStatus } from '../lib/analytics'
import { useStore } from '../lib/store'

/** One page: overview numbers, the charts the user designed, and the topics they are built from. */
export default function Analytics() {
  const { state, index, clock, setDrill } = useStore()
  const [topicEditor, setTopicEditor] = useState<TopicEditorTarget>(null)
  const [chartEditor, setChartEditor] = useState<ChartEditorTarget>(null)
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
          <p>Decide what to learn from every call, then design the charts that show it. Click any number or chart value to see the calls behind it.</p>
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


      <ChartsSection sessions={sessions} onEdit={setChartEditor} onNewTopic={() => setTopicEditor('new')} />
      <TopicsSection editing={topicEditor} setEditing={setTopicEditor} onChart={(topicId) => setChartEditor({ id: null, topicId })} />

      {chartEditor && <ChartEditor key={chartEditor.id ?? `new-${chartEditor.topicId ?? ''}`} target={chartEditor} onClose={() => setChartEditor(null)} />}
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
