import type { Agent, Session, TopicValue, Turn } from '../types'

// ───────────── deterministic helpers ─────────────
export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
export const hash01 = (str: string) => mulberry32(hash(str))()

const pick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)]
const chance = (rng: Rng, p: number) => rng() < p

let idCounter = 0
export function uid(prefix: string): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

// ───────────── agents ─────────────
export const AGENTS: Agent[] = [
  { id: 'agt_booker', name: 'Appointment Booker', description: 'Inbound · books and moves appointments' },
  { id: 'agt_afterhours', name: 'After-hours Line', description: 'Inbound · nights and weekends' },
  { id: 'agt_reminder', name: 'Reminder Caller', description: 'Outbound · confirms upcoming visits' },
]

// ───────────── session + transcript generator ─────────────
const SERVICES = ['cleaning', 'checkup', 'whitening', 'braces', 'emergency']
const NAMES = ['Maria', 'James', 'Priya', 'Tom', 'Aisha', 'Daniel', 'Sofia', 'Kenji', 'Olivia', 'Marcus', 'Elena', 'Noah']
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const TIMES = ['9:00 am', '10:30 am', '11:15 am', '1:00 pm', '2:45 pm', '4:30 pm']

type Intent = 'book' | 'reschedule' | 'cancel' | 'question' | 'emergency'

interface Draft {
  turns: Turn[]
  t: number
}
function say(d: Draft, speaker: Turn['speaker'], text: string, rng: Rng, tags?: string[]) {
  d.t += 3 + Math.floor(rng() * 9) + Math.floor(text.length / 14)
  d.turns.push({ speaker, text, t: d.t, ...(tags ? { tags } : {}) })
}

export function makeSession(rng: Rng, agent: Agent, endedAt: number, missingTranscriptRate: number, seq: number): Session {
  const outbound = agent.id === 'agt_reminder'
  const afterHours = agent.id === 'agt_afterhours'

  const intent: Intent = outbound
    ? pick(rng, ['reschedule', 'reschedule', 'cancel', 'question', 'book'] as Intent[])
    : afterHours
      ? pick(rng, ['book', 'book', 'emergency', 'emergency', 'question', 'cancel'] as Intent[])
      : pick(rng, ['book', 'book', 'book', 'book', 'reschedule', 'cancel', 'question', 'question', 'emergency'] as Intent[])

  const name = pick(rng, NAMES)
  const service = intent === 'emergency' ? 'emergency' : pick(rng, SERVICES.slice(0, 4))
  const extraService = chance(rng, 0.28) ? pick(rng, SERVICES.slice(0, 4).filter((s) => s !== service)) : null
  const day = pick(rng, DAYS)
  const time = pick(rng, TIMES)
  const days = 1 + Math.floor(rng() * rng() * 21)

  const bookProb = { book: afterHours ? 0.55 : 0.8, reschedule: 0.85, emergency: 0.65, cancel: 0, question: 0.08 }[intent]
  const booked = chance(rng, bookProb)
  const sentimentRoll = rng() + (booked ? 0.18 : -0.12) + (intent === 'emergency' ? -0.1 : 0)
  const sentiment = sentimentRoll > 0.62 ? 'positive' : sentimentRoll > 0.24 ? 'neutral' : 'negative'
  const handoff = chance(rng, sentiment === 'negative' ? 0.38 : intent === 'emergency' ? 0.25 : 0.06)
  const online = booked && intent !== 'emergency' && chance(rng, 0.32)
  const insurance = chance(rng, 0.3)

  const d: Draft = { turns: [], t: 0 }
  const A = (text: string, tags?: string[]) => say(d, 'agent', text, rng, tags)
  const C = (text: string, tags?: string[]) => say(d, 'caller', text, rng, tags)

  if (outbound) {
    A(`Hi ${name}, this is the assistant from Acme Dental calling about your upcoming visit. Is now a good time?`)
    C(pick(rng, ['Sure, go ahead.', 'Yes, I have a minute.', 'Okay, what is it about?']))
  } else {
    A(pick(rng, ['Thanks for calling Acme Dental. How can I help you today?', 'Acme Dental, this is the virtual assistant. What can I do for you?']))
  }

  switch (intent) {
    case 'book':
      C(pick(rng, [`Hi, I'd like to book a ${service}.`, `I need to schedule a ${service} appointment please.`, `Can I get an appointment for a ${service}?`]), ['services_discussed'])
      break
    case 'reschedule':
      C(pick(rng, [`I need to move my ${service} appointment.`, `Something came up — can we reschedule my ${service}?`]), ['services_discussed'])
      break
    case 'cancel':
      C(pick(rng, [`I have to cancel my ${service} appointment.`, `Please cancel my ${service} visit, I can't make it.`]), ['services_discussed', 'is_booked'])
      break
    case 'question':
      C(pick(rng, [`Quick question — how much is a ${service}?`, `Do you offer ${service} on Saturdays?`, `How long does a ${service} usually take?`]), ['services_discussed'])
      break
    case 'emergency':
      C(pick(rng, ['I chipped a tooth and it really hurts. Can someone see me today?', "I'm in a lot of pain, one of my fillings fell out."]), ['services_discussed', 'caller_sentiment'])
      break
  }

  if (extraService) {
    A('Of course. Is there anything else you would like us to look at during the visit?')
    C(`Yes, I've also been thinking about ${extraService}.`, ['services_discussed'])
  }
  if (insurance) {
    C(pick(rng, ['Do you take Delta Dental?', 'Will my insurance cover this?', 'I have Cigna — is that accepted?']), ['insurance_mentioned'])
    A('We work with most major insurers, and the front desk will confirm your coverage before the visit.', ['insurance_mentioned'])
  }

  if (intent === 'question' && !booked) {
    A('Happy to help. Pricing depends on the exam, but most visits take about 45 minutes. Would you like me to book one?')
    C(pick(rng, ["Not right now, I'll call back.", 'No thanks, just checking for now.']), ['is_booked'])
  } else if (intent === 'cancel') {
    A('No problem, I have cancelled that for you. Would you like to pick a new date?')
    C(pick(rng, ['Not yet, I will call back later.', "No, that's all for now."]), ['is_booked'])
  } else {
    A(
      online
        ? `I can offer a video consultation on ${day} at ${time}, or an in-clinic slot later that week. Which do you prefer?`
        : `The next in-clinic opening is ${day} at ${time}, that's ${days} day${days === 1 ? '' : 's'} from now. Does that work?`,
      ['days_until_appointment'],
    )
    if (booked) {
      C(online ? 'The video call works better for me.' : pick(rng, ['Yes, that works.', 'Perfect, I will take it.', `${day} is fine.`]), ['type_of_booking', 'is_booked'])
      A(
        online
          ? `Great — your online consultation is booked for ${day} at ${time}, ${days} day${days === 1 ? '' : 's'} from today. You will get a link by text.`
          : `You're all set. I've booked you in at the clinic for ${day} at ${time}.`,
        ['is_booked', 'type_of_booking', 'days_until_appointment'],
      )
    } else {
      C(pick(rng, ["That doesn't work for me. I'll have to think about it.", "Hmm, nothing sooner? I'll try somewhere else.", 'Let me check my calendar and call back.']), ['is_booked', 'caller_sentiment'])
      A("I understand. We'll be here whenever you're ready.", ['is_booked'])
    }
  }

  if (handoff) {
    C(pick(rng, ['Can I just talk to a real person, please?', "I'd rather speak with someone at the front desk.", 'Is there a human I can talk to?']), ['is_handed_to_person', 'caller_sentiment'])
    A('Of course — let me transfer you to our front desk team now.', ['is_handed_to_person'])
  } else {
    A('Is there anything else I can help you with?')
    C(
      sentiment === 'positive'
        ? pick(rng, ["No, that's great. Thanks so much!", 'That was easy, thank you!'])
        : sentiment === 'neutral'
          ? pick(rng, ["No, that's it.", 'That is all, bye.'])
          : pick(rng, ['No. This took way too long.', 'No, honestly this was frustrating.']),
      ['caller_sentiment'],
    )
    A('Thanks for calling Acme Dental. Take care!')
  }

  const durationSec = d.t + 6 + Math.floor(rng() * 20)
  const services = [service, ...(extraService ? [extraService] : [])]
  const summary =
    intent === 'cancel'
      ? `${name} cancelled a ${service} appointment and did not rebook.`
      : intent === 'question' && !booked
        ? `${name} asked a question about ${service} and did not book.`
        : booked
          ? `${name} ${intent === 'reschedule' ? 'moved' : 'booked'} a ${service} ${online ? 'video consultation' : 'clinic visit'} for ${day} at ${time}${handoff ? ', then asked for a person' : ''}.`
          : `${name} wanted a ${service} appointment but no slot worked${handoff ? ' and was transferred to the front desk' : ''}.`

  const facts: Record<string, TopicValue> = {
    is_booked: booked,
    type_of_booking: booked ? (online ? 'online' : 'offline') : null,
    is_handed_to_person: handoff,
    caller_sentiment: sentiment,
    services_discussed: services,
    days_until_appointment: booked ? days : null,
    call_summary: summary,
    insurance_mentioned: insurance,
  }

  return {
    id: `ses_${(100000 + seq).toString(36)}${Math.floor(rng() * 46656).toString(36).padStart(3, '0')}`,
    agentId: agent.id,
    startedAt: endedAt - durationSec * 1000,
    endedAt,
    durationSec,
    caller: `+1 (415) 555-${String(Math.floor(rng() * 10000)).padStart(4, '0')}`,
    channel: chance(rng, 0.85) ? 'phone' : 'web',
    endReason: handoff ? 'transferred' : chance(rng, 0.6) ? 'caller_hangup' : 'agent_ended',
    transcript: chance(rng, missingTranscriptRate) ? null : d.turns,
    facts,
  }
}

/** Weighted towards business hours so the daily pattern looks real. */
export function randomTimeInDay(rng: Rng, dayStart: number): number {
  const hour = 8 + Math.floor((rng() + rng()) * 5.5) // 8 → 19, peaked mid-day
  return dayStart + hour * 3600_000 + Math.floor(rng() * 3600_000)
}
