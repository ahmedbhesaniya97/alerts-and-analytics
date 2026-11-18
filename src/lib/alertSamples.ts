import { DAY, MIN, applyType, blankAlert, coreOf, type AlertConfig, type Injection, type NotificationTarget, type Op, type Severity, type ThresholdRow } from './alerts'
import { frustrationExample } from './customAlerts'

/** Sample alerts are marked by this id prefix so they can be removed in one go. */
export const SAMPLE_PREFIX = 'sample_'
const HISTORY = 7 * DAY

const row = (severity: Severity, op: Op, value: number, share = ''): ThresholdRow => ({ id: `row_${severity}_${Math.random().toString(36).slice(2, 7)}`, severity, op, value: String(value), share })
const inapp: NotificationTarget = { id: 'ntf_inapp', channel: 'inapp', target: '', severities: ['critical', 'warning', 'info'] }
const slack = (target: string, severities: Severity[] = ['critical', 'warning']): NotificationTarget => ({ id: `ntf_slack_${target}`, channel: 'slack', target, severities })
const email = (target: string, severities: Severity[] = ['critical']): NotificationTarget => ({ id: `ntf_mail_${target}`, channel: 'email', target, severities })

interface Spec {
  id: string
  name: string
  typeId: string
  metricKey?: string
  rows?: ThresholdRow[]
  patch?: Partial<AlertConfig>
  notifications: NotificationTarget[]
}

const SPECS: Spec[] = [
  { id: 'latency', name: 'Slow agent replies', typeId: 'high_latency', rows: [row('critical', 'gt', 5), row('warning', 'gt', 3), row('info', 'gt', 2)], notifications: [inapp, slack('#voice-platform')] },
  { id: 'provider', name: 'Provider API errors', typeId: 'provider_error', rows: [row('critical', 'gt', 20), row('warning', 'gt', 10), row('info', 'gt', 5)], notifications: [inapp, slack('#voice-platform'), email('oncall@acme-dental.com')] },
  { id: 'calls', name: 'Failed calls', typeId: 'call_failed', rows: [row('critical', 'gt', 20), row('warning', 'gt', 10), row('info', 'gt', 5)], notifications: [inapp, slack('#voice-platform')] },
  { id: 'dispatch', name: 'Dispatch delay', typeId: 'dispatch_delay', rows: [row('critical', 'gt', 30), row('warning', 'gt', 15)], notifications: [inapp, slack('#voice-platform')] },
  { id: 'tool', name: 'Booking tool failures', typeId: 'tool_failed', rows: [row('critical', 'gt', 20), row('warning', 'gt', 10)], patch: { filters: { tool: ['book_appointment'] } }, notifications: [inapp, email('priya@acme-dental.com', ['critical', 'warning'])] },
  { id: 'webhook', name: 'CRM webhook failures', typeId: 'summary_post_failed', rows: [row('critical', 'gt', 20), row('warning', 'gt', 10)], notifications: [inapp, email('integrations@acme-dental.com')] },
  { id: 'stt', name: 'Low STT confidence', typeId: 'low_stt_conf', rows: [row('critical', 'lt', 0.6), row('warning', 'lt', 0.75), row('info', 'lt', 0.8)], notifications: [inapp] },
  { id: 'deadair', name: 'Dead air', typeId: 'dead_air', rows: [row('critical', 'gt', 15), row('warning', 'gt', 5)], notifications: [inapp, slack('#voice-quality')] },
  { id: 'notice', name: 'Missing recording notice', typeId: 'greeting_notice', rows: [row('critical', 'gt', 0)], notifications: [inapp, email('compliance@acme-dental.com')] },
  { id: 'quality', name: 'Call quality drop', typeId: 'call_quality', rows: [row('critical', 'lt', 3), row('warning', 'lt', 3.5)], notifications: [inapp, slack('#voice-quality')] },
  { id: 'sentiment', name: 'Negative sentiment', typeId: 'negative_sentiment', rows: [row('critical', 'gt', 25), row('warning', 'gt', 15), row('info', 'gt', 10)], notifications: [inapp, slack('#voice-quality')] },
  { id: 'length', name: 'Very short calls', typeId: 'call_length', rows: [row('warning', 'lt', 20, '75'), row('critical', 'lt', 20, '90')], notifications: [inapp] },
  { id: 'frustration', name: 'Frustrated callers', typeId: 'custom_prompt', patch: { minOccurrences: 10, windowMin: 60 }, notifications: [inapp, slack('#voice-quality', ['critical'])] },
]

/** A realistic starting set of alerts, already running for the past 7 days of simulated calls. */
export function sampleAlerts(now: number): AlertConfig[] {
  const from = now - HISTORY
  return SPECS.map((s, i) => {
    let a = applyType({ ...blankAlert(from - (i + 1) * 3 * MIN), id: `${SAMPLE_PREFIX}${s.id}`, name: s.name }, s.typeId)
    if (s.rows) a = { ...a, rows: s.rows }
    if (s.typeId === 'custom_prompt') a = { ...a, custom: frustrationExample() }
    a = { ...a, ...s.patch, notifications: s.notifications, enabled: true }
    return { ...a, segments: [{ from, to: null, core: coreOf(a) }], updatedAt: from }
  })
}

/** A few faults that are still happening, so the analytics has open events. */
export function sampleInjections(now: number): Injection[] {
  const at = Math.floor(now / MIN) * MIN
  return [
    { id: `${SAMPLE_PREFIX}inj_outage`, scenario: 'LLM provider outage', typeId: 'provider_error', hint: { kind: 'provider', key: 'LLM' }, severity: 'critical', from: at - 18 * MIN, to: at + 45 * MIN, note: '503 Service Unavailable from the LLM provider' },
    { id: `${SAMPLE_PREFIX}inj_latency`, scenario: 'Slow LLM replies', typeId: 'high_latency', hint: { kind: 'agent', key: 'agt_afterhours' }, severity: 'warning', from: at - 40 * MIN, to: at + 30 * MIN, note: 'LLM time-to-first-token jumped to 3.4 s' },
    { id: `${SAMPLE_PREFIX}inj_frustration`, scenario: 'Frustrated callers', typeId: 'custom_prompt', hint: { kind: 'agent', key: 'agt_booker' }, severity: 'critical', from: at - 70 * MIN, to: at + 40 * MIN, note: 'Booking tool outage left callers’ issues unresolved' },
    { id: `${SAMPLE_PREFIX}inj_tool`, scenario: 'Booking tool down', typeId: 'tool_failed', hint: null, severity: 'critical', from: at - 3 * 60 * MIN, to: at - 2 * 60 * MIN, note: 'book_appointment → 500 Internal Server Error' },
  ]
}
