// ───────────────────────── Domain model ─────────────────────────
// Five separate collections, linked by id:
//   topics          – identity + lifecycle (enabled, activation windows, archived)
//   topicVersions   – immutable configuration snapshots (what the AI was asked)
//   sessions        – completed voice sessions (+ transcript when available)
//   results         – one extraction result per (session, topic), pinned to a version
//   charts          – saved chart configurations

export type TopicType = 'boolean' | 'enum' | 'number' | 'text' | 'multi_select'

export type TopicValue = boolean | string | number | string[] | null

export interface Agent {
  id: string
  name: string
  description: string
}

export interface Turn {
  speaker: 'agent' | 'caller'
  text: string
  /** seconds from call start */
  t: number
  /** topic keys this line is evidence for (mock ground truth) */
  tags?: string[]
}

export interface Session {
  id: string
  agentId: string
  startedAt: number
  endedAt: number
  durationSec: number
  caller: string
  channel: 'phone' | 'web'
  endReason: 'caller_hangup' | 'agent_ended' | 'transferred'
  transcript: Turn[] | null
  /** Mock ground truth the simulated extractor reads from. Never shown in the UI. */
  facts: Record<string, TopicValue>
}

export interface ActivationWindow {
  from: number
  /** null = still active */
  to: number | null
}

export interface Topic {
  id: string
  currentVersionId: string
  enabled: boolean
  /** Sessions are eligible only if they ended inside one of these windows. */
  activations: ActivationWindow[]
  createdAt: number
  /** Soft delete: results and versions are kept. */
  deletedAt: number | null
}

export interface TopicConfig {
  name: string
  key: string
  description: string
  type: TopicType
  /** enum + multi_select */
  options: string[]
  /** number */
  min: number | null
  max: number | null
  unit: string
}

export interface TopicVersion extends TopicConfig {
  id: string
  topicId: string
  version: number
  createdAt: number
  changeNote: string
}

export type ExtractionStatus =
  | 'queued'
  | 'processing'
  | 'success'
  | 'failed'
  | 'invalid'
  | 'no_transcript'

export interface Evidence {
  turnIndex: number
  quote: string
  speaker: 'agent' | 'caller'
}

export interface ExtractionResult {
  /** Idempotency key: `${sessionId}|${topicId}` – a duplicate job can never create a second row. */
  id: string
  sessionId: string
  topicId: string
  versionId: string
  status: ExtractionStatus
  /** null with status "success" means the AI looked and could not tell (unknown) – distinct from false / 0. */
  value: TopicValue
  confidence: number | null
  evidence: Evidence[]
  attempts: number
  error: string | null
  /** what the model returned when status is "invalid" */
  rawValue: string | null
  createdAt: number
  updatedAt: number
}

export type ChartType = 'bar' | 'column' | 'line' | 'area' | 'pie' | 'donut' | 'stacked'
export type Aggregation = 'count' | 'percentage' | 'true_rate' | 'average' | 'sum' | 'min' | 'max'
/** what goes on the category axis */
export type Dimension = 'value' | 'time' | 'agent'

export interface ChartConfig {
  id: string
  title: string
  type: ChartType
  topicId: string
  aggregation: Aggregation
  dimension: Dimension
  /** 'none' | 'agent' | 'value' | `topic:<id>` */
  splitBy: string
  xLabel: string
  yLabel: string
  createdAt: number
  updatedAt: number
}

export interface ExtractionRun {
  id: string
  at: number
  label: string
  sessions: number
  jobsCreated: number
  duplicatesSkipped: number
}

export interface SimSettings {
  /** chance a single extraction attempt fails, 0–1 */
  failureRate: number
  /** chance a new session has no transcript, 0–1 */
  missingTranscriptRate: number
  /** automatic retries after a failed attempt */
  autoRetries: number
}

export interface Filters {
  range: '7d' | '30d' | '90d' | 'all' | 'custom'
  from: string
  to: string
  agentId: string
  status: 'all' | SessionStatus
}

export type SessionStatus = 'complete' | 'attention' | 'no_transcript' | 'processing' | 'not_analysed'

export interface AppState {
  schema: number
  workspace: string
  agents: Agent[]
  sessions: Session[]
  topics: Topic[]
  topicVersions: TopicVersion[]
  results: ExtractionResult[]
  charts: ChartConfig[]
  runs: ExtractionRun[]
  settings: SimSettings
  filters: Filters
}
