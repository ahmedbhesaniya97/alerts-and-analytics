import { useDeferredValue, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BarChart3, Check, Gauge, MessageCircle, Plus, Smile, Trash2, WandSparkles, X } from 'lucide-react'
import { AlertChart } from '../components/AlertChart'
import { ChannelIcon, CustomCallList, SeverityBadge, chartLines } from '../components/AlertParts'
import { OutputFields, TriggerConditions } from '../components/CustomBuilder'
import { Button, Callout, Confirm, Empty, Field, Segmented } from '../components/ui'
import {
  ALERT_TYPES,
  CATEGORIES,
  CHANNEL_LABEL,
  DAY,
  GROUP_LABEL,
  OP_LABEL,
  OP_SYMBOL,
  SEVERITIES,
  SEV_LABEL,
  SEV_RANK,
  applyMetric,
  applyType,
  customCalls,
  blankAlert,
  coreOf,
  defaultRow,
  evaluate,
  fmtSpan,
  fmtVal,
  fmtWhen,
  fmtWindow,
  metricOf,
  rid,
  rowSentence,
  unitLabel,
  validateAlert,
  type AlertConfig,
  type AlertCore,
  type CategoryId,
  type Channel,
  type Op,
  type Severity,
  type ThresholdRow,
} from '../lib/alerts'
import { useAlerts } from '../lib/alertsStore'
import { AGENTS } from '../lib/mock'
import { useStore } from '../lib/store'

const CAT_ICON: Record<CategoryId, typeof Gauge> = { performance: Gauge, quality: MessageCircle, experience: Smile, custom: WandSparkles }

export default function AlertEditor({ embedded = false }: { embedded?: boolean }) {
  const { id } = useParams()
  const { alerts } = useAlerts()
  if (id) {
    const existing = alerts.find((a) => a.id === id)
    if (!existing) {
      return (
        <div className="card" style={{ marginTop: 24 }}>
          <Empty icon={<X size={18} />} title="Alert not found" actions={<Link className="btn" to="/alerts">Back to alerts</Link>}>
            It may have been deleted.
          </Empty>
        </div>
      )
    }
    return <Editor key={existing.id} initial={existing} />
  }
  return <Editor initial={null} embedded={embedded} />
}

function Editor({ initial, embedded = false }: { initial: AlertConfig | null; embedded?: boolean }) {
  const nav = useNavigate()
  const { alerts, saveAlert, deleteAlert } = useAlerts()
  const { toast } = useStore()
  const [draft, setDraft] = useState<AlertConfig>(() => (initial ? structuredClone(initial) : blankAlert(Date.now())))
  const [category, setCategory] = useState<CategoryId>(() => (initial ? (metricOf(initial)?.type.category ?? 'performance') : 'performance'))
  const [several, setSeveral] = useState(() => (initial?.agentIds.length ?? 0) > 1)
  const [tried, setTried] = useState(false)
  const [removing, setRemoving] = useState(false)
  const set = (p: Partial<AlertConfig>) => setDraft((d) => ({ ...d, ...p }))

  const m = metricOf(draft)
  const isCustom = m?.type.id === 'custom_prompt'
  const errors = useMemo(() => {
    const e = validateAlert(draft, alerts)
    if (several && draft.agentIds.length === 0) e.agents = 'Choose at least one agent.'
    return e
  }, [draft, alerts, several])
  const shown = tried ? errors : {}
  const canSubmit = draft.name.trim() !== '' && !!m
  const dirty = !initial || JSON.stringify({ ...draft, segments: [] }) !== JSON.stringify({ ...initial, segments: [] })

  const submit = () => {
    setTried(true)
    if (Object.keys(errors).length) {
      setTimeout(() => document.querySelector('.ae-form .err, .ae-form .invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
      return
    }
    saveAlert({ ...draft, name: draft.name.trim() })
    toast(initial ? `“${draft.name.trim()}” saved. Changes apply from now.` : `“${draft.name.trim()}” created.${draft.enabled ? ' It checks every minute from now.' : ''}`)
    nav(initial ? '/alerts?tab=alerts' : '/alerts')
  }

  const agentValue = several ? 'several' : draft.agentIds.length === 1 ? draft.agentIds[0] : 'all'
  const usedSev = new Set(draft.rows.map((r) => r.severity))

  return (
    <div className="ae">
      {embedded ? (
        <div className="page-head" style={{ marginBottom: 6 }}>
          <div>
            <h1>Alerts</h1>
            <p>You haven’t set up any alerts yet. Create your first one; its analytics appear here once it’s saved.</p>
          </div>
        </div>
      ) : (
        <Link to="/alerts?tab=alerts" className="ae-back">
          <ArrowLeft size={14} /> Back to alerts
        </Link>
      )}
      <h1 className="ae-title">{initial ? 'Edit alert' : embedded ? 'Create your first alert' : 'Create alert'}</h1>

      <div className="ae-grid">
        <div className="ae-form stack" style={{ gap: 26 }}>
          <Field label="Agent" error={shown.agents}>
            <select
              className="select"
              value={agentValue}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'all') {
                  setSeveral(false)
                  set({ agentIds: [] })
                } else if (v === 'several') {
                  setSeveral(true)
                } else {
                  setSeveral(false)
                  set({ agentIds: [v] })
                }
              }}
            >
              <option value="all">All agents</option>
              {AGENTS.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
              <option value="several">Selected agents…</option>
            </select>
            {several && (
              <div className="row wrap" style={{ marginTop: 4 }}>
                {AGENTS.map((a) => (
                  <Chip key={a.id} on={draft.agentIds.includes(a.id)} onClick={() => set({ agentIds: draft.agentIds.includes(a.id) ? draft.agentIds.filter((x) => x !== a.id) : [...draft.agentIds, a.id] })}>
                    {a.name}
                  </Chip>
                ))}
              </div>
            )}
          </Field>

          <Field label="Alert name *" error={shown.name}>
            <input className={`input ${shown.name ? 'invalid' : ''}`} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Alert name" maxLength={100} />
          </Field>

          <section>
            <h2 className="ae-h">Conditions</h2>
            <div className={`ae-picker ${shown.type ? 'invalid' : ''}`}>
              <div className="ae-cats" role="tablist">
                {CATEGORIES.map((c) => {
                  const Icon = CAT_ICON[c.id]
                  return (
                    <button key={c.id} type="button" role="tab" aria-selected={category === c.id} className={`ae-cat ${category === c.id ? 'on' : ''} `} onClick={() => {
                        setCategory(c.id)
                        // Custom has a single option, so picking the category selects it.
                        if (c.id === 'custom' && draft.typeId !== 'custom_prompt') setDraft((d) => applyType(d, 'custom_prompt'))
                      }}>
                      <Icon size={15} />
                      <span className="grow">{c.label}</span>
                    </button>
                  )
                })}
              </div>
              <div className={`ae-types ${category === 'custom' ? 'custom' : ''}`}>
                {category === 'custom' && draft.custom && <OutputFields spec={draft.custom} onChange={(custom) => set({ custom })} errors={shown} />}
                {category !== 'custom' && ALERT_TYPES.filter((t) => t.category === category).map((t) => {
                  const on = draft.typeId === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`ae-type ${on ? 'on' : ''}`}
                      onClick={() => {
                        if (on) return
                        setDraft((d) => applyType(d, t.id))
                      }}
                    >
                      <span className="grow">
                        <span className="row" style={{ gap: 8 }}>
                          <span className="n">{t.name}</span>
                        </span>
                        {!on && <span className="d">{t.description}</span>}
                      </span>
                      {on && <Check size={15} />}
                    </button>
                  )
                })}
              </div>
            </div>
            {shown.type && <div className="err small" style={{ color: 'var(--bad)', marginTop: 6 }}>{shown.type}</div>}

            {m && !isCustom && (
              <div className="stack" style={{ gap: 16, marginTop: 18 }}>
                {m.type.metrics.length > 1 && (
                  <Field label="Metric" hint={m.metric.kind === 'count' ? 'Counts work well for low-volume agents.' : 'Rates stay meaningful as traffic goes up and down.'}>
                    <Segmented value={draft.metricKey} onChange={(k) => setDraft((d) => applyMetric(d, k))} options={m.type.metrics.map((x) => ({ value: x.key, label: x.label }))} />
                  </Field>
                )}
                {m.type.latency && (
                  <Field label="Unit">
                    <Segmented value={draft.latencyUnit} onChange={(u) => set({ latencyUnit: u, rows: draft.rows.map((r) => ({ ...r, value: r.value.trim() === '' || Number.isNaN(Number(r.value)) ? r.value : String(u === 'ms' ? Math.round(Number(r.value) * 1000) : Number(r.value) / 1000) })) })} options={[{ value: 's', label: 'Seconds' }, { value: 'ms', label: 'Milliseconds' }]} />
                  </Field>
                )}
                {m.type.filters.length > 0 && (
                  <div>
                    <div className="field-label">Additional filters</div>
                    <div className="small muted" style={{ margin: '2px 0 10px' }}>Leave a filter empty to include everything.</div>
                    <div className="stack" style={{ gap: 10 }}>
                      {m.type.filters.map((f) => {
                        const sel = draft.filters[f.key] ?? []
                        return (
                          <div key={f.key} className="ae-filter">
                            <span className="small" style={{ fontWeight: 550, minWidth: 120 }}>{f.label}</span>
                            <div className="row wrap" style={{ gap: 6 }}>
                              <Chip on={sel.length === 0} onClick={() => set({ filters: { ...draft.filters, [f.key]: [] } })}>All</Chip>
                              {f.options.map((o) => (
                                <Chip key={o} on={sel.includes(o)} onClick={() => set({ filters: { ...draft.filters, [f.key]: sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o] } })}>
                                  {o}
                                </Chip>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {m.type.note && <Callout>{m.type.note}</Callout>}
              </div>
            )}
          </section>

          {m && isCustom && draft.custom && <TriggerConditions spec={draft.custom} onChange={(custom) => set({ custom })} errors={shown} />}

          {m && !isCustom && (
            <section>
              <h2 className="ae-h">Alert thresholds</h2>
              <div className="ae-rows">
                {draft.rows.map((r) => (
                  <ThresholdLine
                    key={r.id}
                    row={r}
                    draft={draft}
                    error={shown[`row_${r.id}`]}
                    used={usedSev}
                    canRemove={draft.rows.length > 1}
                    onChange={(p) => set({ rows: draft.rows.map((x) => (x.id === r.id ? { ...x, ...p } : x)) })}
                    onRemove={() => set({ rows: draft.rows.filter((x) => x.id !== r.id) })}
                  />
                ))}
                {draft.rows.length === 0 && <div className="small muted" style={{ padding: 18 }}>No thresholds yet.</div>}
              </div>
              {shown.rows && <div className="small" style={{ color: 'var(--bad)', marginTop: 6 }}>{shown.rows}</div>}
              <div className="row" style={{ marginTop: 12 }}>
                <Button
                  disabled={usedSev.size >= 3}
                  onClick={() => {
                    const next = SEVERITIES.find((s) => !usedSev.has(s))!
                    set({ rows: [...draft.rows, defaultRow(m.type, m.metric, next)].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]) })
                  }}
                >
                  <Plus size={13} /> Add threshold
                </Button>
                {usedSev.size >= 3 && <span className="small faint">One threshold per severity.</span>}
              </div>
              {draft.rows.length > 0 && (
                <div className="ae-sentence">
                  <div className="mono faint" style={{ marginBottom: 6 }}>Condition preview</div>
                  {[...draft.rows].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]).map((r) => (
                    <p key={r.id}>{rowSentence(draft, r)}</p>
                  ))}
                </div>
              )}
            </section>
          )}

          {m && (
            <>
              <Field label="Time window" hint="How far back the alert looks at calls. It checks again every minute.">
                <select className="select" value={draft.windowMin} onChange={(e) => set({ windowMin: Number(e.target.value) })}>
                  {m.type.windows.map((w) => (
                    <option key={w} value={w}>Last {fmtWindow(w)}</option>
                  ))}
                </select>
              </Field>
              <Field label={m.type.minLabel ?? 'Minimum occurrences'} hint={`The alert can’t trigger until at least this many ${m.type.occurrenceNoun} happen in the time window.`}>
                <select className="select" value={draft.minOccurrences} onChange={(e) => set({ minOccurrences: Number(e.target.value) })}>
                  {m.type.occurrences.map((o) => (
                    <option key={o} value={o}>At least {o} {o === 1 ? m.type.occurrenceNoun.replace(/s(\b| )/, '$1') : m.type.occurrenceNoun}</option>
                  ))}
                </select>
              </Field>
            </>
          )}

          <section>
            <h2 className="ae-h">Notifications</h2>
            <div className="stack" style={{ gap: 10 }}>
              {draft.notifications.map((n) => (
                <NotificationLine
                  key={n.id}
                  n={n}
                  error={shown[`ntf_${n.id}`]}
                  onChange={(p) => set({ notifications: draft.notifications.map((x) => (x.id === n.id ? { ...x, ...p } : x)) })}
                  onRemove={() => set({ notifications: draft.notifications.filter((x) => x.id !== n.id) })}
                />
              ))}
              {draft.notifications.length === 0 && <div className="small muted">No one will be notified. Triggered alerts still show up in Activity.</div>}
            </div>
            <div style={{ marginTop: 12 }}>
              <Button onClick={() => set({ notifications: [...draft.notifications, { id: rid('ntf'), channel: draft.notifications.some((x) => x.channel === 'email') ? 'slack' : 'email', target: '', severities: ['critical', 'warning'] }] })}>
                <Plus size={13} /> Add notification
              </Button>
            </div>
          </section>

          {initial && dirty && <Callout>Changes apply from the moment you save. Past activity keeps the settings it ran with.</Callout>}
          <div className="row" style={{ gap: 10, paddingBottom: 40 }}>
            <Button variant="primary" lg disabled={!canSubmit || (!!initial && !dirty)} onClick={submit}>
              {initial ? 'Save changes' : 'Create alert'}
            </Button>
            {!embedded && <Button lg onClick={() => nav('/alerts?tab=alerts')}>Cancel</Button>}
            <div className="grow" />
            {initial && (
              <Button danger variant="ghost" onClick={() => setRemoving(true)}>
                <Trash2 size={13} /> Delete alert
              </Button>
            )}
          </div>
        </div>

        <Preview draft={draft} valid={!!m && Object.keys(errors).filter((k) => k !== 'name' && !k.startsWith('ntf_')).length === 0} />
      </div>

      {removing && initial && (
        <Confirm
          danger
          title={`Delete “${initial.name}”?`}
          body={<p>The alert stops checking and its activity is removed. This can’t be undone.</p>}
          confirmLabel="Delete alert"
          onClose={() => setRemoving(false)}
          onConfirm={() => {
            deleteAlert(initial.id)
            toast(`“${initial.name}” deleted.`, 'info')
            nav('/alerts?tab=alerts')
          }}
        />
      )}
    </div>
  )
}

/* ───────────── threshold row ───────────── */

function ThresholdLine({ row, draft, error, used, canRemove, onChange, onRemove }: { row: ThresholdRow; draft: AlertConfig; error?: string; used: Set<Severity>; canRemove: boolean; onChange: (p: Partial<ThresholdRow>) => void; onRemove: () => void }) {
  const m = metricOf(draft)!
  const ops: Op[] = m.type.perCall?.ops ?? m.metric.ops
  const unit = unitLabel(m.metric.unit, draft.latencyUnit)
  return (
    <div className={`ae-row ${error ? 'bad' : ''}`}>
      <div className="ae-row-line">
        <span>Severity is</span>
        <span className={`ae-sev ${row.severity}`}>
          <select className="select sm" value={row.severity} onChange={(e) => onChange({ severity: e.target.value as Severity })} aria-label="Severity">
            {SEVERITIES.map((s) => (
              <option key={s} value={s} disabled={s !== row.severity && used.has(s)}>{SEV_LABEL[s]}</option>
            ))}
          </select>
        </span>
        <span>when {m.type.perCall ? m.type.perCall.label : (/^[A-Z][a-z]/.test(m.metric.label) ? m.metric.label.charAt(0).toLowerCase() + m.metric.label.slice(1) : m.metric.label)} is</span>
        <select className="select sm" value={row.op} onChange={(e) => onChange({ op: e.target.value as Op })} aria-label="Operator">
          {ops.map((o) => (
            <option key={o} value={o}>{OP_SYMBOL[o]} {OP_LABEL[o]}</option>
          ))}
        </select>
        <input className={`input sm ae-num ${error ? 'invalid' : ''}`} inputMode="decimal" value={row.value} onChange={(e) => onChange({ value: e.target.value })} aria-label="Threshold value" />
        {m.type.perCall ? (
          <>
            <span>{m.type.perCall.unit} in more than</span>
            <input className={`input sm ae-num ${error ? 'invalid' : ''}`} inputMode="decimal" value={row.share} onChange={(e) => onChange({ share: e.target.value })} aria-label="Share of calls" />
            <span>% of calls</span>
          </>
        ) : (
          unit && <span>{unit}</span>
        )}
        {canRemove && (
          <Button variant="ghost" icon aria-label="Remove threshold" title="Remove threshold" onClick={onRemove} className="ae-x">
            <X size={14} />
          </Button>
        )}
      </div>
      {error && <div className="small" style={{ color: 'var(--bad)', marginTop: 6 }}>{error}</div>}
    </div>
  )
}

/* ───────────── notification row ───────────── */

const PLACEHOLDER: Record<Channel, string> = { inapp: '', email: 'oncall@acme-dental.com', slack: '#voice-alerts', webhook: 'https://hooks.example.com/alerts' }

function NotificationLine({ n, error, onChange, onRemove }: { n: AlertConfig['notifications'][number]; error?: string; onChange: (p: Partial<AlertConfig['notifications'][number]>) => void; onRemove: () => void }) {
  return (
    <div className={`ae-ntf ${error ? 'bad' : ''}`}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="ae-ntf-ico"><ChannelIcon channel={n.channel} /></span>
        <select className="select sm" value={n.channel} onChange={(e) => onChange({ channel: e.target.value as Channel, target: '' })} aria-label="Channel">
          {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
            <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
          ))}
        </select>
        {n.channel === 'inapp' ? (
          <span className="small muted grow">Shows in Activity and the sidebar count</span>
        ) : (
          <input className={`input sm grow ${error ? 'invalid' : ''}`} style={{ minWidth: 180, width: 'auto' }} value={n.target} placeholder={PLACEHOLDER[n.channel]} onChange={(e) => onChange({ target: e.target.value })} aria-label={`${CHANNEL_LABEL[n.channel]} destination`} />
        )}
        <Button variant="ghost" icon aria-label="Remove notification" onClick={onRemove}>
          <X size={14} />
        </Button>
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        <span className="small muted">Send for</span>
        {SEVERITIES.map((s) => (
          <Chip key={s} on={n.severities.includes(s)} onClick={() => onChange({ severities: n.severities.includes(s) ? n.severities.filter((x) => x !== s) : [...n.severities, s] })}>
            {SEV_LABEL[s]}
          </Chip>
        ))}
      </div>
      {error && <div className="small" style={{ color: 'var(--bad)', marginTop: 6 }}>{error}</div>}
    </div>
  )
}

/* ───────────── preview ───────────── */

function Preview({ draft, valid }: { draft: AlertConfig; valid: boolean }) {
  const { injections, now } = useAlerts()
  const [range, setRange] = useState<'24h' | '7d'>('24h')
  const [tested, setTested] = useState(false)
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const core = useDeferredValue(useMemo(() => coreOf(draft), [draft]))
  const coreKey = JSON.stringify(core)
  const minute = Math.floor(now / 60_000)

  const result = useMemo(() => {
    if (!tested || !valid) return null
    const end = minute * 60_000
    const span = range === '24h' ? DAY : 7 * DAY
    return evaluate(core, 'preview', 0, end - span, end, injections)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tested, valid, range, coreKey, minute, injections])

  const m = metricOf(draft)
  const all = result?.flatMap((g) => g.incidents) ?? []
  const counts = { critical: 0, warning: 0, info: 0 } as Record<Severity, number>
  for (const i of all) counts[i.severity] += 1
  const days = range === '24h' ? 1 : 7
  const perDay = all.length / days
  const busiest = result ? [...result].sort((a, b) => b.incidents.length - a.incidents.length)[0] : null
  const group = result?.find((g) => g.key === groupKey) ?? busiest
  const step = range === '7d' ? 10 : 1

  return (
    <aside className="ae-preview">
      <h2 className="ae-h">Preview</h2>
      {!tested || !result ? (
        <div className="ae-pv-empty">
          <BarChart3 size={30} strokeWidth={1.5} color="var(--ink-3)" />
          <p className="muted">See how often this alert would have triggered on your recent calls.</p>
          <div className="row">
            <Segmented value={range} onChange={setRange} options={[{ value: '24h', label: '24h' }, { value: '7d', label: '7d' }]} />
            <Button disabled={!valid} onClick={() => setTested(true)}>Test this alert</Button>
          </div>
          {!valid && <span className="small faint">{m ? 'Fix the thresholds to test.' : 'Choose a condition to test.'}</span>}
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="spread">
            <Segmented value={range} onChange={setRange} options={[{ value: '24h', label: '24h' }, { value: '7d', label: '7d' }]} />
            <span className="small faint">Updates as you edit</span>
          </div>
          <div>
            <div className="ae-pv-big">
              {all.length === 0 ? 'Wouldn’t have triggered' : `Would have triggered ${all.length} time${all.length === 1 ? '' : 's'}`}
            </div>
            <div className="small muted">in the last {range === '24h' ? '24 hours' : '7 days'}{all.length > 0 && range === '7d' ? ` · ${perDay < 1 ? 'less than once a day' : `about ${Math.round(perDay)} a day`}` : ''}</div>
            {all.length > 0 && (
              <div className="row wrap" style={{ marginTop: 10 }}>
                {SEVERITIES.filter((s) => draft.rows.some((r) => r.severity === s)).map((s) => (
                  <span key={s} className="row" style={{ gap: 6 }}>
                    <SeverityBadge severity={s} />
                    <span className="num small">{counts[s]}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          {perDay > 12 && <Callout tone="warn">This would be noisy, about {Math.round(perDay)} alerts a day. Try a longer window, a higher threshold or more minimum occurrences.</Callout>}
          {all.length === 0 && <Callout>That’s fine for problems that should be rare. Lower a threshold if you expected it to catch something.</Callout>}

          {group && m && (
            <div>
              {result.length > 1 && (
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="small muted">Showing</span>
                  <select className="select sm" value={group.key} onChange={(e) => setGroupKey(e.target.value)} aria-label="Group">
                    {result.map((g) => (
                      <option key={g.key} value={g.key}>{g.label} · {g.incidents.length}</option>
                    ))}
                  </select>
                </div>
              )}
              <AlertChart
                series={[{ name: group.label, color: '#2a78d6', data: group.points.filter((_, i) => i % step === 0).map((p) => [p.t, p.v]) }]}
                lines={m.type.perCall && !m.type.id.startsWith('custom') ? draft.rows.map((r) => ({ severity: r.severity, value: Number(r.share) })) : chartLines(core)}
                unit={m.type.perCall ? '%' : m.metric.unit}
                latencyUnit={draft.latencyUnit}
                bands={group.incidents.map((i) => ({ from: i.startedAt, to: i.endedAt ?? minute * 60_000, severity: i.severity }))}
              />
            </div>
          )}

          {all.length > 0 && m && (
            <div className="card table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Triggered</th>
                    <th>Severity</th>
                    {result.length > 1 && <th>{GROUP_LABEL[draft.groupBy]}</th>}
                    <th>Peak</th>
                    <th>Lasted</th>
                  </tr>
                </thead>
                <tbody>
                  {[...all].sort((a, b) => b.startedAt - a.startedAt).slice(0, 8).map((i) => (
                    <tr key={i.id}>
                      <td className="small">{fmtWhen(i.startedAt, now)}</td>
                      <td><SeverityBadge severity={i.severity} /></td>
                      {result.length > 1 && <td className="small">{i.groupLabel}</td>}
                      <td className="small num">{fmtVal(i.peak, m.type.perCall ? '%' : m.metric.unit, draft.latencyUnit)}</td>
                      <td className="small">{i.endedAt ? fmtSpan(i.endedAt - i.startedAt) : 'ongoing'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {all.length > 8 && <div className="card-foot"><span>and {all.length - 8} more</span></div>}
            </div>
          )}
          {m?.type.id === 'custom_prompt' && <SampleOutputs core={core} groupKey={group?.key ?? 'all'} from={minute * 60_000 - (range === '24h' ? DAY : 7 * DAY)} to={(minute + 1) * 60_000} />}
          <div className="small faint">Tested on simulated calls. Alerts resolve automatically and wait 15 minutes before triggering again.</div>
        </div>
      )}
    </aside>
  )
}

function SampleOutputs({ core, groupKey, from, to }: { core: AlertCore; groupKey: string; from: number; to: number }) {
  const { injections } = useAlerts()
  const calls = useMemo(() => customCalls(core, groupKey, from, to, injections, 5), [core, groupKey, from, to, injections])
  if (!calls.length) return null
  return (
    <div>
      <div className="field-label" style={{ marginBottom: 6 }}>Latest matching calls</div>
      <div className="small muted" style={{ marginBottom: 8 }}>What the evaluator returned, and which severity it matched.</div>
      <CustomCallList calls={calls} spec={core.custom} />
    </div>
  )
}

/* ───────────── small controls ───────────── */

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`ae-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>
      {on && <Check size={11} />}
      {children}
    </button>
  )
}
