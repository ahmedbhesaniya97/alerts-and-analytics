import { useMemo } from 'react'
import { AlertOctagon, AlertTriangle, BellRing, Globe, Info, Mail, MessageSquare, MonitorSmartphone, Play } from 'lucide-react'
import { DAY, MIN, SCENARIOS, SEV_RANK, TYPE_BY_ID, customCalls, evaluate, fmtAgo, fmtSpan, fmtVal, fmtWhen, metricOf, type AlertConfig, type AlertCore, type Channel, type CustomCall, type Severity } from '../lib/alerts'
import { ruleMatches, type CustomSpec } from '../lib/customAlerts'
import { useAlerts, type IncidentStatus } from '../lib/alertsStore'
import { AlertChart } from './AlertChart'
import { Badge, Button, Callout, Drawer, Modal } from './ui'

export function SeverityBadge({ severity }: { severity: Severity }) {
  if (severity === 'critical') return <Badge tone="bad"><AlertOctagon size={10} /> Critical</Badge>
  if (severity === 'warning') return <Badge tone="warn"><AlertTriangle size={10} /> Warning</Badge>
  return <Badge tone="info"><Info size={10} /> Info</Badge>
}
export function StatusBadge({ status }: { status: IncidentStatus }) {
  if (status === 'ongoing') return <Badge tone="outline"><BellRing size={10} /> Ongoing</Badge>
  return <Badge>Resolved</Badge>
}
export function ChannelIcon({ channel, size = 13 }: { channel: Channel; size?: number }) {
  if (channel === 'email') return <Mail size={size} />
  if (channel === 'slack') return <MessageSquare size={size} />
  if (channel === 'webhook') return <Globe size={size} />
  return <MonitorSmartphone size={size} />
}
export function channelTarget(n: { channel: Channel; target: string }): string {
  return n.channel === 'inapp' ? 'In-app' : n.target
}

/** Values in the threshold rows, converted to the unit the evaluator charts in. */
export function chartLines(core: AlertCore): { severity: Severity; value: number; label?: string; color?: string }[] {
  const m = metricOf(core)
  if (m?.type.id === 'custom_prompt') return [{ severity: 'info', value: core.minOccurrences, label: `Triggers at ${core.minOccurrences} matching call${core.minOccurrences === 1 ? '' : 's'}`, color: '#8a8a85' }]
  if (!m || m.type.perCall) return []
  const k = m.metric.unit === 's' && core.latencyUnit === 'ms' ? 0.001 : 1
  return core.rows.filter((r) => r.value.trim() !== '' && !Number.isNaN(Number(r.value))).map((r) => ({ severity: r.severity, value: Number(r.value) * k }))
}

/* ───────────── incident drawer ───────────── */

export function IncidentDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (alertId: string) => void }) {
  const { incidents, injections, now } = useAlerts()
  const inc = incidents.find((i) => i.id === id)
  const seg = inc ? inc.alert.segments[inc.segment] : null
  const group = useMemo(() => {
    if (!inc || !seg) return null
    // Plot the metric for the whole day; the alert itself only triggers from seg.from.
    const from = now - DAY
    const to = seg.to ?? now + MIN
    return evaluate(seg.core, inc.alert.id, inc.segment, from, to, injections).find((g) => g.key === inc.groupKey) ?? null
  }, [inc, seg, now, injections])

  if (!inc || !seg) {
    return (
      <Drawer title="Incident" onClose={onClose}>
        <Callout>This incident is older than 24 hours or its alert was deleted.</Callout>
      </Drawer>
    )
  }
  const m = metricOf(seg.core)!
  const { type, metric } = m
  const unit = type.perCall ? '%' : metric.unit
  const end = inc.endedAt ?? now
  const cause = injections.find((j) => j.typeId === type.id && inc.startedAt >= j.from - 2 * MIN && inc.startedAt <= j.to)
  const notify = (sev: Severity) => inc.alert.notifications.filter((n) => n.severities.includes(sev))
  const timeline: { t: number; text: string; tone?: 'bad' | 'warn' | 'good' | 'info' }[] = [
    { t: inc.startedAt, text: `Triggered${inc.escalations.length ? ` as ${firstSeverity(inc.severity, inc.escalations)}` : ''}`, tone: tone(firstSeverity(inc.severity, inc.escalations)) },
  ]
  const first = notify(firstSeverity(inc.severity, inc.escalations))
  if (first.length) timeline.push({ t: inc.startedAt, text: `Notified ${first.map(channelTarget).join(', ')}` })
  for (const e of inc.escalations) {
    timeline.push({ t: e.t, text: `Escalated to ${e.severity === 'critical' ? 'Critical' : 'Warning'}${notify(e.severity).length ? ` · notified ${notify(e.severity).map(channelTarget).join(', ')}` : ''}`, tone: tone(e.severity) })
  }
  if (inc.endedAt) {
    timeline.push({ t: inc.endedAt, text: 'Back to normal · resolved automatically', tone: 'good' })
    if (seg.core.recoveryNotify && first.length) timeline.push({ t: inc.endedAt, text: `Recovery notice sent to ${first.map(channelTarget).join(', ')}` })
    timeline.push({ t: inc.endedAt, text: `Cooldown: won’t trigger again for this ${seg.core.groupBy === 'none' ? 'alert' : 'group'} for ${seg.core.cooldownMin} min` })
  }
  timeline.sort((a, b) => a.t - b.t)

  return (
    <Drawer
      wide
      title={
        <span className="row wrap">
          {inc.alert.name}
          <span className="faint" style={{ fontWeight: 400 }}>· {inc.groupLabel}</span>
        </span>
      }
      subtitle={
        <span className="row wrap" style={{ marginTop: 6 }}>
          <SeverityBadge severity={inc.severity} />
          <StatusBadge status={inc.status} />
          <span className="small muted">{type.name} · triggered {fmtAgo(inc.startedAt, now)}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <div className="grow" />
          <Button onClick={() => onEdit(inc.alert.id)}>Edit alert</Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 18 }}>
        {cause && <Callout tone="bad"><b>Likely cause.</b> {cause.note}</Callout>}
        <div className="kv">
          <div><div className="k">Triggered</div><div className="v">{fmtWhen(inc.startedAt, now)}</div></div>
          <div><div className="k">{inc.endedAt ? 'Lasted' : 'Ongoing for'}</div><div className="v">{fmtSpan(end - inc.startedAt)}</div></div>
          <div><div className="k">{type.perCall ? 'Peak share' : metric.ops[0].startsWith('l') ? 'Lowest' : 'Peak'}</div><div className="v">{fmtVal(inc.peak, unit, seg.core.latencyUnit)}</div></div>
          <div><div className="k">Window</div><div className="v">{seg.core.windowMin} min</div></div>
        </div>
        {group && (
          <div>
            <div className="field-label" style={{ marginBottom: 4 }}>{type.perCall ? `Share of calls with ${type.perCall.label} ${seg.core.rows[0]?.op === 'gt' ? 'over' : 'under'} ${seg.core.rows[0]?.value} s` : metric.label} · {inc.groupLabel}</div>
            <div className="small muted" style={{ marginBottom: 6 }}>Shaded: this incident.{seg.from > now - DAY ? ` The alert started checking ${fmtWhen(seg.from, now)}.` : ''} Drag across the chart to zoom.</div>
            <AlertChart
              series={[{ name: inc.groupLabel, color: '#2a78d6', data: group.points.map((p) => [p.t, p.v]) }]}
              lines={type.perCall ? seg.core.rows.map((r) => ({ severity: r.severity, value: Number(r.share) })) : chartLines(seg.core)}
              unit={unit}
              latencyUnit={seg.core.latencyUnit}
              bands={[{ from: inc.startedAt, to: end, severity: inc.severity }]}
            />
          </div>
        )}
        {type.id === 'custom_prompt' && seg.core.custom && (
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>Matching calls</div>
            <div className="small muted" style={{ marginBottom: 8 }}>The evaluator’s structured output for calls in this incident that matched a rule.</div>
            <CustomCallList calls={customCalls(seg.core, inc.groupKey, inc.startedAt - seg.core.windowMin * MIN, end, injections, 8)} spec={seg.core.custom} />
          </div>
        )}
        <div>
          <div className="field-label" style={{ marginBottom: 8 }}>Timeline</div>
          <div className="al-timeline">
            {timeline.map((e, i) => (
              <div key={i} className={`al-tl ${e.tone ?? ''}`}>
                <span className="small faint num">{fmtWhen(e.t, now)}</span>
                <span className="small">{e.text}</span>
              </div>
            ))}
          </div>
        </div>
        {inc.alert.notifications.length === 0 && <Callout tone="warn">This alert has no notifications, so nobody was told. Add one when you edit the alert.</Callout>}
      </div>
    </Drawer>
  )
}

function firstSeverity(final: Severity, esc: { severity: Severity }[]): Severity {
  if (!esc.length) return final
  const order = [final, ...esc.map((e) => e.severity)]
  return order.reduce((lo, s) => (SEV_RANK[s] < SEV_RANK[lo] ? s : lo), final)
}
function tone(s: Severity): 'bad' | 'warn' | 'info' {
  return s === 'critical' ? 'bad' : s === 'warning' ? 'warn' : 'info'
}

/* ───────────── simulator ───────────── */

export function SimulateModal({ alerts, onClose }: { alerts: AlertConfig[]; onClose: () => void }) {
  const { simulate, injections, now } = useAlerts()
  return (
    <Modal title="Simulate an issue" subtitle="Inject a fault into the mock call data and see which of your alerts catch it. Each fault clears on its own after a while." onClose={onClose}>
      <div className="stack" style={{ gap: 8 }}>
        {SCENARIOS.map((s) => {
          const watchers = alerts.filter((a) => a.enabled && a.typeId === s.typeId)
          const live = injections.some((j) => j.typeId === s.typeId && j.scenario === s.label && j.to > now)
          return (
            <div key={s.id} className="al-scn">
              <div className="grow">
                <div style={{ fontWeight: 550 }}>{s.label}</div>
                <div className="small muted">{s.detail}</div>
                <div className="small" style={{ marginTop: 2 }}>
                  {watchers.length ? <>Caught by <b>{watchers.map((w) => w.name).join(', ')}</b></> : <span className="faint">No enabled {TYPE_BY_ID.get(s.typeId)?.name} alert yet</span>}
                </div>
              </div>
              {live ? (
                <Badge tone="bad">Running</Badge>
              ) : (
                <Button onClick={() => { simulate(s.id); onClose() }}>
                  <Play size={11} fill="currentColor" /> Run
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

/* ───────────── custom prompt calls ───────────── */

/** Calls with the evaluator's structured output; fields used by the matched rule are highlighted. */
export function CustomCallList({ calls, spec }: { calls: CustomCall[]; spec: CustomSpec | null }) {
  const { now } = useAlerts()
  if (!spec) return null
  if (!calls.length) return <div className="small faint">No matching calls in this period.</div>
  return (
    <div className="stack" style={{ gap: 8 }}>
      {calls.map((c) => {
        const rule = spec.rules.find((r) => r.severity === c.severity && ruleMatches(r, spec, c.output))
        const used = new Set(rule?.groups.flatMap((g) => g.conditions.map((x) => spec.fields.find((f) => f.id === x.fieldId)?.key)) ?? [])
        return (
          <div key={c.callId + c.t} className="cx-call">
            <div className="row wrap" style={{ gap: 8 }}>
              {c.severity && <SeverityBadge severity={c.severity} />}
              <code className="mono" style={{ textTransform: 'none' }}>{c.callId}</code>
              <span className="small faint">{c.agent} · {fmtWhen(c.t, now)}</span>
            </div>
            <div className="cx-out">
              {Object.entries(c.output).map(([k, v]) => (
                <span key={k} className={`cx-kv ${used.has(k) ? 'hit' : ''} ${typeof v === 'string' && v.length > 40 ? 'wide' : ''}`}>
                  <b>{k}</b> {String(v)}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
