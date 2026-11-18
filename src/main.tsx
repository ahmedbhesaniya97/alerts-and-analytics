import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AlertsProvider } from './lib/alertsStore'
import { StoreProvider } from './lib/store'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <StoreProvider>
        <AlertsProvider>
          <App />
        </AlertsProvider>
      </StoreProvider>
    </HashRouter>
  </StrictMode>,
)
