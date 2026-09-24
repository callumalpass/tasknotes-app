import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

const DECIDE_DISTANCE = 10;
const ACTION_DISTANCE = 88;

export type SwipeDirection = "complete" | "actions";

/**
 * Touch-only row gestures: swipe right to complete, swipe left to open the
 * row's actions. Buttons keep every action available without gestures.
 * Vertical scrolling stays native; rows inside a horizontally scrolling
 * board never claim horizontal movement.
 */
export function useSwipeActions({
  disabled,
  onSwipe,
}: {
  disabled: boolean;
  onSwipe(direction: SwipeDirection): void;
}) {
  const start = useRef<{
    id: number;
    x: number;
    y: number;
    swiping: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);

  function reset() {
    start.current = null;
    setOffset(0);
  }

  return {
    offset,
    direction:
      offset >= ACTION_DISTANCE
        ? ("complete" as const)
        : offset <= -ACTION_DISTANCE
          ? ("actions" as const)
          : undefined,
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (
          disabled ||
          event.pointerType !== "touch" ||
          (event.target as HTMLElement).closest(
            ".kanban-board, button.manual-order-handle, input, textarea",
          )
        )
          return;
        start.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          swiping: false,
        };
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const current = start.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (!current.swiping) {
          if (Math.abs(dy) > DECIDE_DISTANCE) return reset();
          if (
            Math.abs(dx) < DECIDE_DISTANCE ||
            Math.abs(dx) < Math.abs(dy) * 1.5
          )
            return;
          current.swiping = true;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* Movement still arrives through the row without capture. */
          }
        }
        setOffset(Math.max(-140, Math.min(140, dx)));
      },
      onPointerUp(event: ReactPointerEvent<HTMLElement>) {
        const current = start.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const swiped = current.swiping;
        reset();
        if (!swiped) return;
        if (dx >= ACTION_DISTANCE) onSwipe("complete");
        else if (dx <= -ACTION_DISTANCE) onSwipe("actions");
        // A swipe is not also a tap on whatever sits under the finger.
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
      },
      onPointerCancel: reset,
      onClickCapture(event: ReactMouseEvent<HTMLElement>) {
        if (!suppressClick.current) return;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
}
