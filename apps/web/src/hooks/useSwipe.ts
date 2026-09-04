import { useRef, useState, type PointerEvent } from 'react'
export function useSwipe(onSwipe: (direction: 'left' | 'right') => void) {
  const start = useRef<{ x: number; y: number; axis?: 'x' | 'y' } | undefined>(undefined)
  const [offset, setOffset] = useState(0)
  const finish = () => { start.current = undefined; setOffset(0) }
  return {
    offset,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button,a,input,textarea,select,summary')) return
        start.current = { x: event.clientX, y: event.clientY }
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const point = start.current
        if (!point) return
        const dx = event.clientX - point.x, dy = event.clientY - point.y
        if (!point.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 12) point.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
        if (point.axis === 'x') {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setOffset(dx * .6)
        }
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const point = start.current
        if (point?.axis === 'x' && Math.abs(event.clientX - point.x) > 65) onSwipe(event.clientX < point.x ? 'left' : 'right')
        finish()
      },
      onPointerCancel: finish,
    },
  }
}
