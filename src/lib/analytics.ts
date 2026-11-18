import type { Aggregation, AppState, ChartConfig, ChartType, Dimension, ExtractionResult, Filters, Session, SessionStatus, TopicType, TopicValue, TopicVersion } from '../types'
import { DAY, startOfDay } from './seed'
import type { Index } from './store'

// ───────────── palette (validated categorical order — fixed, never cycled by rank) ─────────────
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
export const UNKNOWN_COLOR = '#c4c3bd'
export const UNKNOWN = 'Unknown'

// ───────────── formatting ─────────────
const dFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const dtFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const dyFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export const fmtDate = (ts: number) => dFmt.format(ts)
export const fmtDateTime = (ts: number) => dtFmt.format(ts)
export const fmtDateYear = (ts: number) => dyFmt.format(ts)
export const fmtDuration = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec} s`)
export const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 1 }))
export const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100))

export const TYPE_LABEL: Record<TopicType, string> = { boolean: 'Yes / No', enum: 'Single choice', number: 'Number', text: 'Text', multi_select: 'Multiple choice' }
export const TYPE_TECH: Record<TopicType, string> = { boolean: 'Boolean', enum: 'Enum', number: 'Number', text: 'Text', multi_select: 'Multi-select' }

export function fmtValue(value: TopicValue, v?: TopicVersion): string {
  if (value === null || value === undefined) return UNKNOWN
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None'
  if (typeof value === 'number') return `${fmtNum(value)}${v?.unit ? ` ${v.unit}` : ''}`
  return value
}

// ───────────── filters ─────────────
export function rangeBounds(f: Filters, clock: number): [number, number] {
  const today = startOfDay(clock)
  switch (f.range) {
    case '7d':
      return [today - 6 * DAY, Infinity]
    case '30d':
      return [today - 29 * DAY, Infinity]
    case '90d':
      return [today - 89 * DAY, Infinity]
    case 'custom': {
      const from = f.from ? new Date(`${f.from}T00:00:00`).getTime() : -Infinity
      const to = f.to ? new Date(`${f.to}T00:00:00`).getTime() + DAY : Infinity
      return [from, to]
    }
    default:
      return [-Infinity, Infinity]
  }
}

export function rangeLabel(f: Filters): string {
  if (f.range === 'all') return 'All time'
  if (f.range === 'custom') return f.from || f.to ? `${f.from || '…'} → ${f.to || '…'}` : 'Custom range'
  return `Last ${f.range.replace('d', '')} days`
}

export function sessionStatus(results: ExtractionResult[] | undefined): SessionStatus {
  if (!results || !results.length) return 'not_analysed'
  if (results.some((r) => r.status === 'queued' || r.status === 'processing')) return 'processing'
  if (results.every((r) => r.status === 'no_transcript')) return 'no_transcript'
  if (results.some((r) => r.status === 'failed' || r.status === 'invalid')) return 'attention'
  return 'complete'
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  complete: 'Complete',
  attention: 'Needs attention',
  no_transcript: 'No transcript',
  processing: 'Processing',
  not_analysed: 'Not analysed',
}

export function filterSessions(state: AppState, index: Index, clock: number): Session[] {
  const [from, to] = rangeBounds(state.filters, clock)
  const { agentId, status } = state.filters
  return state.sessions.filter((s) => {
    if (s.endedAt < from || s.endedAt >= to) return false
    if (agentId !== 'all' && s.agentId !== agentId) return false
    if (status !== 'all' && sessionStatus(index.resultsBySession.get(s.id)) !== status) return false
    return true
  })
}

// ───────────── topic values ─────────────
/** Every option this topic has ever had, current version first — so legacy values still get a stable slot. */
export function allOptions(topicId: string, index: Index, state: AppState): { current: string[]; all: string[] } {
  const topic = index.topicById.get(topicId)
  const cur = topic ? index.versionById.get(topic.currentVersionId) : undefined
  const current = cur?.type === 'boolean' ? ['Yes', 'No'] : (cur?.options ?? [])
  const all = [...current]
  for (const v of state.topicVersions) if (v.topicId === topicId) for (const o of v.options) if (!all.includes(o)) all.push(o)
  return { current, all }
}

function atoms(value: TopicValue, type: TopicType): string[] {
  if (value === null) return [UNKNOWN]
  if (type === 'boolean') return [value ? 'Yes' : 'No']
  if (type === 'enum') return [String(value)]
  if (type === 'multi_select') return Array.isArray(value) && value.length ? value : ['None']
  return ['Captured']
}

// ───────────── chart builder rules ─────────────
export const AGG_LABEL: Record<Aggregation, string> = {
  count: 'Count of calls',
  percentage: 'Percentage of calls',
  true_rate: '“Yes” rate',
  average: 'Average',
  sum: 'Sum',
  min: 'Minimum',
  max: 'Maximum',
}
export const AGG_HELP: Record<Aggregation, string> = {
  count: 'How many calls fall into each group.',
  percentage: 'Each group as a share of the calls.',
  true_rate: 'What share of calls were “Yes”. Unknown values are left out.',
  average: 'The typical value across calls.',
  sum: 'All values added together.',
  min: 'The smallest value seen.',
  max: 'The largest value seen.',
}
export const DIM_LABEL: Record<Dimension, string> = { value: 'By answer', time: 'Over time', agent: 'By agent' }
export const CHART_LABEL: Record<ChartType, string> = { bar: 'Bar', column: 'Column', line: 'Line', area: 'Area', pie: 'Pie', donut: 'Donut', stacked: 'Stacked' }

const isCategorical = (t: TopicType) => t === 'boolean' || t === 'enum' || t === 'multi_select'

export function aggregationsFor(type: TopicType, dimension: Dimension, splitBy: string): Aggregation[] {
  if (type === 'number') return ['average', 'sum', 'min', 'max', 'count']
  if (type === 'text') return ['count']
  if (type === 'boolean' && dimension !== 'value' && splitBy !== 'value') return ['true_rate', 'count', 'percentage']
  return ['count', 'percentage']
}
export function dimensionsFor(type: TopicType): Dimension[] {
  return isCategorical(type) ? ['value', 'time'] : ['time']
}

export interface SplitOption {
  value: string
  label: string
}
export function splitsFor(cfg: ChartConfig, type: TopicType, index: Index): SplitOption[] {
  const out: SplitOption[] = [{ value: 'none', label: 'No split' }]
  if (cfg.dimension !== 'agent') out.push({ value: 'agent', label: 'Agent' })
  if (isCategorical(type) && cfg.dimension !== 'value') out.push({ value: 'value', label: 'This topic’s answers' })
  for (const t of index.liveTopics) {
    if (t.id === cfg.topicId) continue
    const v = index.versionById.get(t.currentVersionId)
    if (v && (v.type === 'boolean' || v.type === 'enum')) out.push({ value: `topic:${t.id}`, label: `Topic · ${v.name}` })
  }
  return out
}

export interface TypeCheck {
  ok: boolean
  recommended: boolean
  reason: string
}
const ADDITIVE: Aggregation[] = ['count', 'percentage', 'sum']

export function checkChartTypes(cfg: ChartConfig): Record<ChartType, TypeCheck> {
  const split = cfg.splitBy !== 'none'
  const time = cfg.dimension === 'time'
  const additive = ADDITIVE.includes(cfg.aggregation)
  const part = (ok: boolean, reason: string, recommended = false): TypeCheck => ({ ok, reason: ok ? '' : reason, recommended: ok && recommended })

  const pieOk = !split && !time && additive
  const pieReason = split
    ? 'Pie and donut charts show one set of slices — remove the split.'
    : time
      ? 'Slices can’t show change over time — use a line or column chart.'
      : 'Slices must add up to a whole — use count, percentage or sum.'
  return {
    bar: part(true, '', !time && !split),
    column: part(true, '', !split && !time),
    line: part(time, 'Lines connect points in time — set “Show” to “Over time”.', time && !(split && additive)),
    area: part(time, 'Areas show change in time — set “Show” to “Over time”.', false),
    pie: part(pieOk, pieReason, false),
    donut: part(pieOk, pieReason, pieOk && cfg.dimension === 'value'),
    stacked: part(split && additive, !split ? 'Stacking needs a “Split by” so there is something to stack.' : 'Only counts, percentages and sums can be stacked.', split && additive),
  }
}

/** Repairs a config after any change so it can never describe an invalid chart. */
export function normalizeChart(cfg: ChartConfig, type: TopicType, index: Index): ChartConfig {
  const next = { ...cfg }
  const dims = dimensionsFor(type)
  if (!dims.includes(next.dimension)) next.dimension = dims[0]
  const splits = splitsFor(next, type, index)
  if (!splits.some((s) => s.value === next.splitBy)) next.splitBy = 'none'
  const aggs = aggregationsFor(type, next.dimension, next.splitBy)
  if (!aggs.includes(next.aggregation)) next.aggregation = aggs[0]
  const checks = checkChartTypes(next)
  if (!checks[next.type].ok) {
    const order: ChartType[] = ['stacked', 'line', 'donut', 'bar', 'column', 'area', 'pie']
    next.type = order.find((t) => checks[t].recommended) ?? order.find((t) => checks[t].ok) ?? 'column'
  }
  return next
}

// ───────────── chart data ─────────────
export interface ChartSeries {
  name: string
  color: string
  data: (number | null)[]
}
export interface ChartData {
  categories: string[]
  categoryColors: string[] | null
  series: ChartSeries[]
  /** sessionIds[seriesIndex][categoryIndex] */
  sessionIds: string[][][]
  unit: string
  isPercent: boolean
  empty: boolean
  measureLabel: string
}

interface Rec {
  session: Session
  value: TopicValue
  dimKeys: string[]
  splitKeys: string[]
}

export function buildChartData(cfg: ChartConfig, sessions: Session[], index: Index, state: AppState): ChartData {
  const topic = index.topicById.get(cfg.topicId)
  const version = topic ? index.versionById.get(topic.currentVersionId) : undefined
  const measureLabel = version ? (cfg.aggregation === 'count' || cfg.aggregation === 'percentage' ? AGG_LABEL[cfg.aggregation] : `${AGG_LABEL[cfg.aggregation]} · ${version.name}`) : ''
  const emptyData: ChartData = { categories: [], categoryColors: null, series: [], sessionIds: [], unit: '', isPercent: false, empty: true, measureLabel }
  if (!topic || !version) return emptyData

  const type = version.type
  const inScope = new Map(sessions.map((s) => [s.id, s]))
  const valueInPlay = cfg.dimension === 'value' || cfg.splitBy === 'value'
  const rows = (index.resultsByTopic.get(topic.id) ?? []).filter((r) => r.status === 'success' && inScope.has(r.sessionId) && (valueInPlay || r.value !== null))
  if (!rows.length) return emptyData

  // time buckets
  const times = rows.map((r) => inScope.get(r.sessionId)!.endedAt)
  const first = startOfDay(Math.min(...times))
  const last = startOfDay(Math.max(...times))
  const weekly = (last - first) / DAY > 62
  const step = weekly ? 7 * DAY : DAY
  const bucketOf = (ts: number) => Math.floor((startOfDay(ts) - first + DAY / 2) / step)
  const timeLabel = (i: number) => (weekly ? `Wk of ${fmtDate(first + i * step + DAY / 2)}` : fmtDate(first + i * step + DAY / 2))

  const agentName = (s: Session) => index.agentById.get(s.agentId)?.name ?? 'Unknown agent'
  const otherTopicId = cfg.splitBy.startsWith('topic:') ? cfg.splitBy.slice(6) : null
  const otherType = otherTopicId ? index.versionById.get(index.topicById.get(otherTopicId)?.currentVersionId ?? '')?.type : undefined
  const otherBySession = new Map<string, TopicValue>()
  if (otherTopicId) for (const r of index.resultsByTopic.get(otherTopicId) ?? []) if (r.status === 'success') otherBySession.set(r.sessionId, r.value)

  const singleName = measureLabel
  const recs: Rec[] = rows.map((r) => {
    const session = inScope.get(r.sessionId)!
    const own = atoms(r.value, type)
    const dimKeys = cfg.dimension === 'value' ? own : cfg.dimension === 'agent' ? [agentName(session)] : [String(bucketOf(session.endedAt))]
    let splitKeys = [singleName]
    if (cfg.splitBy === 'agent') splitKeys = [agentName(session)]
    else if (cfg.splitBy === 'value') splitKeys = own
    else if (otherTopicId) splitKeys = otherBySession.has(r.sessionId) && otherType ? atoms(otherBySession.get(r.sessionId)!, otherType) : [UNKNOWN]
    return { session, value: r.value, dimKeys, splitKeys }
  })

  // ordered keys + stable colours (colour follows the entity, not its rank)
  const agentOrder = state.agents.map((a) => a.name)
  const orderFor = (kind: 'value' | 'agent' | 'other' | 'time' | 'single', present: Set<string>): { keys: string[]; colors: string[] } => {
    let ordered: string[]
    if (kind === 'single') return { keys: [singleName], colors: [PALETTE[0]] }
    if (kind === 'time') {
      const n = bucketOf(last + DAY / 2) + 1
      return { keys: Array.from({ length: n }, (_, i) => String(i)), colors: [] }
    }
    if (kind === 'agent') ordered = agentOrder
    else ordered = [...allOptions(kind === 'value' ? topic.id : otherTopicId!, index, state).all, 'None']
    const extras = [...present].filter((k) => !ordered.includes(k) && k !== UNKNOWN)
    const full = [...ordered, ...extras]
    const keys = full.filter((k) => present.has(k))
    if (present.has(UNKNOWN)) keys.push(UNKNOWN)
    return { keys, colors: keys.map((k) => (k === UNKNOWN || k === 'None' ? UNKNOWN_COLOR : PALETTE[full.indexOf(k) % PALETTE.length])) }
  }
  const dimPresent = new Set(recs.flatMap((r) => r.dimKeys))
  const splitPresent = new Set(recs.flatMap((r) => r.splitKeys))
  const dim = orderFor(cfg.dimension, dimPresent)
  const split = orderFor(cfg.splitBy === 'none' ? 'single' : cfg.splitBy === 'agent' ? 'agent' : cfg.splitBy === 'value' ? 'value' : 'other', splitPresent)

  const cells: Rec[][][] = split.keys.map(() => dim.keys.map(() => []))
  const dimIdx = new Map(dim.keys.map((k, i) => [k, i]))
  const splitIdx = new Map(split.keys.map((k, i) => [k, i]))
  const catSessions: Set<string>[] = dim.keys.map(() => new Set())
  const allSessions = new Set<string>()
  for (const r of recs) {
    allSessions.add(r.session.id)
    for (const dk of r.dimKeys) {
      const di = dimIdx.get(dk)
      if (di === undefined) continue
      catSessions[di].add(r.session.id)
      for (const sk of r.splitKeys) {
        const si = splitIdx.get(sk)
        if (si !== undefined) cells[si][di].push(r)
      }
    }
  }

  const hasSplit = cfg.splitBy !== 'none'
  const agg = (list: Rec[], di: number): number | null => {
    switch (cfg.aggregation) {
      case 'count':
        return list.length
      case 'percentage': {
        const denom = hasSplit ? catSessions[di].size : allSessions.size
        return denom ? Math.round((list.length / denom) * 1000) / 10 : 0
      }
      case 'true_rate': {
        const known = list.filter((r) => r.value !== null)
        return known.length ? Math.round((known.filter((r) => r.value === true).length / known.length) * 1000) / 10 : null
      }
      default: {
        const nums = list.map((r) => r.value).filter((v): v is number => typeof v === 'number')
        if (!nums.length) return cfg.aggregation === 'sum' ? 0 : null
        const sum = nums.reduce((a, b) => a + b, 0)
        const v = cfg.aggregation === 'sum' ? sum : cfg.aggregation === 'average' ? sum / nums.length : cfg.aggregation === 'min' ? Math.min(...nums) : Math.max(...nums)
        return Math.round(v * 10) / 10
      }
    }
  }

  const isPercent = cfg.aggregation === 'percentage' || cfg.aggregation === 'true_rate'
  return {
    categories: cfg.dimension === 'time' ? dim.keys.map((k) => timeLabel(Number(k))) : dim.keys,
    categoryColors: !hasSplit && cfg.dimension !== 'time' ? dim.colors : null,
    series: split.keys.map((name, si) => ({ name, color: split.colors[si] ?? PALETTE[0], data: dim.keys.map((_, di) => agg(cells[si][di], di)) })),
    sessionIds: cells.map((row) => row.map((list) => [...new Set(list.map((r) => r.session.id))])),
    unit: isPercent ? '%' : type === 'number' && cfg.aggregation !== 'count' ? version.unit : '',
    isPercent,
    empty: false,
    measureLabel,
  }
}
