import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ')

/** Stateless display primitives; feed and profile state lives in the web features. */
export function Poster(props: HTMLAttributes<HTMLElement>) { return <article {...props} /> }
export function Countdown(props: HTMLAttributes<HTMLParagraphElement>) { return <p {...props} /> }
export function TagChip(props: HTMLAttributes<HTMLSpanElement>) { return <span {...props} /> }
export function SegmentedControl(props: HTMLAttributes<HTMLElement>) { return <nav {...props} /> }
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ type = 'button', ...props }, ref) => <button ref={ref} type={type} {...props} />,
)
IconButton.displayName = 'IconButton'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cx(
        'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-950 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cx(
        'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-950 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100',
        className,
      )}
      {...props}
    />
  ),
)
TextArea.displayName = 'TextArea'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm', className)} {...props} />
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('inline-flex rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800', className)} {...props} />
}

export function Spinner({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className={cx('inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      {...props}
    />
  )
}

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'info' | 'success' | 'error'
}

export function Alert({ tone = 'info', className, ...props }: AlertProps) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900',
  }
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-xl border p-3 text-sm', tones[tone], className)} {...props} />
}
