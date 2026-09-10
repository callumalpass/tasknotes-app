import { useLayoutEffect, useRef, type RefObject } from "react";
import { registerOverlay } from "./overlay-stack";

export function useOverlay({
  open,
  rootRef,
  modal = false,
  dismissOnTab,
  onDismiss,
  initialFocus,
  returnFocusRef,
}: {
  open: boolean;
  rootRef: RefObject<HTMLElement | null>;
  modal?: boolean;
  dismissOnTab?: "always" | "boundary";
  onDismiss(reason: "escape" | "outside"): void;
  initialFocus?(): HTMLElement | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const callbacks = useRef({ onDismiss, initialFocus });
  useLayoutEffect(() => {
    callbacks.current = { onDismiss, initialFocus };
  });
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    return registerOverlay({
      root: rootRef.current,
      modal,
      dismissOnTab,
      dismiss: (reason) => callbacks.current.onDismiss(reason),
      initialFocus: () => callbacks.current.initialFocus?.() ?? null,
      returnFocus: returnFocusRef?.current,
    });
  }, [open, modal, dismissOnTab, rootRef, returnFocusRef]);
}
