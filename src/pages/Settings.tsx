import { useMemo, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { Badge, Button, Callout, Confirm, Field } from '../components/ui'
import { fmtDateTime } from '../lib/analytics'
import { useStore } from '../lib/store'

export default function Settings() {
  const { state, queue, setWorkspace, updateSettings, retryResults, rerunRecent, resetDemo, clearAll, setDrill, toast } = useStore()
  const [name, setName] = useState(state.workspace)
  const [confirm, setConfirm] = useState<'reset' | 'clear' | null>(null)
  const s = state.settings

  const health = useMemo(() => {
    const count = { success: 0, unknown: 0, failed: 0, invalid: 0, no_transcript: 0, pending: 0 }
    const retryable: string[] = []
    const problemSessions = new Set<string>()
    for (const r of state.results) {
      if (r.status === 'success') count[r.value === null ? 'unknown' : 'success'] += 1
      else if (r.status === 'failed' || r.status === 'invalid') {
        count[r.status] += 1
        retryable.push(r.id)
        problemSessions.add(r.sessionId)
      } else if (r.status === 'no_transcript') count.no_transcript += 1
      else count.pending += 1
    }
    return { count, retryable, problemSessions: [...problemSessions] }
  }, [state.results])

  const pctInput = (label: string, hint: string, value: number, max: number, onChange: (v: number) => void) => (
    <Field label={`${label} · ${Math.round(value * 100)}%`} hint={hint}>
      <input type="range" min={0} max={max} step={1} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} style={{ accentColor: '#0b0b0b' }} />
    </Field>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Workspace details, how extraction behaves, and tools for the demo data.</p>
        </div>
      </div>

      <div className="grid two" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Workspace</h3>
                <div className="sub">Shown in the sidebar.</div>
              </div>
            </div>
            <div className="card-body stack">
              <Field label="Workspace name">
                <div className="row">
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                  <Button
                    variant="primary"
                    lg
                    disabled={!name.trim() || name.trim() === state.workspace}
                    onClick={() => {
                      setWorkspace(name.trim())
                      toast('Workspace name saved.')
                    }}
                  >
                    Save
                  </Button>
                </div>
              </Field>
              <div>
                <div className="field-label" style={{ marginBottom: 6 }}>
                  Voice agents
                </div>
                {state.agents.map((a) => (
                  <div key={a.id} className="spread" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{a.name}</div>
                      <div className="small muted">{a.description}</div>
                    </div>
                    <span className="small num muted">{state.sessions.filter((x) => x.agentId === a.id).length} calls</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h3>How extraction works</h3>
                <div className="sub">These rules are always on.</div>
              </div>
            </div>
            <div className="card-body stack small" style={{ gap: 8 }}>
              {[
                ['After the call', 'Extraction runs once, only after a call has ended.'],
                ['Never retroactive', 'A topic applies to calls that end after it is switched on. Older calls are not re-analysed.'],
                ['Versioned', 'Each edit creates a new version. Results keep the version they were extracted with.'],
                ['History is kept', 'Pausing or deleting a topic never removes results it already captured.'],
                ['Unknown ≠ No', 'If the call does not make the answer clear, the value is stored as unknown — not false or zero.'],
                ['No duplicates', 'One result per call and topic. A repeated job for the same pair is skipped.'],
              ].map(([k, v]) => (
                <div key={k} className="row" style={{ alignItems: 'flex-start' }}>
                  <Badge tone="outline">{k}</Badge>
                  <span className="muted grow">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h3>Demo data</h3>
                <div className="sub">Everything is stored in this browser only.</div>
              </div>
            </div>
            <div className="card-body row wrap">
              <Button onClick={() => setConfirm('reset')}>Reload sample data</Button>
              <Button danger onClick={() => setConfirm('clear')}>
                Start with an empty workspace
              </Button>
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Extraction health</h3>
                <div className="sub">All topic values across every call.</div>
              </div>
              {queue && <Badge tone="info">Running · {queue.done}/{queue.total}</Badge>}
            </div>
            <div className="card-body stack">
              <div className="kv">
                {[
                  ['Extracted', health.count.success],
                  ['Unknown', health.count.unknown],
                  ['Failed', health.count.failed],
                  ['Invalid value', health.count.invalid],
                  ['No transcript', health.count.no_transcript],
                  ['In queue', health.count.pending],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="k">{k}</div>
                    <div className="v num">{Number(v).toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div className="row wrap">
                <Button
                  disabled={!health.retryable.length || !!queue}
                  onClick={() => {
                    retryResults(health.retryable)
                    toast(`Retrying ${health.retryable.length} failed or invalid values…`, 'info')
                  }}
                >
                  <RotateCw size={12} /> Retry {health.retryable.length} failed
                </Button>
                <Button disabled={!health.problemSessions.length} onClick={() => setDrill({ title: 'Calls with failed extraction', sessionIds: health.problemSessions })}>
                  View affected calls
                </Button>
                <Button disabled={!!queue} onClick={rerunRecent} title="Submits every call from the last 24 hours again. Existing results are detected and skipped.">
                  Re-run last 24 hours
                </Button>
              </div>
              <div className="small muted">“Re-run” submits recent calls again to show duplicate protection: pairs that already have a result are skipped, never extracted twice.</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h3>Simulation</h3>
                <div className="sub">Controls how the simulated AI behaves for new calls.</div>
              </div>
            </div>
            <div className="card-body stack">
              {pctInput('Extraction failure rate', 'How often a single attempt fails (timeouts, rate limits) or returns an invalid value.', s.failureRate, 40, (v) => updateSettings({ failureRate: v }))}
              {pctInput('Calls without a transcript', 'These calls cannot be analysed and are marked “No transcript”.', s.missingTranscriptRate, 30, (v) => updateSettings({ missingTranscriptRate: v }))}
              <Field label="Automatic retries" hint="How many times a failed attempt is retried before the value is marked as failed.">
                <select className="select" value={s.autoRetries} onChange={(e) => updateSettings({ autoRetries: Number(e.target.value) })}>
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'No retries' : `${n} retr${n === 1 ? 'y' : 'ies'}`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h3>Extraction log</h3>
                <div className="sub">Most recent runs.</div>
              </div>
            </div>
            {state.runs.length === 0 ? (
              <div className="card-body">
                <Callout>No extraction has run yet. Simulate some calls to see entries here.</Callout>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th className="right">Calls</th>
                      <th className="right">Jobs</th>
                      <th className="right">Duplicates skipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.runs.slice(0, 8).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div>{r.label}</div>
                          <div className="small faint">{fmtDateTime(r.at)}</div>
                        </td>
                        <td className="right num">{r.sessions}</td>
                        <td className="right num">{r.jobsCreated}</td>
                        <td className="right num">{r.duplicatesSkipped}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirm === 'reset' && (
        <Confirm title="Reload sample data?" confirmLabel="Reload sample data" onClose={() => setConfirm(null)} onConfirm={() => { resetDemo(); toast('Sample data reloaded.') }} body={<p>This replaces everything in the workspace — topics, calls, results and charts — with the original sample data.</p>} />
      )}
      {confirm === 'clear' && (
        <Confirm danger title="Start with an empty workspace?" confirmLabel="Clear everything" onClose={() => setConfirm(null)} onConfirm={() => { clearAll(); toast('Workspace cleared. Start by creating a topic.', 'info') }} body={<p>All topics, calls, results and charts are removed so you can walk through setup from scratch. You can reload the sample data at any time.</p>} />
      )}
    </>
  )
}
