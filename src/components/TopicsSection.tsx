import { useMemo, useState } from 'react'
import { AlignLeft, BarChart3, CheckSquare, Hash, List, Pencil, Plus, Tags, ToggleLeft, Trash2, X } from 'lucide-react'
import { Badge, Button, Callout, Confirm, Drawer, Empty, Field, Segmented, Toggle } from './ui'
import { TYPE_LABEL, TYPE_TECH, fmtDateTime, fmtDateYear } from '../lib/analytics'
import { useStore } from '../lib/store'
import type { Topic, TopicConfig, TopicType, TopicVersion } from '../types'

const TYPES: { type: TopicType; icon: typeof Hash; help: string }[] = [
  { type: 'boolean', icon: ToggleLeft, help: 'A yes-or-no answer.' },
  { type: 'enum', icon: List, help: 'Exactly one option from a list.' },
  { type: 'multi_select', icon: CheckSquare, help: 'Any number of options from a list.' },
  { type: 'number', icon: Hash, help: 'A count, amount or score.' },
  { type: 'text', icon: AlignLeft, help: 'A short phrase or summary.' },
]

const EMPTY: TopicConfig = { name: '', key: '', description: '', type: 'boolean', options: [], min: null, max: null, unit: '' }

const TEMPLATES: TopicConfig[] = [
  { ...EMPTY, name: 'Issue resolved', key: 'is_resolved', type: 'boolean', description: 'Whether the caller’s request was fully handled by the end of the call.' },
  { ...EMPTY, name: 'Reason for calling', key: 'call_reason', type: 'enum', options: ['new request', 'change', 'cancellation', 'question', 'complaint'], description: 'The main reason the caller got in touch.' },
  { ...EMPTY, name: 'Objections raised', key: 'objections', type: 'multi_select', options: ['price', 'timing', 'trust', 'availability'], description: 'Every concern the caller raised before deciding.' },
  { ...EMPTY, name: 'Satisfaction score', key: 'satisfaction_score', type: 'number', min: 1, max: 5, unit: 'points', description: 'How satisfied the caller sounded, from 1 (very unhappy) to 5 (delighted).' },
  { ...EMPTY, name: 'Follow-up needed', key: 'follow_up', type: 'text', description: 'What the team should do next for this caller, in one sentence.' },
]

const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

function validate(cfg: TopicConfig, takenKeys: Set<string>) {
  const e: Partial<Record<'name' | 'key' | 'description' | 'options' | 'range', string>> = {}
  if (!cfg.name.trim()) e.name = 'Give the topic a name.'
  if (!cfg.key) e.key = 'A key is required.'
  else if (!/^[a-z][a-z0-9_]*$/.test(cfg.key)) e.key = 'Use lowercase letters, numbers and underscores, starting with a letter.'
  else if (takenKeys.has(cfg.key)) e.key = 'Another topic already uses this key.'
  if (cfg.description.trim().length < 10) e.description = 'Describe what the AI should look for (at least 10 characters).'
  if (cfg.type === 'enum' || cfg.type === 'multi_select') {
    const opts = cfg.options.map((o) => o.trim())
    if (opts.some((o) => !o)) e.options = 'Remove or fill in the empty option.'
    else if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) e.options = 'Each option must be different.'
    else if (opts.length < 2) e.options = 'Add at least two options to choose from.'
  }
  if (cfg.type === 'number' && cfg.min !== null && cfg.max !== null && cfg.min >= cfg.max) e.range = 'The lowest value must be smaller than the highest.'
  return e
}

function describeChange(prev: TopicVersion, next: TopicConfig): string {
  const notes: string[] = []
  if (prev.name !== next.name) notes.push(`Renamed to “${next.name}”`)
  if (prev.description !== next.description) notes.push('Updated description')
  const added = next.options.filter((o) => !prev.options.includes(o))
  const removed = prev.options.filter((o) => !next.options.includes(o))
  if (added.length) notes.push(`Added option${added.length > 1 ? 's' : ''} ${added.map((o) => `“${o}”`).join(', ')}`)
  if (removed.length) notes.push(`Removed option${removed.length > 1 ? 's' : ''} ${removed.map((o) => `“${o}”`).join(', ')}`)
  if (!added.length && !removed.length && prev.options.join('|') !== next.options.join('|')) notes.push('Reordered options')
  if (prev.min !== next.min || prev.max !== next.max) notes.push('Changed number range')
  if (prev.unit !== next.unit) notes.push('Changed unit')
  return notes.join(' · ')
}

export type TopicEditorTarget = Topic | 'new' | null

/** Topic list + editor. Lives inside the Analytics page. */
export function TopicsSection({ editing, setEditing, onChart }: { editing: TopicEditorTarget; setEditing: (t: TopicEditorTarget) => void; onChart: (topicId: string) => void }) {
  const { state, index, setTopicEnabled, deleteTopic, toast } = useStore()
  const [tab, setTab] = useState<'active' | 'deleted'>('active')
  const [removing, setRemoving] = useState<Topic | null>(null)

  const live = index.liveTopics
  const deleted = state.topics.filter((t) => t.deletedAt)
  const rows = tab === 'active' ? live : deleted

  return (
    <section id="topics">
      <div className="spread" style={{ marginTop: 34, marginBottom: 12 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>
            Topics
          </h2>
          <div className="section-sub" style={{ margin: '4px 0 0' }}>
            A topic is one thing you want to know about every call. After a call ends, the AI fills in each topic that is switched on.
          </div>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={13} /> New topic
        </Button>
      </div>

      <div className="filters">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active', label: `Topics · ${live.length}` },
            { value: 'deleted', label: `Deleted · ${deleted.length}` },
          ]}
        />
      </div>

      <div className="card">
        {rows.length === 0 ? (
          tab === 'active' ? (
            <Empty icon={<Tags size={18} />} title="Create your first topic" actions={<Button variant="primary" onClick={() => setEditing('new')}><Plus size={13} /> New topic</Button>}>
              Start with a simple yes-or-no question, like “Did the caller get what they needed?”. You can add more at any time.
            </Empty>
          ) : (
            <Empty icon={<Trash2 size={18} />} title="Nothing deleted">
              Deleted topics stay here with everything they already captured, so your history is never lost.
            </Empty>
          )
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Type</th>
                  <th className="hide-sm">Version</th>
                  <th className="hide-sm">{tab === 'active' ? 'Applies to calls' : 'Deleted'}</th>
                  <th className="hide-sm">Calls analysed</th>
                  {tab === 'active' && <th>On</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const v = index.versionById.get(t.currentVersionId)
                  if (!v) return null
                  const open = t.activations[t.activations.length - 1]
                  return (
                    <tr key={t.id}>
                      <td style={{ maxWidth: 380 }}>
                        <div className="row">
                          <span style={{ fontWeight: 550 }}>{v.name}</span>
                          <code className="mono faint" style={{ textTransform: 'none', letterSpacing: 0 }}>
                            {v.key}
                          </code>
                        </div>
                        <div className="small muted">{v.description}</div>
                      </td>
                      <td>
                        <Badge>{TYPE_LABEL[v.type]}</Badge>
                      </td>
                      <td className="hide-sm">
                        <Badge tone="outline">v{v.version}</Badge>
                      </td>
                      <td className="hide-sm small">
                        {t.deletedAt ? fmtDateYear(t.deletedAt) : t.enabled ? `ending after ${fmtDateTime(open.from)}` : <span className="faint">Paused {open.to ? fmtDateTime(open.to) : ''}</span>}
                      </td>
                      <td className="hide-sm num">{(index.resultsByTopic.get(t.id)?.length ?? 0).toLocaleString()}</td>
                      {tab === 'active' && (
                        <td>
                          <Toggle
                            on={t.enabled}
                            label={t.enabled ? `Pause ${v.name}` : `Switch on ${v.name}`}
                            onChange={(on) => {
                              setTopicEnabled(t.id, on)
                              toast(on ? `“${v.name}” is on. It applies to calls that end from now on.` : `“${v.name}” is paused. Everything captured so far is kept.`, on ? 'success' : 'info')
                            }}
                          />
                        </td>
                      )}
                      <td className="right">
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <Button variant="ghost" icon aria-label={tab === 'active' ? 'Edit topic' : 'View topic'} title={tab === 'active' ? 'Edit' : 'View history'} onClick={() => setEditing(t)}>
                            <Pencil size={13} />
                          </Button>
                          {tab === 'active' && (
                            <Button variant="ghost" icon aria-label="Create a chart from this topic" title="Create a chart from this topic" onClick={() => onChart(t.id)}>
                              <BarChart3 size={13} />
                            </Button>
                          )}
                          {tab === 'active' && (
                            <Button variant="ghost" icon danger aria-label="Delete topic" title="Delete" onClick={() => setRemoving(t)}>
                              <Trash2 size={13} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <Callout>
          <b>How topics apply.</b> A topic is extracted once, right after a call ends. New or re-enabled topics only apply to calls that end afterwards — earlier calls are never re-analysed. Editing a topic creates a new version; results already captured keep the version they were made with.
        </Callout>
      </div>

      {editing && <TopicDrawer topic={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {removing && (
        <Confirm
          danger
          title={`Delete “${index.versionById.get(removing.currentVersionId)?.name}”?`}
          confirmLabel="Delete topic"
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            deleteTopic(removing.id)
            toast('Topic deleted. Its past results are kept under “Deleted”.')
          }}
          body={
            <>
              <p>The AI will stop extracting this topic from new calls.</p>
              <p>
                The <b>{(index.resultsByTopic.get(removing.id)?.length ?? 0).toLocaleString()} results</b> already captured are kept. You can still see them on each call and in saved charts.
              </p>
            </>
          }
        />
      )}
    </section>
  )
}

function TopicDrawer({ topic, onClose }: { topic: Topic | null; onClose: () => void }) {
  const { state, index, createTopic, updateTopic, toast } = useStore()
  const current = topic ? index.versionById.get(topic.currentVersionId) : undefined
  const readOnly = !!topic?.deletedAt
  const [cfg, setCfg] = useState<TopicConfig>(() => (current ? { name: current.name, key: current.key, description: current.description, type: current.type, options: [...current.options], min: current.min, max: current.max, unit: current.unit } : EMPTY))
  const [keyTouched, setKeyTouched] = useState(!!topic)
  const [submitted, setSubmitted] = useState(false)
  const [newOption, setNewOption] = useState('')

  const takenKeys = useMemo(() => {
    const set = new Set<string>()
    for (const t of state.topics) {
      if (t.id === topic?.id || t.deletedAt) continue
      const v = index.versionById.get(t.currentVersionId)
      if (v) set.add(v.key)
    }
    return set
  }, [state.topics, index, topic])

  const errors = validate(cfg, takenKeys)
  const valid = Object.keys(errors).length === 0
  const show = (k: keyof typeof errors) => (submitted ? (errors[k] ?? null) : null)
  const set = (patch: Partial<TopicConfig>) => setCfg((c) => ({ ...c, ...patch }))
  const hasOptions = cfg.type === 'enum' || cfg.type === 'multi_select'
  const versions = topic ? state.topicVersions.filter((v) => v.topicId === topic.id).sort((a, b) => b.version - a.version) : []

  const addOption = () => {
    const o = newOption.trim()
    if (!o) return
    if (cfg.options.some((x) => x.toLowerCase() === o.toLowerCase())) {
      toast(`“${o}” is already an option.`, 'error')
      return
    }
    set({ options: [...cfg.options, o] })
    setNewOption('')
  }

  const save = () => {
    setSubmitted(true)
    if (!valid) {
      toast('Fix the highlighted fields before saving.', 'error')
      return
    }
    const clean: TopicConfig = { ...cfg, name: cfg.name.trim(), description: cfg.description.trim(), options: hasOptions ? cfg.options.map((o) => o.trim()) : [], min: cfg.type === 'number' ? cfg.min : null, max: cfg.type === 'number' ? cfg.max : null, unit: cfg.type === 'number' ? cfg.unit.trim() : '' }
    if (topic && current) {
      const note = describeChange(current, clean)
      if (!note) {
        toast('No changes to save.', 'info')
        onClose()
        return
      }
      updateTopic(topic.id, clean, note)
      toast(`Saved as version ${current.version + 1}. It applies to calls that end from now on.`)
    } else {
      createTopic(clean)
      toast(`“${clean.name}” is on. It applies to calls that end from now on.`)
    }
    onClose()
  }

  const definition = {
    key: cfg.key || '…',
    type: TYPE_TECH[cfg.type].toLowerCase(),
    description: cfg.description || '…',
    ...(hasOptions ? { options: cfg.options } : {}),
    ...(cfg.type === 'number' ? { min: cfg.min, max: cfg.max, unit: cfg.unit || undefined } : {}),
    nullable: true,
  }
  const sample = cfg.type === 'boolean' ? ['Yes', 'No'] : hasOptions ? cfg.options.filter(Boolean) : cfg.type === 'number' ? [`${cfg.min ?? 0}${cfg.unit ? ` ${cfg.unit}` : ''}`, '…', `${cfg.max ?? 10}${cfg.unit ? ` ${cfg.unit}` : ''}`] : ['“A short sentence written by the AI”']

  return (
    <Drawer
      wide
      title={readOnly ? `${current?.name} · deleted` : topic ? `Edit “${current?.name}”` : 'New topic'}
      subtitle={readOnly ? 'This topic no longer runs. Its configuration history is shown for reference.' : topic ? 'Saving creates a new version. Calls already analysed keep their original results.' : 'Describe one thing you want to learn from every call.'}
      onClose={onClose}
      footer={
        readOnly ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            {submitted && !valid && <span className="small grow" style={{ color: 'var(--bad)' }}>{Object.keys(errors).length} field{Object.keys(errors).length > 1 ? 's need' : ' needs'} attention</span>}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save}>
              {topic ? `Save as version ${(current?.version ?? 0) + 1}` : 'Create topic'}
            </Button>
          </>
        )
      }
    >
      <div className="grid two" style={{ gap: 24, alignItems: 'start' }}>
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
          {!topic && (
            <div className="field">
              <span className="field-label">Start from an example</span>
              <div className="row wrap">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className="chip"
                    style={{ border: 0 }}
                    onClick={() => {
                      setCfg({ ...t, options: [...t.options] })
                      setKeyTouched(true)
                    }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="Name" error={show('name')} hint="Shown on your charts and on each call.">
            <input
              className={`input ${show('name') ? 'invalid' : ''}`}
              value={cfg.name}
              placeholder="e.g. Appointment booked"
              autoFocus={!topic}
              onChange={(e) => set(keyTouched ? { name: e.target.value } : { name: e.target.value, key: slug(e.target.value) })}
            />
          </Field>
          <Field label="Key" error={show('key')} hint={topic ? 'The key is fixed once a topic exists, so exports and integrations keep working.' : 'A short ID for exports and integrations. Filled in for you.'}>
            <input
              className={`input code ${show('key') ? 'invalid' : ''}`}
              value={cfg.key}
              disabled={!!topic}
              placeholder="appointment_booked"
              onChange={(e) => {
                setKeyTouched(true)
                set({ key: e.target.value.toLowerCase().replace(/\s+/g, '_') })
              }}
            />
          </Field>
          <Field label="What should the AI look for?" error={show('description')} hint="Write it like you would explain it to a new teammate. Clear instructions give better answers.">
            <textarea className={`textarea ${show('description') ? 'invalid' : ''}`} value={cfg.description} placeholder="e.g. Whether the caller successfully booked an appointment during the call." onChange={(e) => set({ description: e.target.value })} />
          </Field>

          <div className="field">
            <span className="field-label">Answer type</span>
            <div className="tiles">
              {TYPES.map(({ type, icon: Icon, help }) => (
                <button key={type} type="button" className={`tile ${cfg.type === type ? 'on' : ''}`} disabled={!!topic && cfg.type !== type} onClick={() => set({ type })}>
                  <span className="t">
                    <Icon size={14} /> {TYPE_LABEL[type]}
                  </span>
                  <span className="d">{help}</span>
                </button>
              ))}
            </div>
            {topic && <span className="hint">The answer type can’t change after creation — past results would stop making sense. Create a new topic instead.</span>}
          </div>

          {hasOptions && (
            <Field label="Options" error={show('options')} hint={cfg.type === 'enum' ? 'The AI picks exactly one.' : 'The AI picks every option that applies.'}>
              <div className="stack" style={{ gap: 6 }}>
                {cfg.options.map((o, i) => (
                  <div key={i} className="row">
                    <input className="input" value={o} aria-label={`Option ${i + 1}`} onChange={(e) => set({ options: cfg.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                    <Button variant="ghost" icon aria-label={`Remove option ${o}`} onClick={() => set({ options: cfg.options.filter((_, j) => j !== i) })}>
                      <X size={14} />
                    </Button>
                  </div>
                ))}
                <div className="row">
                  <input
                    className="input"
                    value={newOption}
                    placeholder={cfg.options.length ? 'Add another option' : 'Type an option and press Enter'}
                    onChange={(e) => setNewOption(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addOption()
                      }
                    }}
                  />
                  <Button onClick={addOption} disabled={!newOption.trim()}>
                    <Plus size={12} /> Add
                  </Button>
                </div>
              </div>
            </Field>
          )}

          {cfg.type === 'number' && (
            <Field label="Expected range (optional)" error={show('range')} hint="Helps the AI stay realistic. Leave blank for no limit.">
              <div className="row">
                <input className="input" type="number" placeholder="Lowest" aria-label="Lowest value" value={cfg.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? null : Number(e.target.value) })} />
                <input className="input" type="number" placeholder="Highest" aria-label="Highest value" value={cfg.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? null : Number(e.target.value) })} />
                <input className="input" placeholder="Unit, e.g. days" aria-label="Unit" value={cfg.unit} onChange={(e) => set({ unit: e.target.value })} />
              </div>
            </Field>
          )}
        </fieldset>

        <div className="stack">
          <div className="mono faint">Preview</div>
          <div className="card" style={{ padding: 16 }}>
            <div className="spread">
              <span style={{ fontWeight: 600, fontSize: 15 }}>{cfg.name || 'Untitled topic'}</span>
              <Badge>{TYPE_LABEL[cfg.type]}</Badge>
            </div>
            <p className="small muted" style={{ margin: '4px 0 12px' }}>
              {cfg.description || 'Your description will appear here.'}
            </p>
            <div className="mono faint" style={{ marginBottom: 6 }}>
              Possible answers
            </div>
            <div className="row wrap">
              {sample.length ? sample.map((s, i) => <span key={i} className="chip">{s}</span>) : <span className="small faint">Add options to see them here.</span>}
              <span className="chip unknown">Unknown</span>
            </div>
            <p className="small faint" style={{ marginTop: 10 }}>
              “Unknown” is recorded when the call doesn’t make the answer clear. It is kept separate from {cfg.type === 'number' ? '0' : cfg.type === 'boolean' ? '“No”' : 'a real answer'}.
            </p>
          </div>
          <div>
            <div className="mono faint" style={{ marginBottom: 6 }}>
              Definition sent to the AI
            </div>
            <pre className="code">{JSON.stringify(definition, null, 2)}</pre>
          </div>
          {!readOnly && <Callout>{topic ? 'Changes apply to calls that end after you save. Earlier results stay exactly as they were.' : 'This topic switches on as soon as you create it and applies to calls that end from then on. Past calls are not re-analysed.'}</Callout>}

          {versions.length > 0 && (
            <div>
              <div className="mono faint" style={{ marginBottom: 6 }}>
                Version history
              </div>
              <div className="card">
                {versions.map((v, i) => (
                  <div key={v.id} className="spread" style={{ padding: '10px 14px', borderTop: i ? '1px solid var(--line)' : 0, alignItems: 'flex-start' }}>
                    <div>
                      <div className="row">
                        <Badge tone="outline">v{v.version}</Badge>
                        {v.id === topic?.currentVersionId && <Badge tone="good">Current</Badge>}
                      </div>
                      <div className="small muted" style={{ marginTop: 4 }}>
                        {v.changeNote}
                      </div>
                    </div>
                    <div className="small faint" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {fmtDateTime(v.createdAt)}
                      <br />
                      {state.results.filter((r) => r.versionId === v.id).length.toLocaleString()} results
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  )
}
