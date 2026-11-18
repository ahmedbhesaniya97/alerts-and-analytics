import { AGENTS, hash, mulberry32 } from './mock'
import { frustrationExample, mockOutput, ruleMatches, validateCustom, type CallOutput, type CustomSpec } from './customAlerts'

/* ════════════════════════════ basics ════════════════════════════ */

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR
export const ME = 'John Doe'

export type Severity = 'critical' | 'warning' | 'info'
export const SEVERITIES: Severity[] = ['critical', 'warning', 'info']
export const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', warning: 'Warning', info: 'Info' }
export const SEV_RANK: Record<Severity, number> = { info: 1, warning: 2, critical: 3 }
export const SEV_COLOR: Record<Severity, string> = { critical: '#c4302b', warning: '#c98a00', info: '#2a78d6' }

export type Op = 'gt' | 'gte' | 'eq' | 'lt' | 'lte'
export const OP_SYMBOL: Record<Op, string> = { gt: '>', gte: '≥', eq: '=', lt: '<', lte: '≤' }
export const OP_LABEL: Record<Op, string> = { gt: 'Greater than', gte: 'Greater than or equal to', eq: 'Equal to', lt: 'Less than', lte: 'Less than or equal to' }
const OP_WORD: Record<Op, string> = { gt: 'exceeds', gte: 'reaches', eq: 'equals', lt: 'drops below', lte: 'drops to' }

export type Unit = 's' | '%' | 'count' | 'x' | '$' | 'conf' | 'score'
export type CategoryId = 'performance' | 'quality' | 'experience' | 'custom'
export type GroupBy = 'none' | 'agent' | 'provider' | 'campaign' | 'error_type'
export type Channel = 'inapp' | 'email' | 'slack' | 'webhook'

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'performance', label: 'Performance' },
  { id: 'quality', label: 'Quality' },
  { id: 'experience', label: 'Experience' },
  { id: 'custom', label: 'Custom' },
]
export const GROUP_LABEL: Record<GroupBy, string> = { none: 'Don’t group', agent: 'Agent', provider: 'Provider', campaign: 'Campaign', error_type: 'Error type' }
export const CHANNEL_LABEL: Record<Channel, string> = { inapp: 'In-app', email: 'Email', slack: 'Slack', webhook: 'Webhook' }

/* ════════════════════════════ catalogue ════════════════════════════ */

type Family = 'rate' | 'latency' | 'cost' | 'avg' | 'ratio' | 'events' | 'length'
/** rate: % of events · count: number of bad events · value: the measured value · money: $ spent · share: % of calls matching a per-call rule */
type Kind = 'rate' | 'count' | 'value' | 'money' | 'share'

export interface MetricDef {
  key: string
  label: string
  unit: Unit
  kind: Kind
  ops: Op[]
  defaults: Partial<Record<Severity, number>>
}
export interface FilterDef {
  key: string
  label: string
  options: string[]
  /** 'volume' narrows which events are counted; 'rate' narrows which failures count. */
  affects: 'volume' | 'rate'
  weights?: number[]
}
interface Sim {
  family: Family
  base: number
  noise: number
  /** Chance of an episode per 4-hour block, per group. */
  p: number
  /** Raw signal level that crosses Info, Warning, Critical. */
  levels: [number, number, number]
  /** Events per call (turns, provider requests, tool calls…). */
  perCall: number
}
export interface AlertType {
  id: string
  category: CategoryId
  name: string
  description: string
  metrics: MetricDef[]
  filters: FilterDef[]
  windows: number[]
  defaultWindow: number
  occurrences: number[]
  defaultOccurrences: number
  occurrenceNoun: string
  minLabel?: string
  defaultRows: Severity[]
  groupOptions: GroupBy[]
  defaultGroup: GroupBy
  note?: string
  /** Per-call rule, e.g. “call length is < 20 seconds in more than 75% of calls”. */
  perCall?: { label: string; unit: string; ops: Op[]; value: number; share: Partial<Record<Severity, number>> }
  latency?: boolean
  sim: Sim
}

const rateMetrics = (rateLabel: string, countLabel: string, rate: [number, number, number], count: [number, number, number], rateOps: Op[] = ['gt'], countOps: Op[] = ['gt']): MetricDef[] => [
  { key: 'rate', label: rateLabel, unit: '%', kind: 'rate', ops: rateOps, defaults: { info: rate[0], warning: rate[1], critical: rate[2] } },
  { key: 'count', label: countLabel, unit: 'count', kind: 'count', ops: countOps, defaults: { info: count[0], warning: count[1], critical: count[2] } },
]
/** New alerts start with one threshold; people add Critical or Info themselves. */
const ONE: Severity[] = ['warning']

export const PROVIDERS = ['LLM', 'STT', 'TTS', 'Telephony']
export const CAMPAIGNS = ['Spring recall', 'New patients', 'Appointment reminders']
export const ERROR_TYPES = ['4xx', '5xx', 'Timeout', 'Rate limit']

export const ALERT_TYPES: AlertType[] = [
  /* ───── Performance ───── */
  {
    id: 'high_latency', category: 'performance', name: 'High latency', description: 'The agent takes too long to respond',
    metrics: [{ key: 'p95', label: 'P95 latency', unit: 's', kind: 'value', ops: ['gt', 'gte'], defaults: { info: 2, warning: 3, critical: 5 } }],
    filters: [], windows: [1, 5, 10, 15], defaultWindow: 5, occurrences: [1, 3, 5, 10], defaultOccurrences: 3, occurrenceNoun: 'slow responses',
    defaultRows: ONE, groupOptions: ['none', 'agent', 'campaign'], defaultGroup: 'agent', latency: true,
    sim: { family: 'latency', base: 1.45, noise: 0.18, p: 0.12, levels: [2.4, 3.6, 5.8], perCall: 8 },
  },
  {
    id: 'provider_error', category: 'performance', name: 'Provider API error', description: 'Errors from LLM, STT, TTS and telephony providers',
    metrics: rateMetrics('API error rate', 'API error count', [5, 10, 20], [10, 25, 50], ['gt', 'gte'], ['gt', 'eq']),
    filters: [
      { key: 'provider', label: 'Provider', options: PROVIDERS, affects: 'volume', weights: [0.35, 0.3, 0.25, 0.1] },
      { key: 'error_type', label: 'Error type', options: ERROR_TYPES, affects: 'rate', weights: [0.3, 0.35, 0.25, 0.1] },
    ],
    windows: [1, 5, 10, 15], defaultWindow: 5, occurrences: [3, 5, 10], defaultOccurrences: 3, occurrenceNoun: 'errors',
    defaultRows: ONE, groupOptions: ['none', 'agent', 'provider', 'error_type'], defaultGroup: 'provider',
    sim: { family: 'rate', base: 0.8, noise: 0.5, p: 0.08, levels: [7, 14, 26], perCall: 12 },
  },
  {
    id: 'call_failed', category: 'performance', name: 'Call failed', description: 'Inbound or outbound calls fail to connect or start',
    metrics: rateMetrics('Call failure rate', 'Failed call count', [5, 10, 20], [3, 5, 10]),
    filters: [{ key: 'reason', label: 'Failure reason', options: ['No answer', 'Busy', 'Dispatch failed', 'Agent never joined', 'Crashed'], affects: 'rate', weights: [0.3, 0.15, 0.2, 0.2, 0.15] }],
    windows: [5, 10, 15, 30], defaultWindow: 15, occurrences: [1, 3, 5], defaultOccurrences: 3, occurrenceNoun: 'failed calls',
    defaultRows: ONE, groupOptions: ['none', 'agent', 'campaign'], defaultGroup: 'agent',
    sim: { family: 'rate', base: 1, noise: 0.6, p: 0.05, levels: [7, 14, 26], perCall: 1 },
  },
  {
    id: 'dispatch_delay', category: 'performance', name: 'Dispatch delay', description: 'Delay between a call being scheduled and dispatched',
    metrics: [{ key: 'latency', label: 'Dispatch latency', unit: 's', kind: 'value', ops: ['gt'], defaults: { info: 5, warning: 15, critical: 30 } }],
    filters: [], windows: [1, 5, 10], defaultWindow: 5, occurrences: [3, 5, 10], defaultOccurrences: 3, occurrenceNoun: 'delayed dispatches',
    defaultRows: ONE, groupOptions: ['none', 'agent', 'campaign'], defaultGroup: 'agent',
    sim: { family: 'latency', base: 1.8, noise: 0.5, p: 0.05, levels: [8, 20, 38], perCall: 1 },
  },
  {
    id: 'tool_failed', category: 'performance', name: 'Tool call failed', description: 'The agent fails to run a configured tool or action',
    metrics: rateMetrics('Tool failure rate', 'Tool failure count', [5, 10, 20], [5, 10, 20]),
    filters: [{ key: 'tool', label: 'Tool', options: ['book_appointment', 'check_availability', 'transfer_call', 'send_sms'], affects: 'volume', weights: [0.35, 0.35, 0.15, 0.15] }],
    windows: [5, 10, 15], defaultWindow: 10, occurrences: [3, 5, 10], defaultOccurrences: 3, occurrenceNoun: 'failed tool calls',
    defaultRows: ONE, groupOptions: ['none', 'agent', 'campaign'], defaultGroup: 'agent',
    sim: { family: 'rate', base: 1.2, noise: 0.7, p: 0.06, levels: [7, 14, 26], perCall: 1.2 },
  },
  {
    id: 'summary_failed', category: 'performance', name: 'Summary generation failed', description: 'Post-call summaries fail or come back empty',
    metrics: rateMetrics('Summary failure rate', 'Failed summary count', [5, 10, 20], [3, 5, 10]),
    filters: [], windows: [5, 15, 30], defaultWindow: 15, occurrences: [3, 5, 10], defaultOccurrences: 3, occurrenceNoun: 'failed summaries',
    defaultRows: ONE, groupOptions: ['none', 'agent', 'campaign'], defaultGroup: 'none',
    sim: { family: 'rate', base: 0.6, noise: 0.4, p: 0.04, levels: [7, 14, 26], perCall: 1 },
  },
  {
    id: 'summary_post_failed', category: 'performance', name: 'Summary post failed', description: 'Summaries can’t be delivered to your integrations',
    metrics: rateMetrics('Summary delivery failure rate', 'Failed post count', [5, 10, 20], [3, 5, 10]),
    filters: [{ key: 'destination', label: 'Destination', options: ['CRM webhook', 'Slack', 'Email'], affects: 'volume', weights: [0.6, 0.25, 0.15] }],
    windows: [5, 15, 30], defaultWindow: 15, occurrences: [3, 5, 10], defaultOccurrences: 3, occurrenceNoun: 'failed posts',
    defaultRows: ONE, groupOptions: ['none', 'agent', 'campaign'], defaultGroup: 'none',
    sim: { family: 'rate', base: 0.8, noise: 0.5, p: 0.05, levels: [7, 14, 26], perCall: 1 },
  },
  /* ───── Quality ───── */
  {
    id: 'low_stt_conf', category: 'quality', name: 'Low STT confidence', description: 'Speech-to-text is unsure what callers said',
    metrics: [{ key: 'avg', label: 'Avg STT confidence', unit: 'conf', kind: 'value', ops: ['lt', 'lte'], defaults: { info: 0.8, warning: 0.75, critical: 0.6 } }],
    filters: [], windows: [15, 30, 60], defaultWindow: 60, occurrences: [5, 10, 20], defaultOccurrences: 10, occurrenceNoun: 'calls', minLabel: 'Minimum calls',
    defaultRows: ONE, groupOptions: ['none', 'agent'], defaultGroup: 'agent',
    sim: { family: 'avg', base: 0.9, noise: 0.012, p: 0.05, levels: [0.78, 0.7, 0.55], perCall: 1 },
  },
  {
    id: 'no_user_transcript', category: 'quality', name: 'No user transcript', description: 'Caller audio isn’t reaching the agent',
    metrics: rateMetrics('Calls with no caller words', 'Calls with no caller words', [3, 5, 15], [2, 5, 10]),
    filters: [], windows: [5, 15, 30], defaultWindow: 15, occurrences: [1, 3, 5], defaultOccurrences: 3, occurrenceNoun: 'calls without caller words',
    defaultRows: ONE, groupOptions: ['none', 'agent'], defaultGroup: 'agent',
    sim: { family: 'rate', base: 0.8, noise: 0.4, p: 0.04, levels: [4, 8, 20], perCall: 1 },
  },
  {
    id: 'dead_air', category: 'quality', name: 'Dead air', description: 'The agent goes silent for over 5 seconds',
    metrics: rateMetrics('Calls with dead air', 'Calls with dead air', [3, 5, 15], [3, 5, 10]),
    filters: [], windows: [15, 30, 60], defaultWindow: 15, occurrences: [3, 5, 10], defaultOccurrences: 3, occurrenceNoun: 'calls with dead air',
    defaultRows: ONE, groupOptions: ['none', 'agent'], defaultGroup: 'agent',
    sim: { family: 'rate', base: 1.5, noise: 0.7, p: 0.06, levels: [4, 9, 20], perCall: 1 },
  },
  {
    id: 'interruptions', category: 'quality', name: 'High interruption rate', description: 'Caller and agent talk over each other',
    metrics: [{ key: 'ratio', label: 'Interruptions vs 7-day average', unit: 'x', kind: 'value', ops: ['gt'], defaults: { info: 1.3, warning: 1.5, critical: 2 } }],
    filters: [], windows: [30, 60], defaultWindow: 60, occurrences: [5, 10, 20], defaultOccurrences: 10, occurrenceNoun: 'calls', minLabel: 'Minimum calls',
    defaultRows: ONE, groupOptions: ['none', 'agent'], defaultGroup: 'agent',
    sim: { family: 'ratio', base: 1, noise: 0.05, p: 0.05, levels: [1.4, 1.7, 2.3], perCall: 1 },
  },
  {
    id: 'greeting_notice', category: 'quality', name: 'Recording notice missing', description: 'The opening line or recording notice wasn’t spoken',
    metrics: [{ key: 'count', label: 'Calls missing the notice', unit: 'count', kind: 'count', ops: ['gt', 'gte'], defaults: { critical: 0, warning: 0, info: 0 } }],
    filters: [], windows: [5, 15, 60], defaultWindow: 5, occurrences: [1], defaultOccurrences: 1, occurrenceNoun: 'calls missing the notice',
    defaultRows: ['critical'], groupOptions: ['none', 'agent'], defaultGroup: 'agent',
    sim: { family: 'events', base: 0, noise: 0, p: 0.05, levels: [1, 1, 1], perCall: 1 },
  },
  {
    id: 'call_quality', category: 'quality', name: 'Call quality eval', description: 'An LLM scores task completion, accuracy and flow',
    metrics: [{ key: 'score', label: 'Avg call quality score', unit: 'score', kind: 'value', ops: ['lt', 'lte'], defaults: { info: 3.8, warning: 3.5, critical: 3 } }],
    filters: [], windows: [30, 60], defaultWindow: 60, occurrences: [10, 20, 50], defaultOccurrences: 20, occurrenceNoun: 'evaluated calls', minLabel: 'Minimum evaluated calls',
    defaultRows: ONE, groupOptions: ['none', 'agent'], defaultGroup: 'agent',
    sim: { family: 'avg', base: 4.2, noise: 0.08, p: 0.05, levels: [3.7, 3.3, 2.7], perCall: 1 },
  },
  /* ───── Experience ───── */
  {
    id: 'low_engagement', category: 'experience', name: 'Low engagement', description: 'Calls where the contact mostly gives very short answers',
    metrics: [{ key: 'ratio', label: 'Caller turns vs 7-day average', unit: 'x', kind: 'value', ops: ['lt'], defaults: { info: 0.8, warning: 0.7, critical: 0.5 } }],
    filters: [], windows: [30, 60], defaultWindow: 60, occurrences: [5, 10, 20], defaultOccurrences: 10, occurrenceNoun: 'calls', minLabel: 'Minimum calls',
    defaultRows: ONE, groupOptions: ['none', 'agent'], defaultGroup: 'agent',
    sim: { family: 'ratio', base: 1, noise: 0.04, p: 0.05, levels: [0.76, 0.64, 0.42], perCall: 1 },
  },
  {
    id: 'negative_sentiment', category: 'experience', name: 'Negative sentiment', description: 'Calls where the contact expresses frustration, confusion, or dissatisfaction',
    metrics: rateMetrics('Calls with negative sentiment', 'Negative calls', [10, 15, 25], [5, 10, 20]),
    filters: [], windows: [15, 30, 60], defaultWindow: 60, occurrences: [3, 5, 10], defaultOccurrences: 5, occurrenceNoun: 'negative calls',
    defaultRows: ONE, groupOptions: ['none', 'agent', 'campaign'], defaultGroup: 'agent',
    sim: { family: 'rate', base: 5, noise: 1.6, p: 0.06, levels: [12, 18, 30], perCall: 1 },
  },
  {
    id: 'call_length', category: 'experience', name: 'Call length', description: 'Calls end too early or run too long',
    metrics: [{ key: 'share', label: 'call length', unit: '%', kind: 'share', ops: ['lt', 'gt'], defaults: {} }],
    perCall: { label: 'call length', unit: 'seconds', ops: ['lt', 'gt'], value: 20, share: { warning: 75, critical: 90, info: 50 } },
    filters: [], windows: [15, 30, 60], defaultWindow: 60, occurrences: [5, 10, 20], defaultOccurrences: 20, occurrenceNoun: 'calls', minLabel: 'Minimum calls',
    defaultRows: ['warning'], groupOptions: ['none', 'agent', 'campaign'], defaultGroup: 'none',
    sim: { family: 'length', base: 95, noise: 6, p: 0.05, levels: [17, 13, 9], perCall: 1 },
  },
  /* ───── Custom ───── */
  {
    id: 'custom_prompt', category: 'custom', name: 'Custom', description: 'Define structured output fields and alert on them',
    metrics: [{ key: 'matches', label: 'Matching calls', unit: 'count', kind: 'count', ops: ['gte'], defaults: {} }],
    filters: [], windows: [15, 30, 60], defaultWindow: 60, occurrences: [1, 3, 5, 10, 20], defaultOccurrences: 1, occurrenceNoun: 'matching calls', minLabel: 'Minimum matching calls',
    defaultRows: [], groupOptions: ['none', 'agent'], defaultGroup: 'agent',
    sim: { family: 'rate', base: 0, noise: 0, p: 0.06, levels: [0.3, 0.45, 0.65], perCall: 1 },
  },
]
export const TYPE_BY_ID = new Map(ALERT_TYPES.map((t) => [t.id, t]))

/* ════════════════════════════ config ════════════════════════════ */

export interface ThresholdRow {
  id: string
  severity: Severity
  op: Op
  value: string
  /** Only for per-call rules: “in more than X % of calls”. */
  share: string
}
export interface NotificationTarget {
  id: string
  channel: Channel
  target: string
  severities: Severity[]
}
/** Everything that decides when an alert fires. Snapshotted on every save so history isn't rewritten. */
export interface AlertCore {
  typeId: string
  metricKey: string
  agentIds: string[]
  filters: Record<string, string[]>
  rows: ThresholdRow[]
  latencyUnit: 's' | 'ms'
  windowMin: number
  minOccurrences: number
  cooldownMin: number
  autoResolve: boolean
  recoveryNotify: boolean
  groupBy: GroupBy
  /** Custom alerts: structured output fields and severity rules built on them. */
  custom: CustomSpec | null
}
export interface AlertConfig extends AlertCore {
  id: string
  name: string
  enabled: boolean
  notifications: NotificationTarget[]
  segments: { from: number; to: number | null; core: AlertCore }[]
  createdAt: number
  updatedAt: number
}

export const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`

export function coreOf(a: AlertCore): AlertCore {
  return {
    typeId: a.typeId, metricKey: a.metricKey, agentIds: a.agentIds, filters: a.filters, rows: a.rows, latencyUnit: a.latencyUnit, windowMin: a.windowMin,
    minOccurrences: a.minOccurrences, cooldownMin: a.cooldownMin, autoResolve: a.autoResolve, recoveryNotify: a.recoveryNotify, groupBy: a.groupBy, custom: a.custom ?? null,
  }
}

export function defaultRow(type: AlertType, metric: MetricDef, severity: Severity): ThresholdRow {
  if (type.perCall) return { id: rid('row'), severity, op: type.perCall.ops[0], value: String(type.perCall.value), share: String(type.perCall.share[severity] ?? 75) }
  return { id: rid('row'), severity, op: metric.ops[0], value: String(metric.defaults[severity] ?? ''), share: '' }
}

/** Switch the draft to another alert type and fill in that type's suggested defaults. */
export function applyType(draft: AlertConfig, typeId: string): AlertConfig {
  const type = TYPE_BY_ID.get(typeId)!
  const metric = type.metrics[0]
  return {
    ...draft,
    typeId,
    metricKey: metric.key,
    filters: {},
    rows: type.defaultRows.map((s) => defaultRow(type, metric, s)),
    latencyUnit: 's',
    windowMin: type.defaultWindow,
    minOccurrences: type.defaultOccurrences,
    groupBy: type.defaultGroup,
    custom: typeId === 'custom_prompt' ? frustrationExample() : null,
  }
}
export function applyMetric(draft: AlertConfig, metricKey: string): AlertConfig {
  const type = TYPE_BY_ID.get(draft.typeId)!
  const metric = type.metrics.find((m) => m.key === metricKey)!
  return { ...draft, metricKey, rows: draft.rows.map((r) => ({ ...defaultRow(type, metric, r.severity), id: r.id })) }
}

export function blankAlert(now: number): AlertConfig {
  return {
    id: rid('alr'),
    name: '',
    typeId: '',
    metricKey: '',
    agentIds: [],
    filters: {},
    rows: [],
    latencyUnit: 's',
    windowMin: 5,
    minOccurrences: 3,
    cooldownMin: 15,
    autoResolve: true,
    recoveryNotify: true,
    groupBy: 'agent',
    custom: null,
    enabled: true,
    notifications: [{ id: rid('ntf'), channel: 'inapp', target: '', severities: ['critical', 'warning', 'info'] }],
    segments: [],
    createdAt: now,
    updatedAt: now,
  }
}

/* ════════════════════════════ formatting ════════════════════════════ */

export function metricOf(a: Pick<AlertCore, 'typeId' | 'metricKey'>): { type: AlertType; metric: MetricDef } | null {
  const type = TYPE_BY_ID.get(a.typeId)
  const metric = type?.metrics.find((m) => m.key === a.metricKey)
  return type && metric ? { type, metric } : null
}
export function unitLabel(unit: Unit, latencyUnit: 's' | 'ms'): string {
  return { s: latencyUnit === 'ms' ? 'ms' : 'seconds', '%': '%', count: '', x: '× average', $: 'USD', conf: '', score: 'out of 5' }[unit]
}
export function fmtVal(v: number | null | undefined, unit: Unit, latencyUnit: 's' | 'ms' = 's'): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  switch (unit) {
    case 's':
      return latencyUnit === 'ms' ? `${Math.round(v * 1000).toLocaleString()} ms` : `${v.toFixed(1)} s`
    case '%':
      return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`
    case 'count':
      return Math.round(v).toLocaleString()
    case 'x':
      return `${v.toFixed(1)}×`
    case '$':
      return `$${v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString()}`
    case 'conf':
      return v.toFixed(2)
    case 'score':
      return `${v.toFixed(1)} / 5`
  }
}
/** Threshold as typed by the user, in their unit. */
export function fmtRowValue(row: ThresholdRow, unit: Unit, latencyUnit: 's' | 'ms'): string {
  const n = Number(row.value)
  if (row.value.trim() === '' || Number.isNaN(n)) return '…'
  if (unit === 's') return latencyUnit === 'ms' ? `${n.toLocaleString()} ms` : `${n} s`
  if (unit === '%') return `${n}%`
  if (unit === '$') return `$${n}`
  if (unit === 'x') return `${n}×`
  return String(n)
}
export function fmtWindow(min: number): string {
  return min >= 60 ? `${min / 60} hour${min > 60 ? 's' : ''}` : `${min} minute${min === 1 ? '' : 's'}`
}
export function fmtAgo(ts: number, now: number): string {
  const m = Math.round((now - ts) / MIN)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}
export function fmtSpan(ms: number): string {
  const m = Math.max(1, Math.round(ms / MIN))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`
}
const tFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const dtFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
export const fmtWhen = (ts: number, now: number) => (now - ts < 20 * HOUR && new Date(ts).getDate() === new Date(now).getDate() ? `Today ${tFmt.format(ts)}` : dtFmt.format(ts))

/** Short rule text, e.g. “> 3 s”. */
export function rowShort(a: AlertCore, row: ThresholdRow): string {
  const m = metricOf(a)
  if (!m) return ''
  if (m.type.perCall) return `${OP_SYMBOL[row.op]} ${row.value} s in > ${row.share}% of calls`
  return `${OP_SYMBOL[row.op]} ${fmtRowValue(row, m.metric.unit, a.latencyUnit)}`
}

/** Plain-English condition preview for one threshold row. */
export function rowSentence(a: AlertCore, row: ThresholdRow): string {
  const m = metricOf(a)
  if (!m) return ''
  const { type, metric } = m
  const win = `during the last ${fmtWindow(a.windowMin)}`
  const occ = a.minOccurrences > 1 ? `, once at least ${a.minOccurrences} ${type.occurrenceNoun} are detected` : ''
  if (type.perCall) {
    return `If more than ${row.share || '…'}% of calls have a ${type.perCall.label} ${row.op === 'lt' ? 'under' : 'over'} ${row.value || '…'} ${type.perCall.unit} ${win}, trigger ${row.severity === 'info' ? 'an' : 'a'} ${SEV_LABEL[row.severity]} alert${a.minOccurrences > 1 ? ` (needs at least ${a.minOccurrences} calls)` : ''}.`
  }
  return `If ${metric.label} ${OP_WORD[row.op]} ${fmtRowValue(row, metric.unit, a.latencyUnit)} ${win}, trigger ${row.severity === 'info' ? 'an' : 'a'} ${SEV_LABEL[row.severity]} alert${occ}.`
}

/* ════════════════════════════ validation ════════════════════════════ */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function validateAlert(a: AlertConfig, all: AlertConfig[]): Record<string, string> {
  const e: Record<string, string> = {}
  const name = a.name.trim()
  if (!name) e.name = 'Give the alert a name.'
  else if (name.length > 80) e.name = 'Keep the name under 80 characters.'
  else if (all.some((x) => x.id !== a.id && x.name.trim().toLowerCase() === name.toLowerCase())) e.name = 'Another alert already has this name.'
  const m = metricOf(a)
  if (!m) {
    e.type = 'Choose what this alert watches.'
    return e
  }
  const { type, metric } = m
  if (type.id === 'custom_prompt') {
    Object.assign(e, validateCustom(a.custom))
    notificationErrors(a, e)
    return e
  }
  if (!a.rows.length) e.rows = 'Add at least one threshold.'
  const seen = new Set<Severity>()
  for (const r of a.rows) {
    if (seen.has(r.severity)) e[`row_${r.id}`] = `There’s already a ${SEV_LABEL[r.severity]} threshold.`
    seen.add(r.severity)
    const n = Number(r.value)
    if (r.value.trim() === '' || Number.isNaN(n)) e[`row_${r.id}`] ??= 'Enter a number.'
    else if (n < 0) e[`row_${r.id}`] ??= 'Can’t be negative.'
    else if (metric.unit === '%' && !type.perCall && n > 100) e[`row_${r.id}`] ??= 'A percentage can’t be over 100.'
    else if (metric.unit === 'conf' && n > 1) e[`row_${r.id}`] ??= 'Confidence runs from 0 to 1.'
    else if (metric.unit === 'score' && (n < 1 || n > 5)) e[`row_${r.id}`] ??= 'Scores run from 1 to 5.'
    if (type.perCall) {
      const s = Number(r.share)
      if (r.share.trim() === '' || Number.isNaN(s) || s <= 0 || s > 100) e[`row_${r.id}`] ??= 'Share of calls must be between 1 and 100.'
    }
  }
  // Stricter severities must sit further out than milder ones.
  if (!type.perCall && Object.keys(e).every((k) => !k.startsWith('row_'))) {
    const sorted = [...a.rows].sort((x, y) => SEV_RANK[y.severity] - SEV_RANK[x.severity])
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const hi = sorted[i]
      const lo = sorted[i + 1]
      const up = hi.op !== 'lt' && hi.op !== 'lte'
      if (up === (lo.op !== 'lt' && lo.op !== 'lte') && hi.op !== 'eq' && lo.op !== 'eq') {
        const bad = up ? Number(hi.value) <= Number(lo.value) : Number(hi.value) >= Number(lo.value)
        if (bad) e[`row_${hi.id}`] = `${SEV_LABEL[hi.severity]} should be ${up ? 'higher' : 'lower'} than ${SEV_LABEL[lo.severity]}.`
      }
    }
  }
  notificationErrors(a, e)
  return e
}
function notificationErrors(a: AlertConfig, e: Record<string, string>) {
  a.notifications.forEach((n) => {
    const t = n.target.trim()
    if (n.channel === 'email' && !EMAIL.test(t)) e[`ntf_${n.id}`] = 'Enter a valid email address.'
    if (n.channel === 'slack' && !/^#[\w-]{2,}$/.test(t)) e[`ntf_${n.id}`] = 'Enter a Slack channel, like #voice-alerts.'
    if (n.channel === 'webhook' && !/^https:\/\/\S+\.\S+/.test(t)) e[`ntf_${n.id}`] = 'Enter an https:// URL.'
    if (!n.severities.length) e[`ntf_${n.id}`] ??= 'Pick at least one severity.'
  })
}

/* ════════════════════════════ mock signal ════════════════════════════ */

export interface Injection {
  id: string
  scenario: string
  typeId: string
  hint: { kind: 'agent' | 'provider'; key: string } | null
  severity: Severity
  from: number
  to: number
  note: string
}

const TZ_OFFSET = new Date().getTimezoneOffset() * MIN
/** Local hour of day without allocating a Date (ignores DST changes inside the window). */
/** Demo knob: how often simulated signals go bad (1 = catalogue rates). */
const EPISODE_RATE = 2.2

const hourOf = (t: number) => Math.floor((t - TZ_OFFSET) / HOUR) % 24

function agentVolumePerHour(id: string, hour: number): number {
  const day = hour >= 8 && hour < 19
  if (id === 'agt_booker') return day ? 160 : hour >= 19 && hour < 22 ? 50 : 24
  if (id === 'agt_afterhours') return day ? 24 : 60
  if (id === 'agt_reminder') return hour >= 9 && hour < 18 ? 90 : 0
  return 30
}

interface Group {
  key: string
  label: string
  agentIds: string[]
  volShare: number
  rateShare: number
  hintKind: 'agent' | 'provider' | null
}
export function groupsFor(a: AlertCore): Group[] {
  const type = TYPE_BY_ID.get(a.typeId)!
  const agents = a.agentIds.length ? AGENTS.filter((x) => a.agentIds.includes(x.id)) : AGENTS
  const ids = agents.map((x) => x.id)
  const filterOpts = (key: string, all: string[]) => (a.filters[key]?.length ? a.filters[key] : all)
  switch (a.groupBy) {
    case 'agent':
      return agents.map((x) => ({ key: x.id, label: x.name, agentIds: [x.id], volShare: 1, rateShare: 1, hintKind: 'agent' }))
    case 'provider': {
      const f = type.filters.find((x) => x.key === 'provider')
      const opts = f ? filterOpts('provider', PROVIDERS) : PROVIDERS
      const w = [0.35, 0.3, 0.25, 0.1]
      return opts.map((p) => ({ key: p, label: p, agentIds: ids, volShare: w[PROVIDERS.indexOf(p)] ?? 0.25, rateShare: 1, hintKind: 'provider' }))
    }
    case 'campaign':
      return CAMPAIGNS.map((c, i) => ({ key: c, label: c, agentIds: ids, volShare: [0.4, 0.35, 0.25][i], rateShare: 1, hintKind: null }))
    case 'error_type': {
      const opts = filterOpts('error_type', ERROR_TYPES)
      const w = [0.3, 0.35, 0.25, 0.1]
      return opts.map((t) => ({ key: t, label: t, agentIds: ids, volShare: 1, rateShare: w[ERROR_TYPES.indexOf(t)], hintKind: null }))
    }
    default:
      return [{ key: 'all', label: agents.length === AGENTS.length ? 'All agents' : agents.map((x) => x.name).join(', '), agentIds: ids, volShare: 1, rateShare: 1, hintKind: null }]
  }
}

function filterWeights(a: AlertCore, type: AlertType): { vol: number; rate: number } {
  let vol = 1
  let rate = 1
  for (const f of type.filters) {
    const sel = a.filters[f.key]
    if (!sel?.length) continue
    if (a.groupBy === 'provider' && f.key === 'provider') continue
    if (a.groupBy === 'error_type' && f.key === 'error_type') continue
    const w = sel.reduce((s, o) => s + (f.weights?.[f.options.indexOf(o)] ?? 1 / f.options.length), 0)
    if (f.affects === 'volume') vol *= w
    else rate *= w
  }
  return { vol, rate }
}

/** Raw per-minute signal for one group: [value, events] arrays covering minutes m0..m1. */
function rawSeries(a: AlertCore, group: Group, m0: number, m1: number, injections: Injection[]): { raw: Float64Array; vol: Float64Array } {
  const type = TYPE_BY_ID.get(a.typeId)!
  const sim = type.sim
  const seed = hash(`${type.id}|${group.key}|${group.agentIds.join(',')}`)
  const fw = filterWeights(a, type)
  const n = m1 - m0 + 1
  const raw = new Float64Array(n)
  const vol = new Float64Array(n)
  const episodes = new Map<number, { start: number; end: number; level: number } | null>()
  const episode = (blk: number) => {
    if (!episodes.has(blk)) {
      const r = mulberry32((seed ^ Math.imul(blk, 2654435761)) >>> 0)
      if (r() < sim.p * EPISODE_RATE) {
        const start = blk * 240 + Math.floor(r() * 200)
        const end = start + 8 + Math.floor(r() * 40)
        const roll = r()
        const lv = roll < 0.5 ? 0 : roll < 0.8 ? 1 : 2
        const level = sim.levels[lv] * (0.95 + r() * 0.25)
        episodes.set(blk, { start, end, level })
      } else episodes.set(blk, null)
    }
    return episodes.get(blk)!
  }
  const relInj = injections.filter((inj) => {
    if (inj.typeId !== type.id) return false
    if (!inj.hint) return true
    if (inj.hint.kind === group.hintKind) return inj.hint.key === group.key
    if (inj.hint.kind === 'agent') return group.agentIds.includes(inj.hint.key)
    const pf = a.filters.provider
    return !pf?.length || pf.includes(inj.hint.key)
  })
  for (let i = 0; i < n; i += 1) {
    const m = m0 + i
    const t = m * MIN
    const hour = hourOf(t)
    const calls = group.agentIds.reduce((s, id) => s + agentVolumePerHour(id, hour), 0) / 60
    vol[i] = calls * sim.perCall * group.volShare * fw.vol
    const r = mulberry32((seed ^ Math.imul(m, 1597334677)) >>> 0)
    let v: number
    if (sim.family === 'events') {
      v = 0
      const blk = Math.floor(m / 240)
      const er = mulberry32((seed ^ Math.imul(blk, 374761393)) >>> 0)
      if (er() < sim.p * EPISODE_RATE && m === blk * 240 + Math.floor(er() * 240) && calls > 0) v = 1
    } else {
      const ep = episode(Math.floor(m / 240)) ?? null
      const prev = episode(Math.floor(m / 240) - 1)
      const hit = (e: typeof ep) => e && m >= e.start && m < e.end
      const e = hit(ep) ? ep : hit(prev) ? prev : null
      v = e ? e.level + (r() - 0.5) * sim.noise : sim.base + (r() + r() + r() - 1.5) * sim.noise * 1.3
    }
    for (const inj of relInj) {
      if (t >= inj.from && t < inj.to) {
        const lv = sim.levels[inj.severity === 'critical' ? 2 : inj.severity === 'warning' ? 1 : 0]
        v = sim.family === 'events' ? (m === Math.floor(inj.from / MIN) ? 1 : v) : lv * (sim.family === 'avg' || sim.family === 'length' ? 0.97 : 1.1)
      }
    }
    if (sim.family === 'rate') v = Math.max(0, Math.min(100, v)) * group.rateShare * fw.rate
    else v = Math.max(0, v)
    raw[i] = v
  }
  return { raw, vol }
}

const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2))

function compare(v: number, op: Op, th: number): boolean {
  switch (op) {
    case 'gt':
      return v > th
    case 'gte':
      return v >= th
    case 'eq':
      return Math.round(v) === th
    case 'lt':
      return v < th
    case 'lte':
      return v <= th
  }
}

/* ════════════════════════════ evaluation ════════════════════════════ */

export interface EvalPoint {
  t: number
  v: number | null
  sev: Severity | null
}
export interface Incident {
  id: string
  alertId: string
  segment: number
  groupKey: string
  groupLabel: string
  severity: Severity
  startedAt: number
  endedAt: number | null
  resolvedBy: 'auto' | 'manual' | null
  peak: number
  escalations: { t: number; severity: Severity }[]
}
export interface GroupEval {
  key: string
  label: string
  points: EvalPoint[]
  incidents: Incident[]
}

/**
 * Evaluates an alert minute by minute between `from` and `to`.
 * Each minute looks back over the window, checks every threshold row (with its minimum
 * occurrences), opens an incident at the highest matching severity, escalates it, and
 * closes it automatically when the condition clears.
 * After an incident closes, the same group can't fire again until the cooldown has passed.
 */
export function evaluate(a: AlertCore, alertId: string, segment: number, from: number, to: number, injections: Injection[]): GroupEval[] {
  const m = metricOf(a)
  if (!m) return []
  const { type, metric } = m
  if (type.id === 'custom_prompt') return evaluateCustom(a, alertId, segment, from, to, injections)
  const rows = a.rows
    .map((r) => ({ ...r, n: Number(r.value) * (metric.unit === 's' && a.latencyUnit === 'ms' ? 0.001 : 1), s: Number(r.share) }))
    .filter((r) => !Number.isNaN(r.n))
    .sort((x, y) => SEV_RANK[y.severity] - SEV_RANK[x.severity])
  const w = a.windowMin
  const mFrom = Math.floor(from / MIN)
  const mTo = Math.floor(to / MIN) - 1
  if (mTo < mFrom) return groupsFor(a).map((g) => ({ key: g.key, label: g.label, points: [], incidents: [] }))
  const down = metric.ops[0] === 'lt' || metric.ops[0] === 'lte'
  return groupsFor(a).map((g) => {
    const { raw, vol } = rawSeries(a, g, mFrom - w + 1, mTo, injections)
    // Running sums so each minute's window costs O(1) instead of O(window).
    const n = raw.length
    const cVol = new Float64Array(n + 1)
    const cW = new Float64Array(n + 1)
    const cBad = new Float64Array(n + 1)
    for (let j = 0; j < n; j += 1) {
      cVol[j + 1] = cVol[j] + vol[j]
      cW[j + 1] = cW[j] + raw[j] * vol[j]
      cBad[j + 1] = cBad[j] + (type.sim.family === 'rate' ? (raw[j] / 100) * vol[j] : type.sim.family === 'events' ? raw[j] : 0)
    }
    // Per-call share rules: share of calls matching each row, per minute, as running sums too.
    const cShare = metric.kind === 'share'
      ? rows.map((r) => {
          const c = new Float64Array(n + 1)
          const ln = Math.log(r.n)
          for (let j = 0; j < n; j += 1) {
            const z = (ln - Math.log(Math.max(1, raw[j]))) / 0.6
            c[j + 1] = c[j] + (r.op === 'lt' || r.op === 'lte' ? phi(z) : 1 - phi(z)) * vol[j]
          }
          return c
        })
      : []
    const points: EvalPoint[] = []
    for (let i = 0; i <= mTo - mFrom; i += 1) {
      const t = (mFrom + i + 1) * MIN
      const calls = cVol[i + w] - cVol[i]
      const weighted = cW[i + w] - cW[i]
      const bad = cBad[i + w] - cBad[i]
      let v: number | null = null
      if (calls > 0.05) {
        switch (metric.kind) {
          case 'rate':
            v = weighted / calls
            break
          case 'count':
            v = bad
            break
          case 'money':
            v = weighted / type.sim.perCall
            break
          case 'value':
            v = type.sim.family === 'cost' ? weighted / calls / type.sim.base : weighted / calls
            break
          case 'share':
            v = null // computed per row below
            break
        }
      } else if (type.sim.family === 'events') v = 0
      // Which severity matches right now?
      let sev: Severity | null = null
      let shown = v
      for (let ri = 0; ri < rows.length; ri += 1) {
        const r = rows[ri]
        let hit = false
        let occ = 0
        if (metric.kind === 'share') {
          if (calls <= 0.05) continue
          const share = ((cShare[ri][i + w] - cShare[ri][i]) / calls) * 100
          if (shown === null) shown = share
          hit = share > r.s
          occ = calls
        } else {
          if (v === null) continue
          hit = compare(v, r.op, r.n)
          if (!hit) continue
          if (type.sim.family === 'rate' || type.sim.family === 'events') occ = bad
          else if (type.sim.family === 'latency') {
            for (let j = i; j < i + w; j += 1) {
              const x = raw[j]
              const frac = x >= r.n ? Math.min(1, 0.08 + ((x - r.n) / r.n) * 0.8) : x >= r.n * 0.85 ? 0.03 : 0
              occ += vol[j] * frac
            }
          } else occ = calls
        }
        if (hit && Math.round(occ) >= a.minOccurrences) {
          sev = r.severity
          break
        }
      }
      points.push({ t, v: shown, sev })
    }
    return { key: g.key, label: g.label, points, incidents: trackIncidents(points, a, alertId, segment, g, mFrom, down) }
  })
}

/**
 * Turns per-minute severities into incidents: open at the highest matching severity,
 * escalate, close automatically when the condition clears,
 * then hold off for the cooldown before the same group can trigger again.
 */
function trackIncidents(points: EvalPoint[], a: AlertCore, alertId: string, segment: number, g: { key: string; label: string }, mFrom: number, down: boolean): Incident[] {
  const incidents: Incident[] = []
  let cur: Incident | null = null
  let coolUntil = -Infinity
  points.forEach(({ t, v: shown, sev }, i) => {
      const c: Incident | null = cur
      if (c) {
        if (sev) {
          if (SEV_RANK[sev] > SEV_RANK[c.severity]) {
            c.severity = sev
            c.escalations.push({ t, severity: sev })
          }
          if (shown !== null) c.peak = down ? Math.min(c.peak, shown) : Math.max(c.peak, shown)
        } else {
          c.endedAt = t
          c.resolvedBy = 'auto'
          coolUntil = t + a.cooldownMin * MIN
          cur = null
        }
      } else if (sev && t >= coolUntil) {
        const inc: Incident = { id: `${alertId}|${segment}|${g.key}|${mFrom + i}`, alertId, segment, groupKey: g.key, groupLabel: g.label, severity: sev, startedAt: t, endedAt: null, resolvedBy: null, peak: shown ?? 0, escalations: [] }
        incidents.push(inc)
        cur = inc
      }
  })
  return incidents
}

/* ════════════════════════════ custom prompt alerts ════════════════════════════ */

export interface CustomCall {
  t: number
  callId: string
  agent: string
  output: CallOutput
  /** Highest severity whose rule this call matches. */
  severity: Severity | null
  matched: Severity[]
}

const INJ_BOOST: Record<Severity, number> = { critical: 0.7, warning: 0.5, info: 0.32 }

/** Simulated finished calls for one group and minute, each with the evaluator's structured output. */
function customCallsAt(a: AlertCore, g: Group, m: number, injections: Injection[]): CustomCall[] {
  const spec = a.custom
  if (!spec) return []
  const type = TYPE_BY_ID.get(a.typeId)!
  const seed = hash(`custom|${g.key}|${g.agentIds.join(',')}`)
  const t = m * MIN
  const hour = hourOf(t)
  const vols = g.agentIds.map((id) => agentVolumePerHour(id, hour) / 60)
  const total = vols.reduce((x, y) => x + y, 0)
  const r = mulberry32((seed ^ Math.imul(m, 1597334677)) >>> 0)
  const n = Math.floor(total) + (r() < total - Math.floor(total) ? 1 : 0)
  // Episodes: stretches where calls go badly for this group.
  const blk = Math.floor(m / 240)
  let boost = 0
  for (const k of [blk, blk - 1]) {
    const er = mulberry32((seed ^ Math.imul(k, 2654435761)) >>> 0)
    if (er() < type.sim.p * EPISODE_RATE) {
      const start = k * 240 + Math.floor(er() * 200)
      if (m >= start && m < start + 10 + Math.floor(er() * 35)) boost = Math.max(boost, 0.25 + er() * 0.35)
    }
  }
  for (const inj of injections) {
    if (inj.typeId !== type.id || t < inj.from || t >= inj.to) continue
    if (inj.hint?.kind === 'agent' && !g.agentIds.includes(inj.hint.key)) continue
    boost = Math.max(boost, INJ_BOOST[inj.severity])
  }
  const out: CustomCall[] = []
  for (let k = 0; k < n; k += 1) {
    const cr = mulberry32((seed ^ Math.imul(m, 2246822519) ^ Math.imul(k + 1, 3266489917)) >>> 0)
    let pick = cr() * total
    let ai = 0
    while (ai < vols.length - 1 && pick > vols[ai]) {
      pick -= vols[ai]
      ai += 1
    }
    // Most calls go fine; bad stretches come from episodes and simulated issues.
    const base = Math.pow(cr(), 6) * 0.42
    const z = Math.min(1, base + (boost ? boost * (0.6 + cr() * 0.6) : 0))
    const output = mockOutput(spec, z, cr)
    const matched = spec.rules.filter((rule) => ruleMatches(rule, spec, output)).map((rule) => rule.severity)
    const severity = matched.length ? matched.reduce((hi, x) => (SEV_RANK[x] > SEV_RANK[hi] ? x : hi)) : null
    const agent = AGENTS.find((x) => x.id === g.agentIds[ai])?.name ?? ''
    out.push({ t: t + Math.floor(cr() * MIN), callId: `call_${((seed ^ Math.imul(m, 31) ^ k) >>> 0).toString(16).slice(-6)}`, agent, output, severity, matched })
  }
  return out
}

/** Matching calls for one group between two times, newest first. */
export function customCalls(a: AlertCore, groupKey: string, from: number, to: number, injections: Injection[], limit = 10): CustomCall[] {
  const g = groupsFor(a).find((x) => x.key === groupKey)
  if (!g) return []
  const out: CustomCall[] = []
  for (let m = Math.floor(to / MIN) - 1; m >= Math.floor(from / MIN) && out.length < limit; m -= 1) {
    for (const c of customCallsAt(a, g, m, injections)) if (c.severity && out.length < limit) out.push(c)
  }
  return out
}

/**
 * A severity fires when at least `minOccurrences` calls in the window match its rule.
 * The charted value is the number of calls matching any rule.
 */
function evaluateCustom(a: AlertCore, alertId: string, segment: number, from: number, to: number, injections: Injection[]): GroupEval[] {
  const spec = a.custom
  const w = a.windowMin
  const mFrom = Math.floor(from / MIN)
  const mTo = Math.floor(to / MIN) - 1
  if (!spec || mTo < mFrom) return groupsFor(a).map((g) => ({ key: g.key, label: g.label, points: [], incidents: [] }))
  const rules = [...spec.rules].sort((x, y) => SEV_RANK[y.severity] - SEV_RANK[x.severity])
  return groupsFor(a).map((g) => {
    const n = mTo - mFrom + w
    const any = new Float64Array(n)
    const per: Record<Severity, Float64Array> = { critical: new Float64Array(n), warning: new Float64Array(n), info: new Float64Array(n) }
    for (let i = 0; i < n; i += 1) {
      for (const c of customCallsAt(a, g, mFrom - w + 1 + i, injections)) {
        if (c.matched.length) any[i] += 1
        for (const s of c.matched) per[s][i] += 1
      }
    }
    const cum = (arr: Float64Array) => {
      const c = new Float64Array(arr.length + 1)
      for (let j = 0; j < arr.length; j += 1) c[j + 1] = c[j] + arr[j]
      return c
    }
    const cAny = cum(any)
    const cSev: Record<Severity, Float64Array> = { critical: cum(per.critical), warning: cum(per.warning), info: cum(per.info) }
    const points: EvalPoint[] = []
    for (let i = 0; i <= mTo - mFrom; i += 1) {
      const total = cAny[i + w] - cAny[i]
      const sums: Record<Severity, number> = { critical: cSev.critical[i + w] - cSev.critical[i], warning: cSev.warning[i + w] - cSev.warning[i], info: cSev.info[i + w] - cSev.info[i] }
      const sev = rules.find((r) => sums[r.severity] >= a.minOccurrences)?.severity ?? null
      points.push({ t: (mFrom + i + 1) * MIN, v: total, sev })
    }
    return { key: g.key, label: g.label, points, incidents: trackIncidents(points, a, alertId, segment, g, mFrom, false) }
  })
}

/** Calls handled by the affected group while an alert was open (an estimate from call volume). */
export function affectedCalls(a: AlertCore, groupKey: string, from: number, to: number): number {
  const g = groupsFor(a).find((x) => x.key === groupKey)
  if (!g) return 0
  let n = 0
  for (let m = Math.floor(from / MIN); m < Math.ceil(to / MIN); m += 1) {
    const hour = hourOf(m * MIN)
    n += g.agentIds.reduce((s2, id) => s2 + agentVolumePerHour(id, hour), 0) / 60
  }
  const share = a.groupBy === 'provider' || a.groupBy === 'campaign' ? g.volShare : 1
  return Math.max(1, Math.round(n * share))
}

/* ════════════════════════════ simulation scenarios ════════════════════════════ */

export const SCENARIOS: { id: string; label: string; detail: string; typeId: string; hint: Injection['hint']; severity: Severity; minutes: number; note: string }[] = [
  { id: 'slow_llm', label: 'Slow LLM replies', detail: 'After-hours Line takes 5–6 s to answer.', typeId: 'high_latency', hint: { kind: 'agent', key: 'agt_afterhours' }, severity: 'critical', minutes: 25, note: 'LLM time-to-first-token jumped to 4.8 s' },
  { id: 'outage', label: 'LLM provider outage', detail: 'One in four LLM requests fails.', typeId: 'provider_error', hint: { kind: 'provider', key: 'LLM' }, severity: 'critical', minutes: 20, note: '503 Service Unavailable from the LLM provider' },
  { id: 'calls', label: 'Calls failing to connect', detail: 'Inbound calls drop before the agent joins.', typeId: 'call_failed', hint: null, severity: 'warning', minutes: 30, note: 'SIP trunk returning 480 Temporarily Unavailable' },
  { id: 'workers', label: 'No free workers', detail: 'Calls wait 20+ s to be dispatched.', typeId: 'dispatch_delay', hint: null, severity: 'warning', minutes: 20, note: 'Worker pool at 100% capacity' },
  { id: 'tool', label: 'Booking tool down', detail: 'book_appointment returns 500s.', typeId: 'tool_failed', hint: null, severity: 'critical', minutes: 25, note: 'book_appointment → 500 Internal Server Error' },
  { id: 'summary', label: 'Summary model failing', detail: 'Summaries come back empty.', typeId: 'summary_failed', hint: null, severity: 'warning', minutes: 30, note: 'Summary model returning empty output' },
  { id: 'webhook', label: 'CRM webhook down', detail: 'Summary posts fail after retries.', typeId: 'summary_post_failed', hint: null, severity: 'critical', minutes: 30, note: 'CRM webhook returns 503 after 3 retries' },
  { id: 'stt', label: 'Noisy phone line', detail: 'STT confidence drops on Reminder Caller.', typeId: 'low_stt_conf', hint: { kind: 'agent', key: 'agt_reminder' }, severity: 'warning', minutes: 60, note: 'Carrier audio degraded' },
  { id: 'frustration', label: 'Frustrated callers', detail: 'A booking outage leaves callers angry and unresolved.', typeId: 'custom_prompt', hint: null, severity: 'critical', minutes: 40, note: 'Booking tool outage left callers’ issues unresolved' },
  { id: 'quality', label: 'Agent giving wrong answers', detail: 'Quality scores drop after a prompt change.', typeId: 'call_quality', hint: { kind: 'agent', key: 'agt_booker' }, severity: 'critical', minutes: 60, note: 'New prompt version skips the price list lookup' },
  { id: 'engagement', label: 'Callers going quiet', detail: 'Callers stop engaging on After-hours Line.', typeId: 'low_engagement', hint: { kind: 'agent', key: 'agt_afterhours' }, severity: 'warning', minutes: 60, note: 'Long greeting makes callers disengage' },
  { id: 'sentiment', label: 'Negative sentiment rising', detail: 'Many callers end calls unhappy.', typeId: 'negative_sentiment', hint: null, severity: 'warning', minutes: 60, note: 'Booking slots fully taken this week' },
  { id: 'notice', label: 'Recording notice skipped', detail: 'One call opens without the notice.', typeId: 'greeting_notice', hint: { kind: 'agent', key: 'agt_afterhours' }, severity: 'critical', minutes: 5, note: 'Agent opened with “Hi, how can I help?”' },
  { id: 'hangups', label: 'Callers hanging up early', detail: 'Most calls end within 15 seconds.', typeId: 'call_length', hint: null, severity: 'warning', minutes: 60, note: 'Greeting audio failed to play' },
]
