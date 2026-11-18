import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { Copy, Pencil, Play, Plus, Search, SearchX, ShieldCheck, Trash2, X } from 'lucide-react'
import { ChannelIcon, IncidentDrawer, SeverityBadge, SimulateModal, StatusBadge, channelTarget } from '../components/AlertParts'
import { Button, Confirm, Empty, Segmented, Toggle } from '../components/ui'
import { CATEGORIES, DAY, HOUR, MIN, SEVERITIES, SEV_COLOR, SEV_LABEL, SEV_RANK, affectedCalls, customCalls, fmtAgo, fmtWhen, metricOf, rowShort, type AlertConfig, type CategoryId, type Severity } from '../lib/alerts'
import { useAlerts, type IncidentRow, type IncidentStatus } from '../lib/alertsStore'
import { PALETTE } from '../lib/analytics'
import { ruleText } from '../lib/customAlerts'
import { AGENTS, hash } from '../lib/mock'
import { SAMPLE_PREFIX } from '../lib/alertSamples'
import { useStore } from '../lib/store'
import AlertEditor from './AlertEditor'

type Range = '24h' | '7d'
/** Range start, aligned with the trend chart's buckets (whole hours / whole days). */
function rangeStart(range: Range, now: number): number {
  if (range === '24h') return Math.floor(now / HOUR) * HOUR - 23 * HOUR
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime() - 6 * DAY
}
const RANGE_LABEL: Record<Range, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days' }
const STATUS_LABEL: Record<IncidentStatus, string> = { ongoing: 'Ongoing', resolved: 'Resolved' }

interface Event extends IncidentRow {
  category: CategoryId
  typeName: string
  callId: string
  affected: number
}

export default function Alerts() {
  const { alerts } = useAlerts()
  // No alerts yet: the page is the Create alert form.
  if (alerts.length === 0) return <AlertEditor embedded />
  return <AlertsHome />
}

function AlertsHome() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const { alerts, incidents, injections, now, removeSamples } = useAlerts()
  const { toast } = useStore()
  const samples = alerts.filter((a) => a.id.startsWith(SAMPLE_PREFIX)).length
  const tab = params.get('tab') === 'alerts' ? 'alerts' : 'analytics'
  const setTab = (t: 'analytics' | 'alerts') => setParams(t === 'alerts' ? { tab: 'alerts' } : {}, { replace: true })
  const [range, setRange] = useState<Range>('7d')
  const [severity, setSeverity] = useState<'all' | Severity>('all')
  const [category, setCategory] = useState<'all' | CategoryId>('all')
  const [simulating, setSimulating] = useState(false)
  const [openIncident, setOpenIncident] = useState<string | null>(null)
  // History-only filters (set directly or by clicking charts).
  const [query, setQuery] = useState('')
  const [hAlert, setHAlert] = useState('all')
  const [hStatus, setHStatus] = useState<'all' | IncidentStatus>('all')
  const [bucket, setBucket] = useState<{ from: number; to: number; label: string } | null>(null)

  const events = useMemo<Event[]>(() => {
    const start = rangeStart(range, now)
    const out: Event[] = []
    for (const i of incidents) {
      if (i.startedAt < start) continue
      const seg = i.alert.segments[i.segment]
      const m = seg ? metricOf(seg.core) : null
      if (!seg || !m) continue
      if (severity !== 'all' && i.severity !== severity) continue
      if (category !== 'all' && m.type.category !== category) continue
      const end = i.endedAt ?? now
      const callId = m.type.id === 'custom_prompt' ? (customCalls(seg.core, i.groupKey, i.startedAt - seg.core.windowMin * MIN, i.startedAt + MIN, injections, 1)[0]?.callId ?? '—') : `call_${(hash(i.id) >>> 0).toString(16).slice(-6)}`
      out.push({ ...i, category: m.type.category, typeName: m.type.name, callId, affected: affectedCalls(seg.core, i.groupKey, i.startedAt - seg.core.windowMin * MIN, end) })
    }
    return out
  }, [incidents, injections, now, range, severity, category])

  const kpi = useMemo(
    () => ({
      total: events.length,
      critical: events.filter((e) => e.severity === 'critical').length,
      affected: events.reduce((s, e) => s + e.affected, 0),
    }),
    [events],
  )

  const history = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events.filter(
      (e) =>
        (hAlert === 'all' || e.alert.id === hAlert) &&
        (hStatus === 'all' || e.status === hStatus) &&
        (!bucket || (e.startedAt >= bucket.from && e.startedAt < bucket.to)) &&
        (!q || `${e.alert.name} ${e.typeName} ${e.callId} ${e.groupLabel}`.toLowerCase().includes(q)),
    )
  }, [events, query, hAlert, hStatus, bucket])

  const toHistory = () => setTimeout(() => document.getElementById('history')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  const clearAll = () => {
    setSeverity('all')
    setCategory('all')
    setQuery('')
    setHAlert('all')
    setHStatus('all')
    setBucket(null)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <p>What your alerts caught, how often, and what still needs attention.</p>
        </div>
        <div className="row">
          <Button onClick={() => setSimulating(true)}>
            <Play size={11} fill="currentColor" /> Simulate issue
          </Button>
          <Button variant="primary" onClick={() => nav('/alerts/new')}>
            <Plus size={13} /> Create alert
          </Button>
        </div>
      </div>

      <div className="filters">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'analytics', label: 'Analytics' },
            { value: 'alerts', label: `Your alerts · ${alerts.length}` },
          ]}
        />
      </div>

      {samples > 0 && (
        <div className="an-sample">
          <span>
            <b>Sample data.</b> {samples} example alert{samples === 1 ? '' : 's'} with a week of simulated activity, so you can explore the analytics.
          </span>
          <button
            className="link small"
            onClick={() => {
              removeSamples()
              toast('Sample alerts removed.', 'info')
            }}
          >
            Remove sample alerts
          </button>
        </div>
      )}

      {tab === 'alerts' ? (
        <AlertList />
      ) : (
        <>
          <div className="filters an-filters">
            <label className="an-f">
              <span>Time range</span>
              <select className="select sm" value={range} onChange={(e) => { setRange(e.target.value as Range); setBucket(null) }}>
                {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
                  <option key={r} value={r}>{RANGE_LABEL[r]}</option>
                ))}
              </select>
            </label>
            <label className="an-f">
              <span>Severity</span>
              <select className="select sm" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                <option value="all">All severities</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{SEV_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label className="an-f">
              <span>Alert category</span>
              <select className="select sm" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                <option value="all">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
            {(severity !== 'all' || category !== 'all') && (
              <button className="link small" onClick={() => { setSeverity('all'); setCategory('all') }}>Reset filters</button>
            )}
          </div>

          <section>
            <h2 className="an-h"><span className="mono faint">01</span> Alert overview</h2>
            <div className="grid metrics">
              <Kpi label="Total events" value={kpi.total} foot={RANGE_LABEL[range]} onClick={() => { setHStatus('all'); toHistory() }} />
              <Kpi label="Critical" value={kpi.critical} tone={kpi.critical ? 'bad' : undefined} foot={kpi.total ? `${Math.round((kpi.critical / kpi.total) * 100)}% of events` : '—'} onClick={() => { setSeverity('critical'); toHistory() }} />
              <Kpi label="Affected calls" value={kpi.affected} foot="Calls handled while an alert was ongoing" onClick={toHistory} />
            </div>
          </section>

          <section>
            <h2 className="an-h"><span className="mono faint">02</span> Alert trends</h2>
            <div className="card">
              <TrendChart
                events={events}
                range={range}
                now={now}
                onPick={(b, sev) => {
                  setBucket(b)
                  if (sev) setSeverity(sev)
                  toHistory()
                }}
              />
            </div>
          </section>

          <section>
            <h2 className="an-h"><span className="mono faint">03</span> Alert distribution</h2>
            <div className="grid three">
              <DistCard
                title="By category"
                rows={CATEGORIES.map((c, i) => ({ key: c.id, label: c.label, n: events.filter((e) => e.category === c.id).length, color: PALETTE[i] }))}
                onPick={(k) => setCategory(k as CategoryId)}
              />
              <DistCard
                title="By severity"
                rows={SEVERITIES.map((s) => ({ key: s, label: SEV_LABEL[s], n: events.filter((e) => e.severity === s).length, color: SEV_COLOR[s] }))}
                onPick={(k) => setSeverity(k as Severity)}
              />
              <DistCard title="Top 10 triggered alerts" rows={topAlerts(events)} onPick={(k) => { setHAlert(k); toHistory() }} empty="Nothing triggered in this range." />
            </div>
          </section>

          <section id="history">
            <h2 className="an-h"><span className="mono faint">04</span> Alert event history</h2>
            <div className="filters">
              <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 340 }}>
                <Search size={14} style={{ position: 'absolute', left: 11, top: 9, color: 'var(--ink-3)' }} />
                <input className="input sm" style={{ paddingLeft: 32, width: '100%' }} placeholder="Search alert, call ID or agent…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search events" />
              </div>
              <select className="select sm" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} aria-label="Severity">
                <option value="all">Any severity</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{SEV_LABEL[s]}</option>
                ))}
              </select>
              <select className="select sm" value={hAlert} onChange={(e) => setHAlert(e.target.value)} aria-label="Alert">
                <option value="all">All alerts</option>
                {alerts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <select className="select sm" value={hStatus} onChange={(e) => setHStatus(e.target.value as typeof hStatus)} aria-label="Status">
                <option value="all">Any status</option>
                {(Object.keys(STATUS_LABEL) as IncidentStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              {bucket && (
                <span className="chip">
                  {bucket.label}
                  <button className="an-chip-x" aria-label="Clear time filter" onClick={() => setBucket(null)}><X size={11} /></button>
                </span>
              )}
            </div>
            <div className="card">
              {history.length === 0 ? (
                events.length === 0 ? (
                  <Empty icon={<ShieldCheck size={18} />} title="All clear" actions={<Button onClick={() => setSimulating(true)}><Play size={11} fill="currentColor" /> Simulate issue</Button>}>
                    None of your alerts triggered in this range. Simulate an issue to see one fire.
                  </Empty>
                ) : (
                  <Empty icon={<SearchX size={18} />} title="No events match" actions={<Button onClick={clearAll}>Clear filters</Button>}>
                    Try a wider search or fewer filters.
                  </Empty>
                )
              ) : (
                <HistoryTable key={`${query}|${hAlert}|${hStatus}|${bucket?.from}|${severity}|${category}|${range}`} rows={history} now={now} onOpen={setOpenIncident} />
              )}
            </div>
          </section>
        </>
      )}

      {openIncident && <IncidentDrawer id={openIncident} onClose={() => setOpenIncident(null)} onEdit={(id) => nav(`/alerts/${id}`)} />}
      {simulating && <SimulateModal alerts={alerts} onClose={() => setSimulating(false)} />}
    </>
  )
}

function topAlerts(events: Event[]) {
  const m = new Map<string, { label: string; n: number }>()
  for (const e of events) {
    const x = m.get(e.alert.id) ?? { label: e.alert.name, n: 0 }
    x.n += 1
    m.set(e.alert.id, x)
  }
  return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([key, v]) => ({ key, label: v.label, n: v.n, color: PALETTE[0] }))
}

/* ───────────── pieces ───────────── */

function Kpi({ label, value, foot, tone, onClick }: { label: string; value: number; foot: string; tone?: 'bad' | 'warn'; onClick: () => void }) {
  return (
    <button className={`card metric ${tone ? `al-stat ${tone}` : ''}`} onClick={onClick}>
      <span className="label">{label}</span>
      <span className="value">{value.toLocaleString()}</span>
      <span className="foot">{foot}</span>
    </button>
  )
}

function DistCard({ title, rows, onPick, empty }: { title: string; rows: { key: string; label: string; n: number; color: string }[]; onPick: (key: string) => void; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  const total = rows.reduce((s, r) => s + r.n, 0)
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
      </div>
      <div className="card-body">
        {rows.length === 0 || total === 0 ? (
          <div className="small faint">{empty ?? 'No events.'}</div>
        ) : (
          <div className="dist">
            {rows.map((r) => (
              <button key={r.key} type="button" className="dist-row" onClick={() => onPick(r.key)} title={`Filter by ${r.label}`}>
                <span className="small truncate">{r.label}</span>
                <span className="bar">{r.n > 0 && <i style={{ width: `${(r.n / max) * 100}%`, background: r.color }} />}</span>
                <span className="n">{r.n} · {Math.round((r.n / total) * 100)}%</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric' })
const hourFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric' })

function TrendChart({ events, range, now, onPick }: { events: Event[]; range: Range; now: number; onPick: (b: { from: number; to: number; label: string }, sev: Severity | null) => void }) {
  const hourKey = Math.floor(now / HOUR)
  const buckets = useMemo(() => {
    const out: { from: number; to: number; label: string }[] = []
    if (range === '7d') {
      const d = new Date(hourKey * HOUR)
      d.setHours(0, 0, 0, 0)
      for (let i = 6; i >= 0; i -= 1) {
        const from = d.getTime() - i * DAY
        out.push({ from, to: from + DAY, label: dayFmt.format(from) })
      }
    } else {
      const top = hourKey * HOUR
      for (let i = 23; i >= 0; i -= 1) {
        const from = top - i * HOUR
        out.push({ from, to: from + HOUR, label: hourFmt.format(from) })
      }
    }
    return out
  }, [range, hourKey])

  const counts = useMemo(() => {
    const c: Record<Severity, number[]> = { critical: buckets.map(() => 0), warning: buckets.map(() => 0), info: buckets.map(() => 0) }
    for (const e of events) {
      const i = buckets.findIndex((b) => e.startedAt >= b.from && e.startedAt < b.to)
      if (i >= 0) c[e.severity][i] += 1
    }
    return c
  }, [events, buckets])
  const totals = { critical: counts.critical.reduce((a, b) => a + b, 0), warning: counts.warning.reduce((a, b) => a + b, 0), info: counts.info.reduce((a, b) => a + b, 0) }

  const options = useMemo<Highcharts.Options>(
    () => ({
      chart: { type: 'column', height: 260, backgroundColor: 'transparent', style: { fontFamily: "'Inter Variable', Inter, system-ui, sans-serif" }, spacing: [12, 8, 8, 8] },
      title: { text: undefined },
      credits: { enabled: false },
      accessibility: { enabled: false },
      legend: { enabled: false },
      xAxis: { categories: buckets.map((b) => b.label), lineColor: '#d6d6d2', tickLength: 0, labels: { style: { color: '#4d4d4a', fontSize: '11.5px' }, step: range === '24h' ? 3 : 1 } },
      yAxis: { title: { text: undefined }, gridLineColor: '#ededea', allowDecimals: false, min: 0, labels: { style: { color: '#8a8a85', fontSize: '11px' } }, stackLabels: { enabled: range === '7d', style: { color: '#4d4d4a', fontSize: '11px', fontWeight: '500', textOutline: 'none' } } },
      tooltip: { shared: true, backgroundColor: '#111', borderWidth: 0, borderRadius: 8, shadow: false, padding: 10, style: { color: '#fff', fontSize: '12.5px' }, headerFormat: '<span style="font-size:11px;color:#b5b5b0">{point.key}</span><br/>', pointFormat: '<span style="color:{point.color}">●</span> {series.name}: <b>{point.y}</b><br/>' },
      plotOptions: {
        column: { stacking: 'normal', borderRadius: 3, borderWidth: 1, borderColor: '#ffffff', maxPointWidth: 38, groupPadding: 0.12, pointPadding: 0.04, cursor: 'pointer' },
        series: {
          animation: { duration: 250 },
          point: {
            events: {
              click: function () {
                const sev = (this.series.userOptions as { custom?: { sev: Severity } }).custom?.sev ?? null
                onPick(buckets[this.index], sev)
              },
            },
          },
        },
      },
      series: (['info', 'warning', 'critical'] as Severity[]).map((s) => ({ type: 'column', name: SEV_LABEL[s], color: SEV_COLOR[s], data: counts[s], custom: { sev: s } })) as Highcharts.SeriesOptionsType[],
    }),
    [buckets, counts, range, onPick],
  )

  return (
    <>
      <div className="card-head">
        <div>
          <h3>{range === '7d' ? 'Daily' : 'Hourly'} alerts by severity</h3>
          <div className="sub">Click a bar to see those events below.</div>
        </div>
        <div className="legend">
          {(['critical', 'warning', 'info'] as Severity[]).map((s) => (
            <span key={s} className="row" style={{ gap: 6 }}>
              <span className="dot" style={{ background: SEV_COLOR[s] }} /> {SEV_LABEL[s]} <b className="num">{totals[s]}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="card-body">
        <HighchartsReact highcharts={Highcharts} options={options} />
      </div>
    </>
  )
}

function HistoryTable({ rows, now, onOpen }: { rows: Event[]; now: number; onOpen: (id: string) => void }) {
  const [limit, setLimit] = useState(25)
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Alert</th>
              <th className="hide-sm">Call ID</th>
              <th>Status</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((e) => (
              <tr key={e.id} className="click" onClick={() => onOpen(e.id)}>
                <td><SeverityBadge severity={e.severity} /></td>
                <td style={{ maxWidth: 320 }}>
                  <div style={{ fontWeight: 550 }}>{e.alert.name}</div>
                  <div className="small muted truncate">{e.typeName} · {e.groupLabel}</div>
                </td>
                <td className="hide-sm"><code className="mono" style={{ textTransform: 'none' }}>{e.callId}</code></td>
                <td><StatusBadge status={e.status} /></td>
                <td className="small">
                  {fmtWhen(e.startedAt, now)}
                  <div className="faint">{fmtAgo(e.startedAt, now)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-foot">
        <span>Showing {Math.min(limit, rows.length)} of {rows.length} events</span>
        {rows.length > limit && <button className="link" onClick={() => setLimit((l) => l + 25)}>Show more</button>}
      </div>
    </>
  )
}

/* ───────────── your alerts ───────────── */

function AlertList() {
  const nav = useNavigate()
  const { alerts, incidents, now, setEnabled, deleteAlert, duplicateAlert } = useAlerts()
  const { toast } = useStore()
  const [removing, setRemoving] = useState<AlertConfig | null>(null)
  const lastFired = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of incidents) if (!m.has(i.alert.id) || m.get(i.alert.id)! < i.startedAt) m.set(i.alert.id, i.startedAt)
    return m
  }, [incidents])

  return (
    <div className="card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Alert</th>
              <th className="hide-sm">Thresholds</th>
              <th className="hide-sm">Applies to</th>
              <th className="hide-sm">Notifies</th>
              <th className="hide-sm">Last triggered</th>
              <th>On</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => {
              const m = metricOf(a)
              const fired = lastFired.get(a.id)
              return (
                <tr key={a.id} className="click" onClick={() => nav(`/alerts/${a.id}`)}>
                  <td style={{ maxWidth: 300 }}>
                    <div style={{ fontWeight: 550 }}>
                      {a.name} {a.id.startsWith(SAMPLE_PREFIX) && <span className="badge outline" style={{ marginLeft: 6 }}>Sample</span>}
                    </div>
                    <div className="small muted">{m ? `${m.type.name}${m.type.metrics.length > 1 ? ` · ${m.metric.label}` : ''} · last ${a.windowMin >= 60 ? `${a.windowMin / 60} h` : `${a.windowMin} min`}` : '—'}</div>
                  </td>
                  <td className="hide-sm">
                    <div className="stack" style={{ gap: 4 }}>
                      {a.custom
                        ? [...a.custom.rules].sort((x, y) => SEV_RANK[y.severity] - SEV_RANK[x.severity]).map((r) => (
                            <span key={r.id} className="row small" style={{ gap: 6, maxWidth: 320 }} title={ruleText(r, a.custom!)}>
                              <span className={`dot sev-${r.severity}`} /> <span className="truncate code-ish">{ruleText(r, a.custom!)}</span>
                            </span>
                          ))
                        : [...a.rows].sort((x, y) => SEV_RANK[y.severity] - SEV_RANK[x.severity]).map((r) => (
                            <span key={r.id} className="row small num" style={{ gap: 6 }}>
                              <span className={`dot sev-${r.severity}`} /> {rowShort(a, r)}
                            </span>
                          ))}
                    </div>
                  </td>
                  <td className="hide-sm small">{a.agentIds.length ? AGENTS.filter((x) => a.agentIds.includes(x.id)).map((x) => x.name).join(', ') : 'All agents'}</td>
                  <td className="hide-sm">
                    <div className="row wrap" style={{ gap: 6 }}>
                      {a.notifications.length === 0 ? (
                        <span className="small faint">Nobody</span>
                      ) : (
                        a.notifications.map((n) => (
                          <span key={n.id} className="row small muted" style={{ gap: 4 }} title={channelTarget(n)}>
                            <ChannelIcon channel={n.channel} size={12} />
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="hide-sm small">{fired ? fmtAgo(fired, now) : <span className="faint">{a.enabled ? 'Not yet' : '—'}</span>}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Toggle
                      on={a.enabled}
                      label={a.enabled ? `Disable ${a.name}` : `Enable ${a.name}`}
                      onChange={(on) => {
                        setEnabled(a.id, on)
                        toast(on ? `“${a.name}” enabled. It checks every minute from now.` : `“${a.name}” disabled. Its history is kept.`, on ? 'success' : 'info')
                      }}
                    />
                  </td>
                  <td className="right" onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                      <Button variant="ghost" icon title="Edit" aria-label={`Edit ${a.name}`} onClick={() => nav(`/alerts/${a.id}`)}><Pencil size={13} /></Button>
                      <Button variant="ghost" icon title="Duplicate" aria-label={`Duplicate ${a.name}`} onClick={() => { if (duplicateAlert(a.id)) toast('Duplicated. The copy is disabled until you switch it on.') }}><Copy size={13} /></Button>
                      <Button variant="ghost" icon danger title="Delete" aria-label={`Delete ${a.name}`} onClick={() => setRemoving(a)}><Trash2 size={13} /></Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {removing && (
        <Confirm
          danger
          title={`Delete “${removing.name}”?`}
          body={<p>The alert stops checking and its history is removed. This can’t be undone.</p>}
          confirmLabel="Delete alert"
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            deleteAlert(removing.id)
            toast(`“${removing.name}” deleted.`, 'info')
          }}
        />
      )}
    </div>
  )
}
