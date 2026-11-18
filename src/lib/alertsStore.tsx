import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DAY, MIN, SCENARIOS, TYPE_BY_ID, coreOf, evaluate, rid, type AlertConfig, type Incident, type Injection } from './alerts'
import { SAMPLE_PREFIX, sampleAlerts, sampleInjections } from './alertSamples'
import { useStore } from './store'

const KEY = 'voice-alerts-state'
const SCHEMA = 2
/** How much activity is evaluated and kept for analytics. */
export const HISTORY = 7 * DAY

interface AlertsState {
  schema: number
  alerts: AlertConfig[]
  injections: Injection[]
  /** Sample alerts are added once per browser; removing them keeps them removed. */
  samplesAdded?: boolean
}
/** Ongoing while the condition holds; resolved automatically once it clears. */
export type IncidentStatus = 'ongoing' | 'resolved'
export interface IncidentRow extends Incident {
  status: IncidentStatus
  alert: AlertConfig
}

function load(): AlertsState {
  let s: AlertsState = { schema: SCHEMA, alerts: [], injections: [] }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw) as AlertsState
      if (saved.schema === SCHEMA) s = { ...saved, alerts: saved.alerts.filter((a) => TYPE_BY_ID.has(a.typeId)) }
    }
  } catch {
    /* start fresh */
  }
  // Mock data: add sample alerts with a week of history alongside anything already created.
  if (!s.samplesAdded) {
    const now = Date.now()
    const names = new Set(s.alerts.map((a) => a.name.toLowerCase()))
    s = { ...s, alerts: [...s.alerts, ...sampleAlerts(now).filter((a) => !names.has(a.name.toLowerCase()))], injections: [...s.injections, ...sampleInjections(now)], samplesAdded: true }
  }
  return s
}

interface AlertsStore {
  alerts: AlertConfig[]
  injections: Injection[]
  now: number
  incidents: IncidentRow[]
  saveAlert: (a: AlertConfig) => void
  setEnabled: (id: string, on: boolean) => void
  deleteAlert: (id: string) => void
  duplicateAlert: (id: string) => string | null
  simulate: (scenarioId: string) => void
  removeSamples: () => void
}

const Ctx = createContext<AlertsStore | null>(null)

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { toast } = useStore()
  const [state, setState] = useState<AlertsState>(load)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state))
      } catch {
        /* keep working in memory */
      }
    }, 300)
    return () => clearTimeout(t)
  }, [state])

  const minute = Math.floor(now / MIN)

  const incidents = useMemo<IncidentRow[]>(() => {
    // Include the minute in progress so a new alert or simulated issue shows up straight away.
    const end = (minute + 1) * MIN
    const start = end - HISTORY
    const out: IncidentRow[] = []
    for (const alert of state.alerts) {
      alert.segments.forEach((seg, i) => {
        const from = Math.max(seg.from, start)
        const to = Math.min(seg.to ?? end, end)
        if (to <= from) return
        for (const g of evaluate(seg.core, alert.id, i, from, to, state.injections)) {
          for (const inc of g.incidents) {
            // A segment that closed (edit or switch-off) closes its open incidents.
            if (inc.endedAt === null && seg.to !== null) {
              inc.endedAt = seg.to
              inc.resolvedBy = 'auto'
            }
            const status: IncidentStatus = inc.endedAt !== null ? 'resolved' : 'ongoing'
            out.push({ ...inc, status, alert })
          }
        }
      })
    }
    return out.sort((a, b) => b.startedAt - a.startedAt)
  }, [state, minute])

  const saveAlert = useCallback((a: AlertConfig) => {
    const t = Date.now()
    setState((s) => {
      const prev = s.alerts.find((x) => x.id === a.id)
      const core = coreOf(a)
      let segments = prev ? prev.segments : []
      const changed = !prev || JSON.stringify(coreOf(prev)) !== JSON.stringify(core) || prev.enabled !== a.enabled
      if (changed) {
        segments = segments.map((sg) => (sg.to === null ? { ...sg, to: t } : sg))
        // The demo has no stored history, so a brand-new alert is replayed over the last 7 days of simulated calls.
        if (a.enabled) segments = [...segments, { from: prev ? t : t - HISTORY, to: null, core }]
      }
      const next: AlertConfig = { ...a, segments, updatedAt: t, createdAt: prev?.createdAt ?? t }
      return { ...s, alerts: prev ? s.alerts.map((x) => (x.id === a.id ? next : x)) : [next, ...s.alerts] }
    })
  }, [])

  const setEnabled = useCallback((id: string, on: boolean) => {
    const t = Date.now()
    setState((s) => ({
      ...s,
      alerts: s.alerts.map((a) => {
        if (a.id !== id || a.enabled === on) return a
        const closed = a.segments.map((sg) => (sg.to === null ? { ...sg, to: t } : sg))
        return { ...a, enabled: on, updatedAt: t, segments: on ? [...closed, { from: t, to: null, core: coreOf(a) }] : closed }
      }),
    }))
  }, [])

  const deleteAlert = useCallback((id: string) => setState((s) => ({ ...s, alerts: s.alerts.filter((a) => a.id !== id) })), [])

  const duplicateAlert = useCallback(
    (id: string) => {
      const src = state.alerts.find((a) => a.id === id)
      if (!src) return null
      const t = Date.now()
      const names = new Set(state.alerts.map((a) => a.name.toLowerCase()))
      let name = `${src.name} (copy)`
      for (let i = 2; names.has(name.toLowerCase()); i += 1) name = `${src.name} (copy ${i})`
      const copy: AlertConfig = { ...src, id: rid('alr'), name, enabled: false, segments: [], createdAt: t, updatedAt: t, notifications: src.notifications.map((n) => ({ ...n, id: rid('ntf') })), rows: src.rows.map((r) => ({ ...r, id: rid('row') })) }
      setState((s) => ({ ...s, alerts: [copy, ...s.alerts] }))
      return copy.id
    },
    [state.alerts],
  )

  const simulate = useCallback(
    (scenarioId: string) => {
      const sc = SCENARIOS.find((x) => x.id === scenarioId)
      if (!sc) return
      const t = Date.now()
      // Back-date the fault by the longest window any matching alert uses, so it fires immediately.
      const lead = Math.max(12, ...state.alerts.filter((a) => a.typeId === sc.typeId).map((a) => a.windowMin))
      const from = sc.typeId === 'greeting_notice' ? Math.floor(t / MIN) * MIN - MIN : t - lead * MIN
      setState((s) => ({ ...s, injections: [...s.injections.filter((i) => i.to > t - HISTORY), { id: rid('inj'), scenario: sc.label, typeId: sc.typeId, hint: sc.hint, severity: sc.severity, from, to: t + sc.minutes * MIN, note: sc.note }] }))
      setNow(t)
      const watching = state.alerts.filter((a) => a.enabled && a.typeId === sc.typeId)
      toast(watching.length ? `${sc.label} started. Watch Activity for “${watching[0].name}”.` : `${sc.label} started, but no enabled alert watches this yet.`, watching.length ? 'success' : 'info')
    },
    [state.alerts, toast],
  )

  const removeSamples = useCallback(
    () => setState((s) => ({ ...s, alerts: s.alerts.filter((a) => !a.id.startsWith(SAMPLE_PREFIX)), injections: s.injections.filter((i) => !i.id.startsWith(SAMPLE_PREFIX)) })),
    [],
  )

  const value = useMemo<AlertsStore>(
    () => ({ alerts: state.alerts, injections: state.injections, now, incidents, saveAlert, setEnabled, deleteAlert, duplicateAlert, simulate, removeSamples }),
    [state, now, incidents, saveAlert, setEnabled, deleteAlert, duplicateAlert, simulate, removeSamples],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAlerts(): AlertsStore {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAlerts must be used inside AlertsProvider')
  return c
}
