import type { Severity } from './alerts'
import type { Rng } from './mock'

/* ════════════════════════════ model ════════════════════════════ */

export type FieldType = 'boolean' | 'number' | 'enum' | 'text'
export interface OutputField {
  id: string
  key: string
  type: FieldType
  description: string
  /** Number range, kept as typed. */
  min: string
  max: string
  /** Enum options, comma-separated as typed. */
  options: string
}
export type CondOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains'
export interface Condition {
  id: string
  fieldId: string
  op: CondOp
  value: string
}
/** Every condition in a group must match (AND). */
export interface ConditionGroup {
  id: string
  conditions: Condition[]
}
/** Any group matching triggers this severity (OR). */
export interface SeverityRule {
  id: string
  severity: Severity
  groups: ConditionGroup[]
}
export interface CustomSpec {
  fields: OutputField[]
  rules: SeverityRule[]
}
export type CallOutput = Record<string, boolean | number | string>

export const FIELD_TYPE_LABEL: Record<FieldType, string> = { boolean: 'Boolean', number: 'Number', enum: 'Enum', text: 'Text' }
export const OPS_FOR: Record<FieldType, CondOp[]> = {
  boolean: ['eq', 'neq'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  enum: ['eq', 'neq'],
  text: ['contains', 'not_contains', 'eq'],
}
export const COND_LABEL: Record<CondOp, string> = {
  eq: 'equals',
  neq: 'does not equal',
  gt: 'greater than',
  gte: 'greater than or equal to',
  lt: 'less than',
  lte: 'less than or equal to',
  contains: 'contains',
  not_contains: 'does not contain',
}
const COND_SHORT: Record<CondOp, string> = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: 'contains', not_contains: 'doesn’t contain' }

const cid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`

export function makeField(key: string, type: FieldType, description: string, extra: Partial<OutputField> = {}): OutputField {
  return { id: cid('fld'), key, type, description, min: type === 'number' ? '1' : '', max: type === 'number' ? '5' : '', options: '', ...extra }
}
export function makeCondition(field: OutputField | undefined): Condition {
  return { id: cid('cnd'), fieldId: field?.id ?? '', op: field ? OPS_FOR[field.type][0] : 'eq', value: field ? defaultValue(field) : '' }
}
export function makeGroup(field: OutputField | undefined): ConditionGroup {
  return { id: cid('grp'), conditions: [makeCondition(field)] }
}
export function defaultValue(f: OutputField): string {
  if (f.type === 'boolean') return 'true'
  if (f.type === 'enum') return enumOptions(f)[0] ?? ''
  if (f.type === 'number') return f.max || ''
  return ''
}
export function enumOptions(f: OutputField): string[] {
  return f.options.split(',').map((o) => o.trim()).filter(Boolean)
}

/* ════════════════════════════ templates ════════════════════════════ */


export function frustrationExample(): CustomSpec {
  const isFrustrated = makeField('is_frustrated', 'boolean', 'Did the caller show frustration?')
  const level = makeField('frustration_level', 'number', '1 = calm, 5 = very frustrated', { min: '1', max: '5' })
  const resolved = makeField('issue_resolved', 'boolean', 'Was the caller’s issue resolved?')
  const sentiment = makeField('sentiment', 'enum', 'Caller sentiment by the end of the call', { options: 'Positive, Neutral, Negative' })
  const reason = makeField('reason', 'text', 'One sentence quoting the deciding moment')
  const c = (f: OutputField, op: CondOp, value: string): Condition => ({ id: cid('cnd'), fieldId: f.id, op, value })
  return {
    fields: [isFrustrated, level, resolved, sentiment, reason],
    rules: [
      {
        id: cid('rul'),
        severity: 'critical',
        groups: [
          { id: cid('grp'), conditions: [c(isFrustrated, 'eq', 'true'), c(level, 'gte', '4'), c(resolved, 'eq', 'false')] },
          { id: cid('grp'), conditions: [c(sentiment, 'eq', 'Negative'), c(level, 'eq', '5')] },
        ],
      },
      { id: cid('rul'), severity: 'warning', groups: [{ id: cid('grp'), conditions: [c(level, 'gte', '3')] }] },
      { id: cid('rul'), severity: 'info', groups: [{ id: cid('grp'), conditions: [c(isFrustrated, 'eq', 'true')] }] },
    ],
  }
}

export function bookingExample(): CustomSpec {
  const requested = makeField('booking_requested', 'boolean', 'Did the caller ask to book or move an appointment?')
  const confirmed = makeField('booking_confirmed', 'boolean', 'Was a booking actually made?')
  const readBack = makeField('details_read_back', 'boolean', 'Did the agent read back the date, time and name?')
  const c = (f: OutputField, op: CondOp, value: string): Condition => ({ id: cid('cnd'), fieldId: f.id, op, value })
  return {
    fields: [requested, confirmed, readBack],
    rules: [
      { id: cid('rul'), severity: 'critical', groups: [{ id: cid('grp'), conditions: [c(requested, 'eq', 'true'), c(confirmed, 'eq', 'false')] }] },
      { id: cid('rul'), severity: 'warning', groups: [{ id: cid('grp'), conditions: [c(confirmed, 'eq', 'true'), c(readBack, 'eq', 'false')] }] },
    ],
  }
}

export function blankSpec(): CustomSpec {
  const f = makeField('', 'boolean', '')
  return { fields: [f], rules: [{ id: cid('rul'), severity: 'critical', groups: [makeGroup(f)] }] }
}

export const CUSTOM_TEMPLATES: { id: string; label: string; make: () => CustomSpec }[] = [
  { id: 'frustration', label: 'Caller frustration', make: frustrationExample },
  { id: 'booking', label: 'Booking not confirmed', make: bookingExample },
  { id: 'blank', label: 'Start blank', make: blankSpec },
]

/* ════════════════════════════ schema + text ════════════════════════════ */

/** JSON Schema the evaluator must return. */
export function schemaOf(spec: CustomSpec): object {
  const properties: Record<string, object> = {}
  for (const f of spec.fields) {
    if (!f.key) continue
    const base: Record<string, unknown> = { description: f.description || undefined }
    if (f.type === 'boolean') base.type = 'boolean'
    if (f.type === 'text') base.type = 'string'
    if (f.type === 'enum') Object.assign(base, { type: 'string', enum: enumOptions(f) })
    if (f.type === 'number') {
      const lo = Number(f.min)
      const hi = Number(f.max)
      Object.assign(base, { type: Number.isInteger(lo) && Number.isInteger(hi) ? 'integer' : 'number', minimum: f.min === '' ? undefined : lo, maximum: f.max === '' ? undefined : hi })
    }
    properties[f.key] = base
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

export function conditionText(c: Condition, spec: CustomSpec): string {
  const f = spec.fields.find((x) => x.id === c.fieldId)
  if (!f) return '(removed field)'
  const v = f.type === 'text' ? `“${c.value}”` : c.value || '…'
  return `${f.key || '(unnamed)'} ${COND_SHORT[c.op]} ${v}`
}
export function groupText(g: ConditionGroup, spec: CustomSpec): string {
  return g.conditions.map((c) => conditionText(c, spec)).join(' AND ')
}
export function ruleText(r: SeverityRule, spec: CustomSpec): string {
  if (r.groups.length === 1) return groupText(r.groups[0], spec)
  return r.groups.map((g) => `(${groupText(g, spec)})`).join(' OR ')
}

/* ════════════════════════════ validation ════════════════════════════ */

const KEY = /^[a-z][a-z0-9_]*$/
export function validateCustom(spec: CustomSpec | null | undefined): Record<string, string> {
  const e: Record<string, string> = {}
  if (!spec) {
    e.fields = 'Add at least one output field.'
    return e
  }
  if (!spec.fields.length) e.fields = 'Add at least one output field.'
  const keys = new Set<string>()
  for (const f of spec.fields) {
    const k = f.key.trim()
    if (!k) e[`field_${f.id}`] = 'Give the field a name.'
    else if (!KEY.test(k)) e[`field_${f.id}`] = 'Use snake_case: lowercase letters, numbers and underscores.'
    else if (keys.has(k)) e[`field_${f.id}`] = `“${k}” is used twice.`
    keys.add(k)
    if (f.type === 'number') {
      const lo = Number(f.min)
      const hi = Number(f.max)
      if (f.min.trim() === '' || f.max.trim() === '' || Number.isNaN(lo) || Number.isNaN(hi)) e[`field_${f.id}`] ??= 'Set a numeric range, like 1 to 5.'
      else if (lo >= hi) e[`field_${f.id}`] ??= 'Minimum must be below maximum.'
    }
    if (f.type === 'enum' && enumOptions(f).length < 2) e[`field_${f.id}`] ??= 'List at least two options, separated by commas.'
  }
  if (!spec.rules.length) e.rules = 'Add at least one severity rule.'
  const sev = new Set<Severity>()
  for (const r of spec.rules) {
    if (sev.has(r.severity)) e[`rule_${r.id}`] = 'There’s already a rule for this severity.'
    sev.add(r.severity)
    if (!r.groups.length || r.groups.some((g) => !g.conditions.length)) e[`rule_${r.id}`] ??= 'Each group needs at least one condition.'
    for (const g of r.groups)
      for (const c of g.conditions) {
        const f = spec.fields.find((x) => x.id === c.fieldId)
        if (!f) {
          e[`cond_${c.id}`] = 'Pick a field.'
          continue
        }
        if (!OPS_FOR[f.type].includes(c.op)) e[`cond_${c.id}`] = 'This operator doesn’t work with this field type.'
        else if (f.type === 'number' && (c.value.trim() === '' || Number.isNaN(Number(c.value)))) e[`cond_${c.id}`] = 'Enter a number.'
        else if (f.type === 'number' && f.min !== '' && f.max !== '' && (Number(c.value) < Number(f.min) || Number(c.value) > Number(f.max))) e[`cond_${c.id}`] = `Must be between ${f.min} and ${f.max}.`
        else if (f.type === 'enum' && !enumOptions(f).includes(c.value)) e[`cond_${c.id}`] = 'Pick one of the field’s options.'
        else if (f.type === 'text' && !c.value.trim()) e[`cond_${c.id}`] = 'Enter some text.'
      }
  }
  return e
}

/* ════════════════════════════ matching ════════════════════════════ */

function matches(c: Condition, f: OutputField, v: boolean | number | string | undefined): boolean {
  if (v === undefined) return false
  switch (f.type) {
    case 'boolean': {
      const same = v === (c.value === 'true')
      return c.op === 'neq' ? !same : same
    }
    case 'number': {
      const x = Number(v)
      const t = Number(c.value)
      return { eq: x === t, neq: x !== t, gt: x > t, gte: x >= t, lt: x < t, lte: x <= t, contains: false, not_contains: false }[c.op]
    }
    case 'enum': {
      const same = String(v).toLowerCase() === c.value.toLowerCase()
      return c.op === 'neq' ? !same : same
    }
    case 'text': {
      const s = String(v).toLowerCase()
      const q = c.value.toLowerCase()
      return c.op === 'contains' ? s.includes(q) : c.op === 'not_contains' ? !s.includes(q) : s === q
    }
  }
}
export function ruleMatches(r: SeverityRule, spec: CustomSpec, out: CallOutput): boolean {
  return r.groups.some(
    (g) =>
      g.conditions.length > 0 &&
      g.conditions.every((c) => {
        const f = spec.fields.find((x) => x.id === c.fieldId)
        return !!f && matches(c, f, out[f.key])
      }),
  )
}

/* ════════════════════════════ mock evaluator ════════════════════════════ */

const GOOD = ['resolved', 'success', 'satisf', 'happy', 'complete', 'confirm', 'booked', 'positive', 'helpful', 'polite', 'read_back', 'correct', 'accurate', 'good', 'calm', 'yes']
const BAD = ['frustrat', 'angry', 'anger', 'upset', 'negative', 'complain', 'escalat', 'churn', 'risk', 'confus', 'rude', 'error', 'fail', 'problem', 'bad', 'poor', 'unresolved', 'no', 'human', 'competitor', 'wrong']
const polarityCache = new Map<string, 1 | -1 | 0>()
const polarity = (s: string): 1 | -1 | 0 => {
  let p = polarityCache.get(s)
  if (p === undefined) {
    p = polarityOf(s)
    polarityCache.set(s, p)
  }
  return p
}
const polarityOf = (s: string): 1 | -1 | 0 => {
  const k = s.toLowerCase()
  if (BAD.some((w) => k.includes(w) && !(w === 'no' && k.length > 3))) return 1
  if (GOOD.some((w) => k.includes(w))) return -1
  return 0
}
const TEXTS: [number, string][] = [
  [0.0, 'Caller booked a cleaning for Friday and thanked the agent.'],
  [0.15, 'Quick reminder call; caller confirmed the visit.'],
  [0.35, 'Caller had to repeat their date of birth twice.'],
  [0.5, 'Caller sighed: “I already told you that.”'],
  [0.65, 'Caller asked twice to speak to a real person.'],
  [0.8, 'Booking tool failed and the caller hung up without an appointment.'],
  [0.9, 'Caller: “This is useless, I’ll call another clinic.”'],
]

/**
 * Fakes the evaluator LLM's structured output for one call.
 * `z` is how badly the call went (0 = great, 1 = terrible); field names hint at direction.
 */
export function mockOutput(spec: CustomSpec, z: number, r: Rng): CallOutput {
  const out: CallOutput = {}
  for (const f of spec.fields) {
    if (!f.key) continue
    const pol = polarity(f.key)
    const bad = pol === -1 ? 1 - z : z
    const jitter = (r() - 0.5) * 0.25
    switch (f.type) {
      case 'boolean':
        out[f.key] = pol === 0 ? r() < 0.6 : bad + jitter > (pol === 1 ? 0.5 : 0.35)
        break
      case 'number': {
        const lo = Number(f.min) || 0
        const hi = Number.isNaN(Number(f.max)) || f.max === '' ? lo + 4 : Number(f.max)
        const t = Math.min(1, Math.max(0, (pol === 0 ? r() : bad) + jitter))
        const v = lo + t * (hi - lo)
        out[f.key] = Number.isInteger(lo) && Number.isInteger(hi) ? Math.round(v) : Math.round(v * 100) / 100
        break
      }
      case 'enum': {
        const opts = enumOptions(f)
        if (!opts.length) break
        const sorted = [...opts].sort((a, b) => polarity(a) - polarity(b))
        const t = Math.min(1, Math.max(0, (pol === -1 ? 1 - bad : z) + jitter))
        out[f.key] = sorted[Math.min(sorted.length - 1, Math.floor(t * sorted.length))]
        break
      }
      case 'text': {
        let s = TEXTS[0][1]
        for (const [at, text] of TEXTS) if (z + jitter * 0.4 >= at) s = text
        out[f.key] = s
        break
      }
    }
  }
  return out
}
