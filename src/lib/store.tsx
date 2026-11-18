import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Agent, AppState, ChartConfig, ExtractionResult, Filters, Session, SimSettings, Topic, TopicConfig, TopicVersion } from '../types'
import { isEligible, resultId, runExtraction } from './extraction'
import { makeSession, mulberry32, uid } from './mock'
import { DAY, SCHEMA, blankState, seedState, versionAt } from './seed'

const STORAGE_KEY = 'voice-analytics-state'

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (parsed.schema === SCHEMA) {
        // jobs that were mid-flight when the tab closed go back to the queue
        parsed.results.forEach((r) => {
          if (r.status === 'processing') r.status = 'queued'
        })
        return parsed
      }
    }
  } catch {
    /* fall through to demo data */
  }
  return seedState()
}

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info'
  message: string
}
export interface Drill {
  title: string
  subtitle?: string
  sessionIds: string[]
}
export interface Index {
  topicById: Map<string, Topic>
  versionById: Map<string, TopicVersion>
  sessionById: Map<string, Session>
  agentById: Map<string, Agent>
  resultsBySession: Map<string, ExtractionResult[]>
  resultsByTopic: Map<string, ExtractionResult[]>
  /** topics that are not archived, in creation order */
  liveTopics: Topic[]
}

interface Store {
  state: AppState
  index: Index
  /** Demo clock: real time, or the end of the latest simulated call if that is later. */
  clock: number
  queue: { total: number; done: number } | null
  toasts: Toast[]
  drill: Drill | null
  openSessionId: string | null

  createTopic: (cfg: TopicConfig) => string
  updateTopic: (topicId: string, cfg: TopicConfig, changeNote: string) => void
  setTopicEnabled: (topicId: string, enabled: boolean) => void
  deleteTopic: (topicId: string) => void
  simulateSessions: (opts: { count: number; agentId: string; spreadDays: number }) => void
  rerunRecent: () => void
  retryResults: (ids: string[]) => void
  saveChart: (chart: ChartConfig) => void
  deleteChart: (id: string) => void
  duplicateChart: (id: string) => string | null
  setFilters: (patch: Partial<Filters>) => void
  updateSettings: (patch: Partial<SimSettings>) => void
  setWorkspace: (name: string) => void
  resetDemo: () => void
  clearAll: () => void
  toast: (message: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void
  setDrill: (d: Drill | null) => void
  openSession: (id: string | null) => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [drill, setDrill] = useState<Drill | null>(null)
  const [openSessionId, openSession] = useState<string | null>(null)
  const [batchTotal, setBatchTotal] = useState(0)
  const stateRef = useRef(state)
  stateRef.current = state

  // ── persistence ──
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        /* storage full – the app keeps working in memory */
      }
    }, 500)
    return () => clearTimeout(t)
  }, [state])

  const toast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = uid('tst')
    setToasts((t) => [...t.slice(-3), { id, kind, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const clock = useMemo(() => {
    const last = state.sessions.length ? state.sessions[state.sessions.length - 1].endedAt : 0
    return Math.max(Date.now(), last)
  }, [state])
  const clockRef = useRef(clock)
  clockRef.current = clock

  const index = useMemo<Index>(() => {
    const resultsBySession = new Map<string, ExtractionResult[]>()
    const resultsByTopic = new Map<string, ExtractionResult[]>()
    for (const r of state.results) {
      let a = resultsBySession.get(r.sessionId)
      if (!a) resultsBySession.set(r.sessionId, (a = []))
      a.push(r)
      let b = resultsByTopic.get(r.topicId)
      if (!b) resultsByTopic.set(r.topicId, (b = []))
      b.push(r)
    }
    return {
      topicById: new Map(state.topics.map((t) => [t.id, t])),
      versionById: new Map(state.topicVersions.map((v) => [v.id, v])),
      sessionById: new Map(state.sessions.map((s) => [s.id, s])),
      agentById: new Map(state.agents.map((a) => [a.id, a])),
      resultsBySession,
      resultsByTopic,
      liveTopics: state.topics.filter((t) => !t.deletedAt),
    }
  }, [state.results, state.topics, state.topicVersions, state.sessions, state.agents])

  // ── extraction queue ──
  // Jobs are created as "queued" rows; this worker drains them in small batches.
  const queuedCount = useMemo(() => state.results.reduce((n, r) => n + (r.status === 'queued' ? 1 : 0), 0), [state.results])

  useEffect(() => {
    if (queuedCount === 0) return
    const timer = setTimeout(() => {
      const s = stateRef.current
      const sessions = new Map(s.sessions.map((x) => [x.id, x]))
      const versions = new Map(s.topicVersions.map((x) => [x.id, x]))
      const chunk = Math.max(6, Math.ceil(Math.max(batchTotal, queuedCount) / 14))
      const patches = new Map<string, Partial<ExtractionResult>>()
      for (const r of s.results) {
        if (r.status !== 'queued') continue
        if (patches.size >= chunk) break
        const session = sessions.get(r.sessionId)
        const version = versions.get(r.versionId)
        if (!session || !version) {
          patches.set(r.id, { status: 'failed', error: 'The session or topic configuration could not be found.' })
          continue
        }
        patches.set(r.id, { ...runExtraction(session, version, s.settings, r.attempts), updatedAt: clockRef.current })
      }
      setState((prev) => ({ ...prev, results: prev.results.map((r) => (patches.has(r.id) && r.status === 'queued' ? { ...r, ...patches.get(r.id) } : r)) }))
    }, 140)
    return () => clearTimeout(timer)
  }, [queuedCount, state.results, batchTotal])

  const wasBusy = useRef(false)
  useEffect(() => {
    if (queuedCount > 0) {
      wasBusy.current = true
    } else if (wasBusy.current) {
      wasBusy.current = false
      if (batchTotal > 0) toast(`Extraction finished · ${batchTotal} topic value${batchTotal === 1 ? '' : 's'} processed`)
      setBatchTotal(0)
    }
  }, [queuedCount, batchTotal, toast])

  /** Creates queued jobs for every (session, eligible topic) pair that has no result yet. */
  const enqueue = useCallback((prev: AppState, sessions: Session[], label: string, at: number): { next: AppState; created: number; skipped: number } => {
    const existing = new Set(prev.results.map((r) => r.id))
    const fresh: ExtractionResult[] = []
    let skipped = 0
    for (const session of sessions) {
      for (const topic of prev.topics) {
        if (topic.deletedAt || !isEligible(topic, session)) continue
        const id = resultId(session.id, topic.id)
        if (existing.has(id)) {
          skipped += 1 // duplicate job – same session + topic already has a result
          continue
        }
        const v = versionAt(prev.topicVersions, topic.id, session.endedAt) ?? prev.topicVersions.find((x) => x.id === topic.currentVersionId)
        if (!v) continue
        existing.add(id)
        fresh.push({ id, sessionId: session.id, topicId: topic.id, versionId: v.id, status: 'queued', value: null, confidence: null, evidence: [], attempts: 0, error: null, rawValue: null, createdAt: session.endedAt, updatedAt: session.endedAt })
      }
    }
    const run = { id: uid('run'), at, label, sessions: sessions.length, jobsCreated: fresh.length, duplicatesSkipped: skipped }
    return { next: { ...prev, results: [...prev.results, ...fresh], runs: [run, ...prev.runs].slice(0, 30) }, created: fresh.length, skipped }
  }, [])

  const actions = useMemo(() => {
    const now = () => Math.max(Date.now(), clockRef.current)

    const createTopic = (cfg: TopicConfig) => {
      const topicId = uid('top')
      const at = now() + 1 // strictly after every call that has already ended
      const v: TopicVersion = { ...cfg, id: `${topicId}_v1`, topicId, version: 1, createdAt: at, changeNote: 'Topic created' }
      const topic: Topic = { id: topicId, currentVersionId: v.id, enabled: true, activations: [{ from: at, to: null }], createdAt: at, deletedAt: null }
      setState((p) => ({ ...p, topics: [...p.topics, topic], topicVersions: [...p.topicVersions, v] }))
      return topicId
    }

    const updateTopic = (topicId: string, cfg: TopicConfig, changeNote: string) => {
      setState((p) => {
        const topic = p.topics.find((t) => t.id === topicId)
        if (!topic) return p
        const count = p.topicVersions.filter((v) => v.topicId === topicId).length
        // Versions are immutable. An edit appends a new one; old results keep pointing at the old one.
        const v: TopicVersion = { ...cfg, id: `${topicId}_v${count + 1}_${uid('v')}`, topicId, version: count + 1, createdAt: now(), changeNote }
        return { ...p, topicVersions: [...p.topicVersions, v], topics: p.topics.map((t) => (t.id === topicId ? { ...t, currentVersionId: v.id } : t)) }
      })
    }

    const closeWindows = (t: Topic, at: number) => t.activations.map((w) => (w.to === null ? { ...w, to: at } : w))

    const setTopicEnabled = (topicId: string, enabled: boolean) => {
      const at = now() + 1
      setState((p) => ({
        ...p,
        topics: p.topics.map((t) => {
          if (t.id !== topicId || t.enabled === enabled) return t
          return enabled ? { ...t, enabled: true, activations: [...t.activations, { from: at, to: null }] } : { ...t, enabled: false, activations: closeWindows(t, at) }
        }),
      }))
    }

    const deleteTopic = (topicId: string) => {
      const at = now()
      setState((p) => ({ ...p, topics: p.topics.map((t) => (t.id === topicId ? { ...t, enabled: false, deletedAt: at, activations: closeWindows(t, at) } : t)) }))
    }

    const simulateSessions = ({ count, agentId, spreadDays }: { count: number; agentId: string; spreadDays: number }) => {
      const prev = stateRef.current
      const rng = mulberry32(Math.floor(Math.random() * 2 ** 31))
      const start = now()
      const pool = agentId === 'all' ? prev.agents : prev.agents.filter((a) => a.id === agentId)
      const created: Session[] = []
      for (let i = 0; i < count; i++) {
        // Calls end just after "now" (or are spread over the coming days, fast-forwarding the demo clock).
        const offset = spreadDays > 0 ? Math.floor(rng() * spreadDays * DAY) + 60_000 : 1000 + i * 1500
        const agent = pool[Math.floor(rng() * pool.length)]
        created.push(makeSession(rng, agent, start + offset, prev.settings.missingTranscriptRate, prev.sessions.length + i))
      }
      created.sort((a, b) => a.endedAt - b.endedAt)
      const withSessions = { ...prev, sessions: [...prev.sessions, ...created] }
      const { next, created: jobs } = enqueue(withSessions, created, `Simulated ${count} call${count === 1 ? '' : 's'}`, start)
      setState(next)
      setBatchTotal((n) => n + jobs)
      if (jobs === 0) toast(`${count} calls added. No topics are active, so nothing was extracted.`, 'info')
      else toast(`${count} calls ended · extracting ${jobs} topic values…`, 'info')
    }

    const rerunRecent = () => {
      const prev = stateRef.current
      const since = now() - DAY
      const recent = prev.sessions.filter((s) => s.endedAt >= since)
      const { next, created, skipped } = enqueue(prev, recent, 'Re-ran extraction · last 24 hours', now())
      setState(next)
      setBatchTotal((n) => n + created)
      toast(created ? `${created} new jobs queued · ${skipped} duplicates skipped` : `Nothing to do · ${skipped} duplicate job${skipped === 1 ? '' : 's'} skipped`, 'info')
    }

    const retryResults = (ids: string[]) => {
      const set = new Set(ids)
      setState((p) => ({
        ...p,
        results: p.results.map((r) => {
          if (!set.has(r.id) || (r.status !== 'failed' && r.status !== 'invalid')) return r
          return { ...r, status: 'queued' as const, error: null, rawValue: null }
        }),
      }))
      setBatchTotal((b) => b + ids.length)
    }

    const saveChart = (chart: ChartConfig) => {
      setState((p) => {
        const exists = p.charts.some((c) => c.id === chart.id)
        return { ...p, charts: exists ? p.charts.map((c) => (c.id === chart.id ? chart : c)) : [...p.charts, chart] }
      })
    }
    const deleteChart = (id: string) => setState((p) => ({ ...p, charts: p.charts.filter((c) => c.id !== id) }))
    const duplicateChart = (id: string) => {
      const src = stateRef.current.charts.find((c) => c.id === id)
      if (!src) return null
      const copy: ChartConfig = { ...src, id: uid('cht'), title: `${src.title} (copy)`, createdAt: now(), updatedAt: now() }
      setState((p) => ({ ...p, charts: [...p.charts, copy] }))
      return copy.id
    }

    const setFilters = (patch: Partial<Filters>) => setState((p) => ({ ...p, filters: { ...p.filters, ...patch } }))
    const updateSettings = (patch: Partial<SimSettings>) => setState((p) => ({ ...p, settings: { ...p.settings, ...patch } }))
    const setWorkspace = (name: string) => setState((p) => ({ ...p, workspace: name }))
    const resetDemo = () => {
      setBatchTotal(0)
      setState(seedState())
    }
    const clearAll = () => {
      setBatchTotal(0)
      setState((p) => ({ ...blankState(), workspace: p.workspace, settings: p.settings }))
    }

    return { createTopic, updateTopic, setTopicEnabled, deleteTopic, simulateSessions, rerunRecent, retryResults, saveChart, deleteChart, duplicateChart, setFilters, updateSettings, setWorkspace, resetDemo, clearAll }
  }, [enqueue, toast])

  const queue = queuedCount > 0 ? { total: Math.max(batchTotal, queuedCount), done: Math.max(0, Math.max(batchTotal, queuedCount) - queuedCount) } : null

  const value: Store = { state, index, clock, queue, toasts, drill, openSessionId, toast, dismissToast, setDrill, openSession, ...actions }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore must be used inside <StoreProvider>')
  return s
}
