import type { AppState, ExtractionResult, Filters, Session, SimSettings, Topic, TopicConfig, TopicVersion } from '../types'
import { isEligible, resultId, runExtraction } from './extraction'
import { AGENTS, makeSession, mulberry32, randomTimeInDay } from './mock'

export const SCHEMA = 4
export const DAY = 86_400_000

export const DEFAULT_SETTINGS: SimSettings = { failureRate: 0.06, missingTranscriptRate: 0.04, autoRetries: 1 }
export const DEFAULT_FILTERS: Filters = { range: '30d', from: '', to: '', agentId: 'all', status: 'all' }

export const startOfDay = (ts: number) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The version of a topic that was in force at a given moment. */
export function versionAt(versions: TopicVersion[], topicId: string, at: number): TopicVersion | undefined {
  let best: TopicVersion | undefined
  for (const v of versions) {
    if (v.topicId !== topicId) continue
    if (v.createdAt <= at && (!best || v.version > best.version)) best = v
  }
  return best
}

export function blankState(): AppState {
  return {
    schema: SCHEMA,
    workspace: 'Acme Dental',
    agents: AGENTS,
    sessions: [],
    topics: [],
    topicVersions: [],
    results: [],
    charts: [],
    runs: [],
    settings: DEFAULT_SETTINGS,
    filters: { ...DEFAULT_FILTERS },
  }
}

interface SeedTopic {
  cfg: Partial<TopicConfig> & Pick<TopicConfig, 'name' | 'key' | 'description' | 'type'>
  daysAgo: number
  disabledDaysAgo?: number
  v2?: { daysAgo: number; patch: Partial<TopicConfig>; note: string }
}

const SEED_TOPICS: SeedTopic[] = [
  { cfg: { name: 'Booked', key: 'is_booked', type: 'boolean', description: 'Whether the caller successfully booked or moved an appointment during the call.' }, daysAgo: 30 },
  { cfg: { name: 'Type of booking', key: 'type_of_booking', type: 'enum', options: ['online', 'offline'], description: 'If an appointment was booked: online (video consultation) or offline (in-clinic visit).' }, daysAgo: 30 },
  { cfg: { name: 'Handed to a person', key: 'is_handed_to_person', type: 'boolean', description: 'Whether the caller asked for, or was transferred to, a human representative.' }, daysAgo: 30 },
  {
    cfg: { name: 'Caller sentiment', key: 'caller_sentiment', type: 'enum', options: ['positive', 'negative'], description: 'How the caller felt by the end of the call.' },
    daysAgo: 30,
    v2: { daysAgo: 14, patch: { options: ['positive', 'neutral', 'negative'], description: 'How the caller felt by the end of the call, judged from their final remarks.' }, note: 'Added option “neutral” · updated description' },
  },
  { cfg: { name: 'Services discussed', key: 'services_discussed', type: 'multi_select', options: ['cleaning', 'checkup', 'whitening', 'braces', 'emergency'], description: 'Every service the caller mentioned or asked about.' }, daysAgo: 30 },
  { cfg: { name: 'Days until appointment', key: 'days_until_appointment', type: 'number', min: 0, max: 30, unit: 'days', description: 'How many days from the call until the booked appointment.' }, daysAgo: 10 },
  { cfg: { name: 'Call summary', key: 'call_summary', type: 'text', description: 'One sentence describing what the caller wanted and how the call ended.' }, daysAgo: 10 },
  { cfg: { name: 'Insurance mentioned', key: 'insurance_mentioned', type: 'boolean', description: 'Whether the caller asked about insurance or coverage.' }, daysAgo: 30, disabledDaysAgo: 12 },
]

export function seedState(now = Date.now()): AppState {
  const rng = mulberry32(20261117)
  const state = blankState()
  const today = startOfDay(now)

  // sessions: 45 days of history
  const sessions: Session[] = []
  let seq = 0
  for (let dayOffset = 45; dayOffset >= 0; dayOffset--) {
    const dayStart = today - dayOffset * DAY
    const dow = new Date(dayStart).getDay()
    const weekend = dow === 0 || dow === 6
    const growth = 1 + (45 - dayOffset) / 90
    const n = Math.round((weekend ? 2 + rng() * 3 : 7 + rng() * 6) * growth)
    for (let i = 0; i < n; i++) {
      const endedAt = randomTimeInDay(rng, dayStart)
      if (endedAt > now - 60_000) continue
      const r = rng()
      const agent = weekend || r < 0.18 ? AGENTS[1] : r < 0.4 ? AGENTS[2] : AGENTS[0]
      sessions.push(makeSession(rng, agent, endedAt, DEFAULT_SETTINGS.missingTranscriptRate, seq++))
    }
  }
  sessions.sort((a, b) => a.endedAt - b.endedAt)

  // topics + versions
  const topics: Topic[] = []
  const versions: TopicVersion[] = []
  SEED_TOPICS.forEach((s, i) => {
    const topicId = `top_seed${i + 1}`
    const from = today - s.daysAgo * DAY
    const base: TopicConfig = { options: [], min: null, max: null, unit: '', ...s.cfg }
    const v1: TopicVersion = { ...base, id: `${topicId}_v1`, topicId, version: 1, createdAt: from, changeNote: 'Topic created' }
    versions.push(v1)
    let current = v1
    if (s.v2) {
      current = { ...base, ...s.v2.patch, id: `${topicId}_v2`, topicId, version: 2, createdAt: today - s.v2.daysAgo * DAY, changeNote: s.v2.note }
      versions.push(current)
    }
    const to = s.disabledDaysAgo ? today - s.disabledDaysAgo * DAY : null
    topics.push({ id: topicId, currentVersionId: current.id, enabled: to === null, activations: [{ from, to }], createdAt: from, deletedAt: null })
  })

  // results: extraction ran right after each session ended, with the version in force at that time
  const results: ExtractionResult[] = []
  for (const session of sessions) {
    for (const topic of topics) {
      if (!isEligible(topic, session)) continue
      const v = versionAt(versions, topic.id, session.endedAt)
      if (!v) continue
      const out = runExtraction(session, v, DEFAULT_SETTINGS, 0, rng)
      results.push({ id: resultId(session.id, topic.id), sessionId: session.id, topicId: topic.id, versionId: v.id, ...out, createdAt: session.endedAt + 20_000, updatedAt: session.endedAt + 20_000 })
    }
  }

  return {
    ...state,
    sessions,
    topics,
    topicVersions: versions,
    results,
    // no default charts: every chart is designed by the user
    runs: [{ id: 'run_seed', at: now, label: 'Demo data loaded', sessions: sessions.length, jobsCreated: results.length, duplicatesSkipped: 0 }],
  }
}
