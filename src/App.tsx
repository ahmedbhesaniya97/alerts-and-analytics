import { useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AudioLines, ChevronsUpDown, LayoutGrid, Loader2, Menu, PanelLeft, Play } from 'lucide-react'
import { DrillDrawer, SessionDrawer, SimulateModal } from './components/Shared'
import { Button, Toasts } from './components/ui'
import { fmtDateTime } from './lib/analytics'
import { useStore } from './lib/store'
import { useAlerts } from './lib/alertsStore'
import AlertEditor from './pages/AlertEditor'
import Alerts from './pages/Alerts'
import Analytics from './pages/Analytics'
import Sessions from './pages/Sessions'
import Settings from './pages/Settings'

const NAV = [
  { to: '/analytics', label: 'Analytics' },
  { to: '/alerts', label: 'Alerts' },
]

export default function App() {
  const { state, queue, clock } = useStore()
  const { incidents } = useAlerts()
  const openAlerts = incidents.filter((i) => i.status === 'ongoing')
  const critical = openAlerts.some((i) => i.severity === 'critical')
  const [menu, setMenu] = useState(false)
  const [simulate, setSimulate] = useState(false)
  const { pathname } = useLocation()
  const page = NAV.find((n) => pathname.startsWith(n.to))?.label ?? 'Analytics'
  const initials = state.workspace.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'WS'
  const fastForwarded = clock - Date.now() > 60_000

  return (
    <div className="shell">
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <div className="sidebar-inner">
          <div className="brand">
            <span className="brand-mark">
              <AudioLines size={14} />
            </span>
            <PanelLeft size={15} color="var(--ink-3)" />
          </div>
          <div className="switcher">
            <span className="avatar">{initials}</span>
            <div className="grow">
              <div className="name truncate">{state.workspace}</div>
              <div className="sub">Voice agents · {state.agents.length}</div>
            </div>
            <ChevronsUpDown size={14} color="var(--ink-3)" />
          </div>
          <nav>
            <div className="nav-group mono">
              <LayoutGrid size={14} /> Workspace
            </div>
            <div className="nav">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} onClick={() => setMenu(false)} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {n.label}
                  {n.to === '/alerts' && openAlerts.length > 0 && (
                    <span className={`nav-count ${critical ? 'bad' : 'warn'}`} title={`${openAlerts.length} open incident${openAlerts.length === 1 ? '' : 's'}`}>
                      {openAlerts.length}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </nav>
          <div className="sidebar-foot">
            <div className="small muted" style={{ padding: '0 6px' }}>
              Demo workspace. Calls and AI extraction are simulated in your browser.
            </div>
            <div className="switcher">
              <span className="avatar">JD</span>
              <div className="grow">
                <div className="name">John Doe</div>
                <div className="sub">Owner</div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="crumbs mono">
            <Button className="menu-btn" icon onClick={() => setMenu(true)} aria-label="Open menu">
              <Menu size={14} />
            </Button>
            <span className="hide-sm">{state.workspace}</span>
            <span className="sep hide-sm">▶</span>
            <span className="faint">{page}</span>
          </div>
          <div className="row">
            {queue ? (
              <span className="row small muted" aria-live="polite">
                <Loader2 size={13} className="spin" />
                Extracting {queue.done} of {queue.total}
                <span className="progress hide-sm" style={{ width: 90, marginTop: 0 }}>
                  <i style={{ width: `${(queue.done / queue.total) * 100}%` }} />
                </span>
              </span>
            ) : (
              fastForwarded && (
                <span className="small faint hide-sm" title="Simulated calls moved the demo clock forward">
                  Demo clock · {fmtDateTime(clock)}
                </span>
              )
            )}
            <Button variant="primary" onClick={() => setSimulate(true)} disabled={!!queue}>
              <Play size={11} fill="currentColor" /> Simulate calls
            </Button>
          </div>
        </div>

        <Routes>
          <Route path="/analytics" element={<Analytics onSimulate={() => setSimulate(true)} />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/alerts/new" element={<AlertEditor />} />
          <Route path="/alerts/:id" element={<AlertEditor />} />
          <Route path="/sessions" element={<Sessions onSimulate={() => setSimulate(true)} />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/analytics" replace />} />
        </Routes>
      </main>

      <DrillDrawer />
      <SessionDrawer />
      {simulate && <SimulateModal onClose={() => setSimulate(false)} />}
      <Toasts />
    </div>
  )
}
