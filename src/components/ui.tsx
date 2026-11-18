import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react'
import type { ExtractionStatus, SessionStatus } from '../types'
import { STATUS_LABEL } from '../lib/analytics'
import { useStore } from '../lib/store'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; danger?: boolean; icon?: boolean; lg?: boolean }
export function Button({ variant = 'secondary', danger, icon, lg, className = '', type = 'button', ...rest }: BtnProps) {
  const cls = ['btn', variant === 'primary' ? 'primary' : variant === 'ghost' ? 'ghost' : '', danger ? 'danger' : '', icon ? 'icon' : '', lg ? 'lg' : '', className].filter(Boolean).join(' ')
  return <button type={type} className={cls} {...rest} />
}

export function Badge({ tone = '', children, title }: { tone?: 'good' | 'warn' | 'bad' | 'info' | 'outline' | ''; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  )
}

const RESULT_TONE: Record<ExtractionStatus, { tone: 'good' | 'warn' | 'bad' | 'info' | ''; label: string }> = {
  success: { tone: 'good', label: 'Extracted' },
  failed: { tone: 'bad', label: 'Failed' },
  invalid: { tone: 'warn', label: 'Invalid value' },
  no_transcript: { tone: '', label: 'No transcript' },
  queued: { tone: 'info', label: 'Queued' },
  processing: { tone: 'info', label: 'Processing' },
}
export function ResultBadge({ status, unknown }: { status: ExtractionStatus; unknown?: boolean }) {
  const s = RESULT_TONE[status]
  if (status === 'success' && unknown) return <Badge tone="outline">Unknown</Badge>
  return (
    <Badge tone={s.tone}>
      {(status === 'queued' || status === 'processing') && <Loader2 size={10} className="spin" />}
      {s.label}
    </Badge>
  )
}

const SESSION_TONE: Record<SessionStatus, 'good' | 'warn' | 'bad' | 'info' | ''> = { complete: 'good', attention: 'warn', no_transcript: '', processing: 'info', not_analysed: '' }
export function SessionBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge tone={SESSION_TONE[status]}>
      {status === 'processing' && <Loader2 size={10} className="spin" />}
      {STATUS_LABEL[status]}
    </Badge>
  )
}

export function Confidence({ value }: { value: number | null }) {
  if (value === null) return <span className="faint small">—</span>
  return (
    <span className="conf" title={`The AI is ${Math.round(value * 100)}% confident in this value`}>
      <span className="track">
        <i style={{ width: `${value * 100}%`, background: value < 0.6 ? '#c9820a' : undefined }} />
      </span>
      {Math.round(value * 100)}%
    </span>
  )
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} disabled={disabled} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? (
        <span className="err">
          <AlertCircle size={12} /> {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  )
}

export function Empty({ icon, title, children, actions }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico">{icon}</div>
      <h4>{title}</h4>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  )
}

export function Callout({ tone = '', children }: { tone?: 'warn' | 'bad' | ''; children: ReactNode }) {
  return (
    <div className={`callout ${tone}`}>
      {tone === 'bad' ? <AlertCircle size={15} /> : <Info size={15} />}
      <div>{children}</div>
    </div>
  )
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
}

export function Modal({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose)
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ov-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <Button variant="ghost" icon onClick={onClose} aria-label="Close">
            <X size={15} />
          </Button>
        </div>
        <div className="ov-body">{children}</div>
        {footer && <div className="ov-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Drawer({ title, subtitle, onClose, children, footer, wide, xl, headerExtra }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; xl?: boolean; headerExtra?: ReactNode }) {
  useEscape(onClose)
  return (
    <div className="overlay right" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`drawer ${xl ? 'xl' : wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="ov-head">
          <div className="grow">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {headerExtra}
          <Button variant="ghost" icon onClick={onClose} aria-label="Close">
            <X size={15} />
          </Button>
        </div>
        <div className="ov-body">{children}</div>
        {footer && <div className="ov-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Confirm({ title, body, confirmLabel, onConfirm, onClose, danger }: { title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void; danger?: boolean }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            danger={danger}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack muted">{body}</div>
    </Modal>
  )
}

export function Toasts() {
  const { toasts, dismissToast } = useStore()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.kind === 'success' ? <CheckCircle2 size={15} color="#7ee2a0" /> : t.kind === 'error' ? <AlertCircle size={15} color="#ff9b94" /> : <Info size={15} color="#9cc5ff" />}
          <span>{t.message}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
