import { Component, type ErrorInfo, type ReactNode } from 'react'
import { i18n } from '../i18n'

export type SkeletonVariant = 'poster' | 'list' | 'settings' | 'editor' | 'detail'
export function PageSkeleton({ variant = 'list' }: { variant?: SkeletonVariant }) {
  const rows = variant === 'settings' ? 5 : variant === 'editor' ? 4 : 3
  return (
    <section className={`relative mx-auto min-h-full w-[min(100%,760px)] overflow-hidden ${variant === 'poster' ? 'p-0' : 'px-6 py-9'}`} role="status" aria-label={i18n.t('skeleton.loading')} aria-live="polite">
      <span className="sr-only">{i18n.t('skeleton.loading')}</span>
      {variant === 'poster' ? <div className="absolute inset-0 block rounded-none bg-[linear-gradient(100deg,var(--panel)_20%,#e7e9e3_42%,var(--panel)_64%)] bg-[length:300%_100%] animate-[skeleton-shimmer_1.5s_ease-in-out_infinite] motion-reduce:animate-none" /> : <>
        <div className={`my-5 mb-[34px] block rounded-[14px] bg-[linear-gradient(100deg,var(--panel)_20%,#e7e9e3_42%,var(--panel)_64%)] bg-[length:300%_100%] animate-[skeleton-shimmer_1.5s_ease-in-out_infinite] motion-reduce:animate-none ${variant === 'detail' ? 'h-12 w-[62%]' : 'h-[34px] w-[38%]'}`} />
        {Array.from({ length: rows }, (_, index) => (
          <div className={`my-4 block rounded-[14px] border border-line bg-[linear-gradient(100deg,var(--panel)_20%,#e7e9e3_42%,var(--panel)_64%)] bg-[length:300%_100%] p-[22px] animate-[skeleton-shimmer_1.5s_ease-in-out_infinite] motion-reduce:animate-none ${variant === 'editor' && index === 0 ? 'h-[210px]' : 'h-28'}`} key={index}>
            <i className="mb-[13px] block h-3 w-[55%] rounded-[14px] bg-[#dfe2db]" />
            <i className="mb-[13px] block h-3 w-[82%] rounded-[14px] bg-[#dfe2db]" />
            <i className="block h-3 w-[66%] rounded-[14px] bg-[#dfe2db]" />
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
