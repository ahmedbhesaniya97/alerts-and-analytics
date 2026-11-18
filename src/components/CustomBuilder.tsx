import { useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { SEVERITIES, SEV_LABEL, SEV_RANK, type Severity } from '../lib/alerts'
import {
  COND_LABEL,
  CUSTOM_TEMPLATES,
  FIELD_TYPE_LABEL,
  OPS_FOR,
  defaultValue,
  enumOptions,
  makeCondition,
  makeField,
  makeGroup,
  ruleText,
  schemaOf,
  type Condition,
  type ConditionGroup,
  type CustomSpec,
  type FieldType,
  type OutputField,
  type SeverityRule,
} from '../lib/customAlerts'
import { SeverityBadge } from './AlertParts'
import { Button, Segmented } from './ui'

interface Props {
  spec: CustomSpec
  onChange: (spec: CustomSpec) => void
  errors: Record<string, string>
}

/** Structured output fields, shown inside the Conditions panel when Custom is selected. One row per field; click to edit. */
export function OutputFields({ spec, onChange, errors }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [showSchema, setShowSchema] = useState(false)
  const setField = (id: string, p: Partial<OutputField>) => {
    const fields = spec.fields.map((f) => (f.id === id ? { ...f, ...p } : f))
    // If the type or options changed, keep conditions on this field valid.
    const f = fields.find((x) => x.id === id)!
    const rules = p.type || p.options !== undefined ? spec.rules.map((r) => ({ ...r, groups: r.groups.map((g) => ({ ...g, conditions: g.conditions.map((c) => (c.fieldId === id ? fixCondition(c, f) : c)) })) })) : spec.rules
    onChange({ ...spec, fields, rules })
  }
  const add = () => {
    const f = makeField('', 'boolean', '')
    onChange({ ...spec, fields: [...spec.fields, f] })
    setEditing(f.id)
  }

  return (
    <div className="cx-panel">
      <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Structured output</div>
          <div className="small muted">The fields returned for every call.</div>
        </div>
        <select
          className="select sm"
          value=""
          onChange={(e) => {
            const t = CUSTOM_TEMPLATES.find((x) => x.id === e.target.value)
            if (t) {
              onChange(t.make())
              setEditing(null)
            }
          }}
          aria-label="Load an example"
        >
          <option value="">Load example…</option>
          {CUSTOM_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="cx-list">
        {spec.fields.map((f) => {
          const err = errors[`field_${f.id}`]
          if (editing === f.id) {
            return <FieldEditor key={f.id} f={f} canRemove={spec.fields.length > 1} onChange={(p) => setField(f.id, p)} onDone={() => setEditing(null)} onRemove={() => { onChange({ ...spec, fields: spec.fields.filter((x) => x.id !== f.id) }); setEditing(null) }} />
          }
          return (
            <button key={f.id} type="button" className={`cx-item ${err ? 'bad' : ''}`} onClick={() => setEditing(f.id)}>
              <span className="cx-item-top">
                <code className="cx-name">{f.key || <span className="faint">unnamed</span>}</code>
                <span className="cx-type">{FIELD_TYPE_LABEL[f.type]}</span>
                <span className="cx-vals">{valuesText(f)}</span>
                <Pencil size={13} className="cx-edit" />
              </span>
              {(err || f.description) && <span className={`cx-desc ${err ? 'err' : ''}`}>{err ?? f.description}</span>}
            </button>
          )
        })}
      </div>
      {errors.fields && <div className="small" style={{ color: 'var(--bad)', marginTop: 6 }}>{errors.fields}</div>}

      <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
        <Button variant="ghost" onClick={add}>
          <Plus size={13} /> Add field
        </Button>
        <button type="button" className="link small" onClick={() => setShowSchema((v) => !v)}>
          {showSchema ? 'Hide' : 'View'} JSON schema
        </button>
      </div>
      {showSchema && <pre className="cx-pre">{JSON.stringify(schemaOf(spec), null, 2)}</pre>}
    </div>
  )
}

function valuesText(f: OutputField): string {
  if (f.type === 'boolean') return 'true / false'
  if (f.type === 'number') return f.min !== '' && f.max !== '' ? `${f.min} – ${f.max}` : 'any number'
  if (f.type === 'enum') return enumOptions(f).join(' · ') || 'no options yet'
  return 'free text'
}

function FieldEditor({ f, canRemove, onChange, onDone, onRemove }: { f: OutputField; canRemove: boolean; onChange: (p: Partial<OutputField>) => void; onDone: () => void; onRemove: () => void }) {
  const [draftOpt, setDraftOpt] = useState('')
  const opts = enumOptions(f)
  const nameError = f.key && !/^[a-z][a-z0-9_]*$/.test(f.key) ? 'Use lowercase letters, numbers and underscores, starting with a letter.' : null
  const addOpt = () => {
    const v = draftOpt.trim().replace(/,/g, '')
    if (v && !opts.includes(v)) onChange({ options: [...opts, v].join(', ') })
    setDraftOpt('')
  }
  return (
    <div className="cx-editor">
      <div className="cx-erow">
        <label className="cx-label" htmlFor={`fk_${f.id}`}>Name</label>
        <div>
          <input id={`fk_${f.id}`} className={`input sm code ${nameError ? 'invalid' : ''}`} autoFocus value={f.key} placeholder="e.g. is_frustrated" onChange={(e) => onChange({ key: e.target.value.replace(/\s+/g, '_').toLowerCase() })} />
          {nameError && <div className="small" style={{ color: 'var(--bad)', marginTop: 4 }}>{nameError}</div>}
        </div>
      </div>
      <div className="cx-erow">
        <span className="cx-label">Type</span>
        <Segmented value={f.type} onChange={(t) => onChange({ type: t, ...(t === 'number' && !f.min ? { min: '1', max: '5' } : {}) })} options={(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => ({ value: t, label: FIELD_TYPE_LABEL[t] }))} />
      </div>
      {f.type === 'number' && (
        <div className="cx-erow">
          <span className="cx-label">Range</span>
          <div className="row" style={{ gap: 6 }}>
            <input className="input sm" style={{ width: 70 }} inputMode="decimal" value={f.min} onChange={(e) => onChange({ min: e.target.value })} aria-label="Minimum" />
            <span className="small muted">to</span>
            <input className="input sm" style={{ width: 70 }} inputMode="decimal" value={f.max} onChange={(e) => onChange({ max: e.target.value })} aria-label="Maximum" />
          </div>
        </div>
      )}
      {f.type === 'enum' && (
        <div className="cx-erow">
          <span className="cx-label">Options</span>
          <div className="cx-opts">
            {opts.map((o) => (
              <span key={o} className="cx-opt">
                {o}
                <button type="button" aria-label={`Remove ${o}`} onClick={() => onChange({ options: opts.filter((x) => x !== o).join(', ') })}>
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              className="cx-opt-input"
              value={draftOpt}
              placeholder={opts.length ? 'Add option' : 'Type an option, press Enter'}
              onChange={(e) => setDraftOpt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addOpt()
                } else if (e.key === 'Backspace' && !draftOpt && opts.length) onChange({ options: opts.slice(0, -1).join(', ') })
              }}
              onBlur={addOpt}
              aria-label="Add option"
            />
          </div>
        </div>
      )}
      <div className="cx-erow">
        <label className="cx-label" htmlFor={`fd_${f.id}`}>Description</label>
        <input id={`fd_${f.id}`} className="input sm" value={f.description} placeholder="What should go in this field?" onChange={(e) => onChange({ description: e.target.value })} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
        {canRemove ? (
          <Button variant="ghost" danger onClick={onRemove}>
            <Trash2 size={12} /> Remove
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}

/** Severity rules: AND inside a condition group, OR between groups. */
export function TriggerConditions({ spec, onChange, errors }: Props) {
  const set = (p: Partial<CustomSpec>) => onChange({ ...spec, ...p })
  const setRule = (id: string, p: Partial<SeverityRule>) => set({ rules: spec.rules.map((r) => (r.id === id ? { ...r, ...p } : r)) })
  const usedSev = new Set(spec.rules.map((r) => r.severity))
  const namedFields = spec.fields.filter((f) => f.key.trim())

  return (
    <section>
      <h2 className="ae-h">Alert trigger conditions</h2>
      <div className="small muted" style={{ marginTop: -6, marginBottom: 12 }}>
        Conditions in a group must all match (AND). The severity triggers if any group matches (OR). When a call matches several severities, the highest one counts.
      </div>
      <div className="stack" style={{ gap: 14 }}>
        {[...spec.rules].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]).map((r) => (
          <RuleCard
            key={r.id}
            rule={r}
            spec={spec}
            errors={errors}
            used={usedSev}
            canRemove={spec.rules.length > 1}
            namedFields={namedFields}
            onChange={(p) => setRule(r.id, p)}
            onRemove={() => set({ rules: spec.rules.filter((x) => x.id !== r.id) })}
          />
        ))}
      </div>
      {errors.rules && <div className="small" style={{ color: 'var(--bad)', marginTop: 6 }}>{errors.rules}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <Button
          disabled={usedSev.size >= 3}
          onClick={() => {
            const next = SEVERITIES.find((s) => !usedSev.has(s))!
            set({ rules: [...spec.rules, { id: `rul_${Math.random().toString(36).slice(2, 9)}`, severity: next, groups: [makeGroup(namedFields[0])] }] })
          }}
        >
          <Plus size={13} /> Add severity
        </Button>
        {usedSev.size >= 3 && <span className="small faint">One rule per severity.</span>}
      </div>

      <div className="cx-summary">
        <div className="mono faint" style={{ marginBottom: 8 }}>Severity configuration</div>
        <table className="table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Condition</th>
            </tr>
          </thead>
          <tbody>
            {[...spec.rules].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]).map((r) => (
              <tr key={r.id}>
                <td><SeverityBadge severity={r.severity} /></td>
                <td className="small code-ish">{ruleText(r, spec)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function fixCondition(c: Condition, f: OutputField): Condition {
  const op = OPS_FOR[f.type].includes(c.op) ? c.op : OPS_FOR[f.type][0]
  let value = c.value
  if (f.type === 'boolean' && value !== 'true' && value !== 'false') value = 'true'
  if (f.type === 'enum' && !enumOptions(f).includes(value)) value = defaultValue(f)
  if (f.type === 'number' && Number.isNaN(Number(value))) value = defaultValue(f)
  return { ...c, op, value }
}

function RuleCard({ rule, spec, errors, used, canRemove, namedFields, onChange, onRemove }: { rule: SeverityRule; spec: CustomSpec; errors: Record<string, string>; used: Set<Severity>; canRemove: boolean; namedFields: OutputField[]; onChange: (p: Partial<SeverityRule>) => void; onRemove: () => void }) {
  const setGroup = (id: string, p: Partial<ConditionGroup>) => onChange({ groups: rule.groups.map((g) => (g.id === id ? { ...g, ...p } : g)) })
  return (
    <div className={`cx-rule ${rule.severity} ${errors[`rule_${rule.id}`] ? 'bad' : ''}`}>
      <div className="cx-rule-head">
        <span>Severity is</span>
        <span className={`ae-sev ${rule.severity}`}>
          <select className="select sm" value={rule.severity} onChange={(e) => onChange({ severity: e.target.value as Severity })} aria-label="Severity">
            {SEVERITIES.map((s) => (
              <option key={s} value={s} disabled={s !== rule.severity && used.has(s)}>{SEV_LABEL[s]}</option>
            ))}
          </select>
        </span>
        <span className="muted">when any group below matches</span>
        {canRemove && (
          <Button variant="ghost" icon aria-label="Remove severity rule" title="Remove severity rule" onClick={onRemove} className="ae-x">
            <X size={14} />
          </Button>
        )}
      </div>
      {errors[`rule_${rule.id}`] && <div className="small" style={{ color: 'var(--bad)', margin: '0 0 8px' }}>{errors[`rule_${rule.id}`]}</div>}

      {rule.groups.map((g, gi) => (
        <div key={g.id}>
          {gi > 0 && (
            <div className="cx-or">
              <span>OR</span>
            </div>
          )}
          <div className="cx-group">
            <div className="spread" style={{ marginBottom: 8 }}>
              <span className="mono faint">Condition group {gi + 1}</span>
              {rule.groups.length > 1 && (
                <Button variant="ghost" icon aria-label="Remove group" title="Remove group" onClick={() => onChange({ groups: rule.groups.filter((x) => x.id !== g.id) })}>
                  <X size={13} />
                </Button>
              )}
            </div>
            {g.conditions.map((c, ci) => (
              <div key={c.id}>
                {ci > 0 && <div className="cx-and">AND</div>}
                <ConditionLine
                  c={c}
                  spec={spec}
                  namedFields={namedFields}
                  error={errors[`cond_${c.id}`]}
                  canRemove={g.conditions.length > 1}
                  onChange={(p) => setGroup(g.id, { conditions: g.conditions.map((x) => (x.id === c.id ? { ...x, ...p } : x)) })}
                  onRemove={() => setGroup(g.id, { conditions: g.conditions.filter((x) => x.id !== c.id) })}
                />
              </div>
            ))}
            <Button variant="ghost" onClick={() => setGroup(g.id, { conditions: [...g.conditions, makeCondition(namedFields[0])] })} style={{ marginTop: 8 }}>
              <Plus size={12} /> Add condition
            </Button>
          </div>
        </div>
      ))}
      <Button onClick={() => onChange({ groups: [...rule.groups, makeGroup(namedFields[0])] })} style={{ marginTop: 10 }}>
        <Plus size={12} /> Add OR group
      </Button>
    </div>
  )
}

function ConditionLine({ c, spec, namedFields, error, canRemove, onChange, onRemove }: { c: Condition; spec: CustomSpec; namedFields: OutputField[]; error?: string; canRemove: boolean; onChange: (p: Partial<Condition>) => void; onRemove: () => void }) {
  const f = spec.fields.find((x) => x.id === c.fieldId)
  return (
    <div>
      <div className="cx-cond">
        <select
          className={`select sm code ${error && !f ? 'invalid' : ''}`}
          value={f ? f.id : ''}
          onChange={(e) => {
            const nf = spec.fields.find((x) => x.id === e.target.value)
            if (nf) onChange({ fieldId: nf.id, op: OPS_FOR[nf.type][0], value: defaultValue(nf) })
          }}
          aria-label="Field"
        >
          {!f && <option value="">Choose a field…</option>}
          {namedFields.map((x) => (
            <option key={x.id} value={x.id}>{x.key}</option>
          ))}
        </select>
        {f && (
          <>
            <select className="select sm" value={c.op} onChange={(e) => onChange({ op: e.target.value as Condition['op'] })} aria-label="Operator">
              {OPS_FOR[f.type].map((o) => (
                <option key={o} value={o}>{COND_LABEL[o]}</option>
              ))}
            </select>
            {f.type === 'boolean' ? (
              <select className="select sm" value={c.value} onChange={(e) => onChange({ value: e.target.value })} aria-label="Value">
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : f.type === 'enum' ? (
              <select className={`select sm ${error ? 'invalid' : ''}`} value={c.value} onChange={(e) => onChange({ value: e.target.value })} aria-label="Value">
                {!enumOptions(f).includes(c.value) && <option value={c.value}>{c.value || 'Choose…'}</option>}
                {enumOptions(f).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input className={`input sm ${error ? 'invalid' : ''}`} style={{ width: f.type === 'number' ? 80 : 180 }} inputMode={f.type === 'number' ? 'decimal' : undefined} value={c.value} onChange={(e) => onChange({ value: e.target.value })} aria-label="Value" />
            )}
          </>
        )}
        {canRemove && (
          <Button variant="ghost" icon aria-label="Remove condition" onClick={onRemove} className="ae-x">
            <X size={13} />
          </Button>
        )}
      </div>
      {error && <div className="small" style={{ color: 'var(--bad)', marginTop: 4 }}>{error}</div>}
    </div>
  )
}
