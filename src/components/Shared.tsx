import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, FileX2, PhoneOff, RotateCw, X } from 'lucide-react'
import type { Filters, Session, SessionStatus } from '../types'
import { STATUS_LABEL, TYPE_LABEL, fmtDateTime, fmtDuration, fmtValue, sessionStatus } from '../lib/analytics'
import { isEligible } from '../lib/extraction'
import { DEFAULT_FILTERS } from '../lib/seed'
import { useStore } from '../lib/store'
import { Badge, Button, Callout, Confidence, Drawer, Empty, Field, Modal, ResultBadge, Segmented, SessionBadge } from './ui'

// ───────────── filters ─────────────
export function FilterBar() {
  const { state, setFilters } = useStore()
  const f = state.filters
  const dirty = f.range !== DEFAULT_FILTERS.range || f.agentId !== 'all' || f.status !== 'all'
  return (
    <div className="filters">
      <Segmented<Filters['range']>
        value={f.range}
        onChange={(range) => setFilters({ range })}
        options={[
          { value: '7d', label: '7 days' },
          { value: '30d', label: '30 days' },
          { value: '90d', label: '90 days' },
          { value: 'all', label: 'All' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {f.range === 'custom' && (
        <>
          <input type="date" className="input sm" aria-label="From date" value={f.from} max={f.to || undefined} onChange={(e) => setFilters({ from: e.target.value })} />
          <span className="faint">→</span>
          <input type="date" className="input sm" aria-label="To date" value={f.to} min={f.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} />
        </>
      )}
      <select className="select sm" aria-label="Agent" value={f.agentId} onChange={(e) => setFilters({ agentId: e.target.value })}>
        <option value="all">All agents</option>
        {state.agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select className="select sm" aria-label="Extraction status" value={f.status} onChange={(e) => setFilters({ status: e.target.value as Filters['status'] })}>
        <option value="all">Any extraction status</option>
        {(Object.keys(STATUS_LABEL) as SessionStatus[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {dirty && (
        <Button variant="ghost" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>
          <X size={12} /> Reset
        </Button>
      )}
    </div>
  )
}

// ───────────── session list ─────────────
export function SessionTable({ sessions, pageSize = 20 }: { sessions: Session[]; pageSize?: number }) {
  const { index, openSession } = useStore()
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(sessions.length / pageSize))
  const current = Math.min(page, pages - 1)
  const rows = sessions.slice(current * pageSize, current * pageSize + pageSize)
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Call</th>
              <th>Agent</th>
              <th>Ended</th>
              <th className="hide-sm">Length</th>
              <th>Extraction</th>
              <th className="hide-sm">Topics captured</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const res = index.resultsBySession.get(s.id) ?? []
              const captured = res.filter((r) => r.status === 'success' && r.value !== null).length
              return (
                <tr key={s.id} className="click" onClick={() => openSession(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openSession(s.id)}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{s.caller}</div>
                    <div className="mono faint" style={{ textTransform: 'none', letterSpacing: 0 }}>
                      {s.id}
                    </div>
                  </td>
                  <td>{index.agentById.get(s.agentId)?.name}</td>
                  <td className="num">{fmtDateTime(s.endedAt)}</td>
                  <td className="num hide-sm">{fmtDuration(s.durationSec)}</td>
                  <td>
                    <SessionBadge status={sessionStatus(res)} />
                  </td>
                  <td className="num hide-sm">{res.length ? `${captured} of ${res.length}` : <span className="faint">—</span>}</td>
                  <td className="right faint">
                    <ChevronRight size={15} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="card-foot" style={{ alignItems: 'center' }}>
          <span>
            {current * pageSize + 1}–{Math.min(sessions.length, (current + 1) * pageSize)} of {sessions.length}
          </span>
          <span className="row">
            <Button disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            <Button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </Button>
          </span>
        </div>
      )}
    </>
  )
}

// ───────────── drill-down: sessions behind a number ─────────────
export function DrillDrawer() {
  const { drill, setDrill, index, openSessionId } = useStore()
  const sessions = useMemo(() => (drill ? drill.sessionIds.map((id) => index.sessionById.get(id)).filter((s): s is Session => !!s).sort((a, b) => b.endedAt - a.endedAt) : []), [drill, index])
  if (!drill || openSessionId) return null
  return (
    <Drawer wide title={drill.title} subtitle={`${drill.subtitle ? `${drill.subtitle} · ` : ''}${sessions.length} call${sessions.length === 1 ? '' : 's'} behind this number`} onClose={() => setDrill(null)}>
      {sessions.length ? (
        <div className="card">
          <SessionTable sessions={sessions} pageSize={15} />
        </div>
      ) : (
        <Empty icon={<PhoneOff size={18} />} title="No calls here">
          Nothing matches this value with the current filters.
        </Empty>
      )}
    </Drawer>
  )
}

// ───────────── single session ─────────────
export function SessionDrawer() {
  const { openSessionId, openSession, index, retryResults, toast } = useStore()
  const [focus, setFocus] = useState<string | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const session = openSessionId ? index.sessionById.get(openSessionId) : undefined

  useEffect(() => setFocus(null), [openSessionId])
  useEffect(() => {
    if (!focus) return
    transcriptRef.current?.querySelector('.turn.hl')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focus])

  if (!session) return null
  const results = index.resultsBySession.get(session.id) ?? []
  const status = sessionStatus(results)
  const focused = results.find((r) => r.id === focus)
  const hl = new Set((focused ? focused.evidence : results.flatMap((r) => r.evidence)).map((e) => e.turnIndex))
  const notApplied = index.liveTopics.filter((t) => !isEligible(t, session) && !results.some((r) => r.topicId === t.id))
  const retryable = results.filter((r) => r.status === 'failed' || r.status === 'invalid')

  return (
    <Drawer
      wide
      title={`Call from ${session.caller}`}
      subtitle={
        <span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
          {session.id}
        </span>
      }
      headerExtra={<SessionBadge status={status} />}
      onClose={() => openSession(null)}
    >
      <div className="stack" style={{ gap: 22 }}>
        <div className="kv">
          {[
            ['Agent', index.agentById.get(session.agentId)?.name ?? '—'],
            ['Started', fmtDateTime(session.startedAt)],
            ['Ended', fmtDateTime(session.endedAt)],
            ['Length', fmtDuration(session.durationSec)],
            ['Channel', session.channel === 'phone' ? 'Phone' : 'Web chat'],
            ['Ended by', session.endReason === 'transferred' ? 'Transfer to a person' : session.endReason === 'caller_hangup' ? 'Caller hung up' : 'Agent ended call'],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="k">{k}</div>
              <div className="v">{v}</div>
            </div>
          ))}
        </div>

        <section>
          <div className="spread" style={{ marginBottom: 10 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>What the AI extracted</h3>
              <div className="small muted">Extraction ran once, after the call ended. Click a quote to find it in the transcript.</div>
            </div>
            {retryable.length > 1 && (
              <Button
                onClick={() => {
                  retryResults(retryable.map((r) => r.id))
                  toast(`Retrying ${retryable.length} topics…`, 'info')
                }}
              >
                <RotateCw size={12} /> Retry all
              </Button>
            )}
          </div>

          {results.length === 0 ? (
            <Callout>
              No topics were active when this call ended, so nothing was extracted. Topics are never applied to earlier calls.
            </Callout>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {results.map((r) => {
                const v = index.versionById.get(r.versionId)
                const topic = index.topicById.get(r.topicId)
                const latest = topic ? index.versionById.get(topic.currentVersionId) : undefined
                if (!v) return null
                const unknown = r.status === 'success' && r.value === null
                return (
                  <div key={r.id} className="result" style={focus === r.id ? { borderColor: 'var(--ink)' } : undefined}>
                    <div className="spread">
                      <div className="row wrap">
                        <span style={{ fontWeight: 550 }}>{v.name}</span>
                        <Badge tone="outline" title={`Extracted with version ${v.version} of this topic's configuration`}>
                          v{v.version}
                        </Badge>
                        {latest && latest.version !== v.version && !topic?.deletedAt && <span className="small faint">older configuration · current is v{latest.version}</span>}
                        {topic?.deletedAt && <Badge>Topic deleted</Badge>}
                      </div>
                      <div className="row">
                        <Confidence value={r.confidence} />
                        <ResultBadge status={r.status} unknown={unknown} />
                      </div>
                    </div>

                    {r.status === 'success' &&
                      (unknown ? (
                        <div className="row wrap">
                          <span className="chip unknown">Unknown</span>
                          <span className="small muted">The AI could not tell from this call. This is not counted as “No” or 0.</span>
                        </div>
                      ) : v.type === 'text' ? (
                        <div>{String(r.value)}</div>
                      ) : (
                        <div className="row wrap">
                          {(Array.isArray(r.value) ? (r.value.length ? r.value : ['None']) : [fmtValue(r.value, v)]).map((x) => (
                            <span key={x} className="chip">
                              {x}
                            </span>
                          ))}
                          <span className="small faint">{TYPE_LABEL[v.type]}</span>
                        </div>
                      ))}

                    {r.error && (
                      <div className="row wrap small" style={{ color: r.status === 'no_transcript' ? 'var(--ink-2)' : 'var(--bad)' }}>
                        <span className="grow">{r.error}</span>
                        {(r.status === 'failed' || r.status === 'invalid') && (
                          <Button
                            onClick={() => {
                              retryResults([r.id])
                              toast(`Retrying “${v.name}”…`, 'info')
                            }}
                          >
                            <RotateCw size={12} /> Retry
                          </Button>
                        )}
                      </div>
                    )}
                    {(r.status === 'queued' || r.status === 'processing') && <div className="skel" style={{ width: '40%' }} />}

                    {r.evidence.map((e) => (
                      <button key={e.turnIndex} className="quote" style={{ background: 'none', border: 0, borderLeft: '2px solid var(--line-strong)', textAlign: 'left', cursor: 'pointer' }} onClick={() => setFocus(r.id)} title="Show in transcript">
                        <b>{e.speaker}</b>“{e.quote}”
                      </button>
                    ))}
                    {r.attempts > 1 && <div className="small faint">{r.attempts} attempts</div>}
                  </div>
                )
              })}
            </div>
          )}
          {notApplied.length > 0 && results.length > 0 && (
            <div className="small faint" style={{ marginTop: 10 }}>
              Not applied to this call: {notApplied.map((t) => index.versionById.get(t.currentVersionId)?.name).join(', ')} — {notApplied.length === 1 ? 'it was' : 'they were'} not active when the call ended.
            </div>
          )}
        </section>

        <section>
          <div className="spread" style={{ marginBottom: 8 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>Transcript</h3>
            {focus && (
              <Button variant="ghost" onClick={() => setFocus(null)}>
                Show all evidence
              </Button>
            )}
          </div>
          {session.transcript ? (
            <div className="card" style={{ padding: 8 }} ref={transcriptRef}>
              {session.transcript.map((t, i) => (
                <div key={i} className={`turn ${hl.has(i) ? 'hl' : ''}`}>
                  <span className="who">{t.speaker}</span>
                  <span>
                    {t.text}
                    <span className="ts">
                      {Math.floor(t.t / 60)}:{String(t.t % 60).padStart(2, '0')}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="card">
              <Empty icon={<FileX2 size={18} />} title="No transcript available">
                This call was not transcribed, so the AI had nothing to read. Its topics are marked “No transcript” and left out of your analytics.
              </Empty>
            </div>
          )}
        </section>
      </div>
    </Drawer>
  )
}

// ───────────── simulate calls ─────────────
export function SimulateModal({ onClose }: { onClose: () => void }) {
  const { state, index, simulateSessions } = useStore()
  const [count, setCount] = useState(25)
  const [agentId, setAgentId] = useState('all')
  const [spread, setSpread] = useState(0)
  const active = index.liveTopics.filter((t) => t.enabled)
  return (
    <Modal
      title="Simulate finished calls"
      subtitle="Stands in for real traffic. Each call ends, then the AI extracts every active topic from its transcript."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              simulateSessions({ count, agentId, spreadDays: spread })
              onClose()
            }}
          >
            Run {count} calls
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <Field label="How many calls?">
          <Segmented value={String(count)} onChange={(v) => setCount(Number(v))} options={[10, 25, 50, 100].map((n) => ({ value: String(n), label: String(n) }))} />
        </Field>
        <Field label="Which agent takes them?">
          <select className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="all">Mix of all agents</option>
            {state.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="When do they happen?" hint={spread ? 'This fast-forwards the demo clock, so trends over time have something to show.' : 'All calls end right now.'}>
          <Segmented
            value={String(spread)}
            onChange={(v) => setSpread(Number(v))}
            options={[
              { value: '0', label: 'Right now' },
              { value: '3', label: 'Over 3 days' },
              { value: '7', label: 'Over 7 days' },
            ]}
          />
        </Field>
        {active.length ? (
          <Callout>
            <b>{active.length} active topic{active.length === 1 ? '' : 's'}</b> will be extracted from each call: {active.map((t) => index.versionById.get(t.currentVersionId)?.name).join(', ')}.
          </Callout>
        ) : (
          <Callout tone="warn">No topics are switched on, so these calls will be recorded but nothing will be extracted. Create a topic first to see analytics.</Callout>
        )}
      </div>
    </Modal>
  )
}
