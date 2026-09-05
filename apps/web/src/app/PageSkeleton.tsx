import { Component, type ErrorInfo, type ReactNode } from 'react'
import { i18n } from '../i18n'

export type SkeletonVariant = 'poster' | 'list' | 'settings' | 'editor' | 'detail'
export function PageSkeleton({ variant = 'list' }: { variant?: SkeletonVariant }) {
  const rows = variant === 'settings' ? 5 : variant === 'editor' ? 4 : 3
  return (
    <section className={`page-skeleton skeleton-${variant}`} role="status" aria-label={i18n.t('skeleton.loading')} aria-live="polite">
      <span className="sr-only">{i18n.t('skeleton.loading')}</span>
      {variant === 'poster' ? <div className="skeleton-poster" /> : <>
        <div className="skeleton-title" />
        {Array.from({ length: rows }, (_, index) => (
          <div className="skeleton-block" key={index}>
            <i /><i /><i />
          </div>
        ))}
      </>}
    </section>
  )
}

export class PageLoadBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  componentDidCatch(_error: unknown, _info: ErrorInfo) { /* Retry is user controlled. */ }
  render() {
    if (this.state.error) return <div className="empty-view" role="alert">
      <p>{i18n.t('skeleton.failed')}</p>
      <button className="primary-link" onClick={() => window.location.reload()}>{i18n.t('messages.retry')}</button>
    </div>
    return this.props.children
  }
}
