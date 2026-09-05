import {
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'

type SwipeDirection = 'left' | 'right'

export function useSwipe(
  onSwipe: (direction: SwipeDirection) => void,
  enabled: Record<SwipeDirection, boolean> = { left: true, right: true },
) {
  const start = useRef<
    | {
        x: number
        y: number
        lastX: number
        lastAt: number
        velocityX: number
        axis?: 'x' | 'y'
      }
    | undefined
  >(undefined)
  const suppressClick = useRef(false)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const finish = () => {
    start.current = undefined
    setOffset(0)
    setDragging(false)
  }
  return {
    offset,
    dragging,
    handlers: {
      onPointerDownCapture(event: PointerEvent<HTMLElement>) {
        if (!event.isPrimary || event.button !== 0) return
        const at = performance.now()
        suppressClick.current = false
        start.current = {
          x: event.clientX,
          y: event.clientY,
          lastX: event.clientX,
          lastAt: at,
          velocityX: 0,
        }
      },
      onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
        const point = start.current
        if (!point) return
        const dx = event.clientX - point.x,
          dy = event.clientY - point.y,
          now = performance.now(),
          elapsed = now - point.lastAt
        if (elapsed > 0) point.velocityX = (event.clientX - point.lastX) / elapsed
        point.lastX = event.clientX
        point.lastAt = now
        if (!point.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
          if (Math.abs(dx) > Math.abs(dy) * 1.15) point.axis = 'x'
          else if (Math.abs(dy) > Math.abs(dx) * 1.15) point.axis = 'y'
        }
        if (point.axis === 'x') {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          suppressClick.current = true
          setDragging(true)
          const direction: SwipeDirection = dx < 0 ? 'left' : 'right'
          const distance = enabled[direction] ? dx : dx * 0.18
          setOffset(
            Math.max(
              -event.currentTarget.clientWidth,
              Math.min(event.currentTarget.clientWidth, distance),
            ),
          )
        }
      },
      onPointerUpCapture(event: PointerEvent<HTMLElement>) {
        const point = start.current
        if (point?.axis === 'x') {
          const dx = point.lastX - point.x
          const direction: SwipeDirection = dx < 0 ? 'left' : 'right'
          const threshold = Math.min(96, event.currentTarget.clientWidth * 0.2)
          if (
            enabled[direction] &&
            (Math.abs(dx) >= threshold ||
              (Math.abs(dx) >= 24 && Math.abs(point.velocityX) >= 0.5))
          )
            onSwipe(direction)
          setTimeout(() => {
            suppressClick.current = false
          })
        }
        finish()
      },
      onPointerCancelCapture() {
        suppressClick.current = false
        finish()
      },
      onDragStartCapture(event: DragEvent<HTMLElement>) {
        event.preventDefault()
      },
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (!suppressClick.current) return
        event.preventDefault()
        event.stopPropagation()
        suppressClick.current = false
      },
    },
  }
}
