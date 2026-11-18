import { useMemo, useState } from 'react'
import { AreaChart, BarChart3, BarChartHorizontal, Copy, Donut, Layers, LineChart, Pencil, PieChart, Plus, Star, Tags, Trash2 } from 'lucide-react'
import { AGG_HELP, AGG_LABEL, CHART_LABEL, DIM_LABEL, TYPE_LABEL, aggregationsFor, checkChartTypes, dimensionsFor, filterSessions, normalizeChart, rangeLabel, splitsFor } from '../lib/analytics'
import { uid } from '../lib/mock'
import { useStore } from '../lib/store'
import type { Aggregation, ChartConfig, ChartType, Dimension, Session } from '../types'
import { ChartView } from './Chart'
import { FilterBar } from './Shared'
import { Badge, Button, Confirm, Drawer, Empty, Field, Segmented } from './ui'

const ICONS: Record<ChartType, typeof BarChart3> = { bar: BarChartHorizontal, column: BarChart3, line: LineChart, area: AreaChart, pie: PieChart, donut: Donut, stacked: Layers }
const TYPE_HINT: Record<ChartType, string> = {
  bar: 'Compare groups side by side.',
  column: 'Compare groups or days.',
  line: 'Follow a trend over time.',
  area: 'Trend with volume.',
  pie: 'Parts of a whole.',
  donut: 'Parts of a whole.',
  stacked: 'Groups split into parts.',
}
const ORDER: ChartType[] = ['bar', 'column', 'line', 'area', 'pie', 'donut', 'stacked']

/** `id: null` designs a new chart, optionally starting from a topic. */
export type ChartEditorTarget = { id: string | null; topicId?: string } | null

// ───────────── the user's charts ─────────────
export function ChartsSection({ sessions, onEdit, onNewTopic }: { sessions: Session[]; onEdit: (target: ChartEditorTarget) => void; onNewTopic: () => void }) {
  const { state, index, deleteChart, duplicateChart, toast } = useStore()
  const [removing, setRemoving] = useState<ChartConfig | null>(null)
  const hasTopics = index.liveTopics.length > 0

  return (
    <section id="charts">
      <div className="spread" style={{ marginTop: 28, marginBottom: 12 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>
            Charts
          </h2>
          <div className="section-sub" style={{ margin: '4px 0 0' }}>
            Every chart here is one you designed from your topics. They follow the filters above — click a value to see the calls behind it.
          </div>
        </div>
        <Button variant="primary" disabled={!hasTopics} title={hasTopics ? undefined : 'Create a topic first'} onClick={() => onEdit({ id: null })}>
          <Plus size={13} /> New chart
        </Button>
      </div>

      {state.charts.length === 0 ? (
        <div className="card">
          {hasTopics ? (
            <Empty icon={<BarChart3 size={18} />} title="Design your first chart" actions={<Button variant="primary" onClick={() => onEdit({ id: null })}><Plus size={13} /> New chart</Button>}>
              Nothing is charted until you decide what matters. Pick a topic, choose how to group it, and the chart appears here.
            </Empty>
          ) : (
            <Empty icon={<Tags size={18} />} title="Charts are built from topics" actions={<Button variant="primary" onClick={onNewTopic}><Plus size={13} /> New topic</Button>}>
              Create a topic first. Once calls have been analysed, you can design charts from the results.
            </Empty>
          )}
        </div>
      ) : (
        <div className="grid two">
          {state.charts.map((saved) => {
            const v = index.versionById.get(index.topicById.get(saved.topicId)?.currentVersionId ?? '')
            // Charts saved with a view that no longer exists (e.g. "By agent") fall back to a valid one.
            const c = v ? normalizeChart(saved, v.type, index) : saved
            return (
              <div key={c.id} className="card">
                <div className="card-head">
                  <div className="grow">
                    <h3>{c.title}</h3>
                    <div className="sub">
                      {v?.name ?? 'Deleted topic'} · {AGG_LABEL[c.aggregation]} · {DIM_LABEL[c.dimension].toLowerCase()}
                    </div>
                  </div>
                  <div className="row">
                    <Button variant="ghost" icon aria-label="Edit chart" title="Edit" onClick={() => onEdit({ id: c.id })}>
                      <Pencil size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      icon
                      aria-label="Duplicate chart"
                      title="Duplicate"
                      onClick={() => {
                        if (duplicateChart(c.id)) toast('Chart duplicated.')
                      }}
                    >
                      <Copy size={13} />
                    </Button>
                    <Button variant="ghost" icon danger aria-label="Delete chart" title="Delete" onClick={() => setRemoving(c)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
                <div className="card-body">
                  <ChartView config={c} sessions={sessions} height={280} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {removing && (
        <Confirm
          danger
          title={`Delete “${removing.title}”?`}
          confirmLabel="Delete chart"
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            deleteChart(removing.id)
            toast('Chart deleted.')
          }}
          body={<p>The chart is removed from this page. Your topics and call data are not affected.</p>}
        />
      )}
    </section>
  )
}

// ───────────── chart designer (drawer) ─────────────
export function ChartEditor({ target, onClose }: { target: NonNullable<ChartEditorTarget>; onClose: () => void }) {
  const { state, index, clock, saveChart, toast } = useStore()
  const existing = target.id ? state.charts.find((c) => c.id === target.id) : undefined
  const isNew = !existing
  const topics = index.liveTopics
  const typeOf = (topicId: string) => index.versionById.get(index.topicById.get(topicId)?.currentVersionId ?? '')

  const autoTitle = (c: ChartConfig) => {
    const v = typeOf(c.topicId)
    return v ? `${v.name} ${DIM_LABEL[c.dimension].toLowerCase()}${c.splitBy === 'agent' ? ', by agent' : ''}` : ''
  }

  const [draft, setDraft] = useState<ChartConfig>(() => {
    if (existing) return existing
    const base: ChartConfig = { id: uid('cht'), title: '', type: 'pie', topicId: target.topicId ?? topics[0]?.id ?? '', aggregation: 'count', dimension: 'value', splitBy: 'none', xLabel: '', yLabel: '', createdAt: clock, updatedAt: clock }
    const v = typeOf(base.topicId)
    // starting from 'pie' lets the normaliser pick the recommended type for this topic
    const n = v ? normalizeChart(base, v.type, index) : base
    return { ...n, title: autoTitle(n) }
  })
  const [titleTouched, setTitleTouched] = useState(!isNew)
  const [submitted, setSubmitted] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const version = typeOf(draft.topicId)
  const sessions = useMemo(() => filterSessions(state, index, clock), [state, index, clock])
  const checks = checkChartTypes(draft)

  const update = (patch: Partial<ChartConfig>) => {
    let next = { ...draft, ...patch }
    const v = typeOf(next.topicId)
    if (v) {
      const fixed = normalizeChart(next, v.type, index)
      if (fixed.type !== next.type) setNote(`Switched to a ${CHART_LABEL[fixed.type].toLowerCase()} chart. ${checkChartTypes(fixed)[next.type].reason || 'The previous type does not fit this data.'}`)
      else setNote(null)
      next = fixed
    }
    if (!titleTouched) next.title = autoTitle(next)
    setDraft(next)
  }

  const save = () => {
    setSubmitted(true)
    if (!draft.title.trim()) {
      toast('Give your chart a title before saving.', 'error')
      return
    }
    saveChart({ ...draft, title: draft.title.trim(), updatedAt: clock })
    toast(isNew ? 'Chart added.' : 'Chart updated.')
    onClose()
  }

  const topicOptions = existing && !topics.some((t) => t.id === existing.topicId) && index.topicById.get(existing.topicId) ? [index.topicById.get(existing.topicId)!, ...topics] : topics
  const dims = version ? dimensionsFor(version.type) : []
  const aggs = version ? aggregationsFor(version.type, draft.dimension, draft.splitBy) : []
  const splits = version ? splitsFor(draft, version.type, index) : []

  return (
    <Drawer
      xl
      title={isNew ? 'New chart' : `Edit “${existing.title}”`}
      subtitle="Choose what to measure and how to group it. Only chart types that fit your choices can be selected."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {isNew ? 'Add chart' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="builder">
        <div className="stack" style={{ gap: 18 }}>
          <Field label="1 · Topic" hint={version ? `${TYPE_LABEL[version.type]} · ${version.description}` : 'Choose what this chart is about.'}>
            <select className="select" value={draft.topicId} onChange={(e) => update({ topicId: e.target.value })}>
              {topicOptions.map((t) => {
                const v = index.versionById.get(t.currentVersionId)
                return (
                  <option key={t.id} value={t.id}>
                    {v?.name} ({v ? TYPE_LABEL[v.type] : ''}){t.deletedAt ? ' — deleted' : ''}
                  </option>
                )
              })}
            </select>
          </Field>

          <Field label="2 · Show" hint={draft.dimension === 'value' ? 'One bar or slice per answer.' : draft.dimension === 'time' ? 'One point per day (per week for long ranges).' : 'One group per voice agent.'}>
            <Segmented<Dimension> value={draft.dimension} onChange={(dimension) => update({ dimension })} options={dims.map((d) => ({ value: d, label: DIM_LABEL[d] }))} />
          </Field>

          <Field label="3 · Measure" hint={AGG_HELP[draft.aggregation]}>
            <select className="select" value={draft.aggregation} onChange={(e) => update({ aggregation: e.target.value as Aggregation })}>
              {aggs.map((a) => (
                <option key={a} value={a}>
                  {AGG_LABEL[a]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="4 · Split by (optional)" hint="Breaks each group into coloured parts — needed for stacked charts.">
            <select className="select" value={draft.splitBy} onChange={(e) => update({ splitBy: e.target.value })}>
              {splits.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="field">
            <span className="field-label">5 · Chart type</span>
            <div className="tiles">
              {ORDER.map((t) => {
                const Icon = ICONS[t]
                const c = checks[t]
                return (
                  <button key={t} type="button" className={`tile ${draft.type === t ? 'on' : ''}`} disabled={!c.ok} title={c.ok ? TYPE_HINT[t] : c.reason} onClick={() => update({ type: t })}>
                    <span className="t">
                      <Icon size={14} /> {CHART_LABEL[t]}
                    </span>
                    <span className="d">{c.ok ? TYPE_HINT[t] : c.reason}</span>
                    {c.recommended && (
                      <span className="rec" title="Recommended for this data">
                        <Star size={11} fill="#eda100" color="#eda100" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <span className="hint">
              <Star size={10} fill="#eda100" color="#eda100" /> Recommended for this data. Greyed-out types don’t fit the current choices — each one says why.
            </span>
            {note && (
              <span className="hint" style={{ color: 'var(--warn)' }}>
                {note}
              </span>
            )}
          </div>

          <Field label="6 · Title" error={submitted && !draft.title.trim() ? 'A title is required.' : null}>
            <input
              className={`input ${submitted && !draft.title.trim() ? 'invalid' : ''}`}
              value={draft.title}
              onChange={(e) => {
                setTitleTouched(true)
                setDraft((d) => ({ ...d, title: e.target.value }))
              }}
            />
          </Field>
          {draft.type !== 'pie' && draft.type !== 'donut' && (
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Field label={draft.type === 'bar' ? 'Category label' : 'Horizontal label'}>
                <input className="input" value={draft.xLabel} placeholder="Optional" onChange={(e) => setDraft((d) => ({ ...d, xLabel: e.target.value }))} />
              </Field>
              <Field label={draft.type === 'bar' ? 'Value label' : 'Vertical label'}>
                <input className="input" value={draft.yLabel} placeholder="Optional" onChange={(e) => setDraft((d) => ({ ...d, yLabel: e.target.value }))} />
              </Field>
            </div>
          )}
        </div>

        <div className="preview stack">
          <div className="card">
            <div className="card-head">
              <div>
                <h3>{draft.title || 'Untitled chart'}</h3>
                <div className="sub">
                  Live preview · {rangeLabel(state.filters)} · {sessions.length} calls
                </div>
              </div>
              <Badge>{CHART_LABEL[draft.type]}</Badge>
            </div>
            <div className="card-body">
              <ChartView config={draft} sessions={sessions} height={340} />
            </div>
          </div>
          <div>
            <div className="mono faint" style={{ marginBottom: 6 }}>
              Preview filters
            </div>
            <FilterBar />
          </div>
        </div>
      </div>
    </Drawer>
  )
}
