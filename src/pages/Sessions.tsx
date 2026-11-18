import { useMemo, useState } from 'react'
import { PhoneOff, Search, SearchX } from 'lucide-react'
import { FilterBar, SessionTable } from '../components/Shared'
import { Button, Empty } from '../components/ui'
import { filterSessions, rangeLabel } from '../lib/analytics'
import { DEFAULT_FILTERS } from '../lib/seed'
import { useStore } from '../lib/store'

export default function Sessions({ onSimulate }: { onSimulate: () => void }) {
  const { state, index, clock, setFilters } = useStore()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterSessions(state, index, clock), [state, index, clock])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? filtered.filter((s) => s.id.includes(q) || s.caller.toLowerCase().includes(q) || (index.agentById.get(s.agentId)?.name.toLowerCase().includes(q) ?? false) || (s.transcript?.some((t) => t.text.toLowerCase().includes(q)) ?? false))
      : filtered
    return [...list].sort((a, b) => b.endedAt - a.endedAt)
  }, [filtered, query, index])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p>Every finished call, newest first. Open one to see what the AI extracted, how confident it was, and the exact words it relied on.</p>
        </div>
      </div>

      <FilterBar />
      <div className="row" style={{ marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 380 }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--ink-3)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Search caller, call ID, agent or words said…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search calls" />
        </div>
        <span className="small muted">
          {rows.length.toLocaleString()} call{rows.length === 1 ? '' : 's'} · {rangeLabel(state.filters)}
        </span>
      </div>

      <div className="card">
        {state.sessions.length === 0 ? (
          <Empty icon={<PhoneOff size={18} />} title="No calls yet" actions={<Button variant="primary" onClick={onSimulate}>Simulate calls</Button>}>
            Finished calls appear here. Simulate a batch to see how extraction works.
          </Empty>
        ) : rows.length === 0 ? (
          <Empty
            icon={<SearchX size={18} />}
            title="No calls match"
            actions={
              <Button
                onClick={() => {
                  setQuery('')
                  setFilters({ ...DEFAULT_FILTERS, range: 'all' })
                }}
              >
                Clear search and filters
              </Button>
            }
          >
            Try a wider date range, a different agent or a shorter search.
          </Empty>
        ) : (
          <SessionTable key={`${query}|${JSON.stringify(state.filters)}`} sessions={rows} pageSize={25} />
        )}
      </div>
    </>
  )
}
