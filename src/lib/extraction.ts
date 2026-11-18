import type { Evidence, ExtractionResult, Session, SimSettings, Topic, TopicValue, TopicVersion } from '../types'
import { hash01 } from './mock'

// ─────────────────────────────────────────────────────────────────
// Simulated post-call extraction.
// In production this module is the only thing that changes: replace
// `runExtraction` with a call to the real extraction API. Everything
// else (eligibility, idempotency, versioning, retries) stays as is.
// ─────────────────────────────────────────────────────────────────

/** A topic applies to a session only if the session ENDED while the topic was active. Never retroactive. */
export function isEligible(topic: Topic, session: Session): boolean {
  return topic.activations.some((w) => session.endedAt >= w.from && (w.to === null || session.endedAt < w.to))
}

export const resultId = (sessionId: string, topicId: string) => `${sessionId}|${topicId}`

const ERRORS = ['The AI model timed out before answering.', 'The extraction service was rate limited.', 'The AI model returned an empty response.']

type Outcome = Pick<ExtractionResult, 'status' | 'value' | 'confidence' | 'evidence' | 'attempts' | 'error' | 'rawValue'>

function synthesize(session: Session, v: TopicVersion): TopicValue {
  const h = (salt: string) => hash01(`${session.id}:${v.key}:${salt}`)
  const hasFact = Object.prototype.hasOwnProperty.call(session.facts, v.key)
  const fact = hasFact ? session.facts[v.key] : undefined

  if (hasFact && fact === null) return null
  // The AI occasionally cannot tell → unknown (null), which is not the same as false or 0.
  if (v.type !== 'text' && h('unknown') < (hasFact ? 0.03 : 0.08)) return null

  switch (v.type) {
    case 'boolean':
      if (typeof fact === 'boolean') return fact
      return h('v') < 0.25 + 0.5 * hash01(`base:${v.key}`)
    case 'enum': {
      if (!v.options.length) return null
      if (typeof fact === 'string' && v.options.includes(fact)) return fact
      // skewed pick so distributions are not flat
      const idx = Math.floor(Math.pow(h('v'), 1.6) * v.options.length)
      return v.options[Math.min(idx, v.options.length - 1)]
    }
    case 'multi_select': {
      if (Array.isArray(fact)) return fact.filter((x) => v.options.includes(x))
      return v.options.filter((o, i) => h(`o:${o}`) < 0.42 - i * 0.04)
    }
    case 'number': {
      const min = v.min ?? 0
      const max = v.max ?? Math.max(min + 10, 10)
      if (typeof fact === 'number') return Math.min(max, Math.max(min, fact))
      const raw = min + (h('v') + h('v2')) / 2 * (max - min)
      return max - min > 5 ? Math.round(raw) : Math.round(raw * 10) / 10
    }
    case 'text': {
      if (typeof fact === 'string') return fact
      const summary = session.facts.call_summary
      if (h('unknown') < 0.06) return null
      return typeof summary === 'string' ? summary : 'The caller discussed their request with the agent.'
    }
  }
}

function findEvidence(session: Session, v: TopicVersion, value: TopicValue): Evidence[] {
  const turns = session.transcript ?? []
  if (value === null || !turns.length) return []
  let idx = turns.map((t, i) => (t.tags?.includes(v.key) ? i : -1)).filter((i) => i >= 0)
  if (!idx.length) {
    const callerTurns = turns.map((t, i) => (t.speaker === 'caller' ? i : -1)).filter((i) => i >= 0)
    if (!callerTurns.length) return []
    const first = callerTurns[Math.floor(hash01(`${session.id}:${v.key}:e1`) * callerTurns.length)]
    idx = [first]
    if (v.type === 'text' && callerTurns.length > 1) idx = [...new Set([callerTurns[0], first])]
  }
  return idx.slice(0, 2).map((i) => ({ turnIndex: i, quote: turns[i].text, speaker: turns[i].speaker }))
}

/**
 * Runs one extraction job (with automatic retries on the first run).
 * `prevAttempts > 0` means a manual retry of a job that failed earlier.
 */
export function runExtraction(session: Session, v: TopicVersion, settings: SimSettings, prevAttempts: number, rand: () => number = Math.random): Outcome {
  if (!session.transcript) {
    return { status: 'no_transcript', value: null, confidence: null, evidence: [], attempts: prevAttempts, error: 'No transcript was recorded for this call, so there was nothing to analyse.', rawValue: null }
  }
  const isRetry = prevAttempts > 0
  const tries = isRetry ? 1 : 1 + settings.autoRetries
  const failP = isRetry ? settings.failureRate * 0.5 : settings.failureRate
  let attempts = prevAttempts
  let ok = false
  for (let i = 0; i < tries; i++) {
    attempts += 1
    if (rand() >= failP) {
      ok = true
      break
    }
  }
  if (!ok) {
    return { status: 'failed', value: null, confidence: null, evidence: [], attempts, error: ERRORS[Math.floor(rand() * ERRORS.length)], rawValue: null }
  }

  // The model answered, but with something that does not fit the topic's data type.
  if (!isRetry && v.type !== 'text' && rand() < settings.failureRate * 0.2) {
    const raw = v.type === 'number' ? 'a few' : v.type === 'boolean' ? 'maybe' : 'other'
    const expected =
      v.type === 'number' ? 'a number' : v.type === 'boolean' ? 'true or false' : `one of: ${v.options.join(', ')}`
    return { status: 'invalid', value: null, confidence: null, evidence: [], attempts, error: `The AI answered “${raw}”, but this topic expects ${expected}. The value was discarded.`, rawValue: raw }
  }

  const value = synthesize(session, v)
  const h = hash01(`${session.id}:${v.key}:conf`)
  const confidence = value === null ? 0.34 + h * 0.28 : h < 0.12 ? 0.52 + h * 1.4 : 0.74 + h * 0.25
  return { status: 'success', value, confidence: Math.round(confidence * 100) / 100, evidence: findEvidence(session, v, value), attempts, error: null, rawValue: null }
}
