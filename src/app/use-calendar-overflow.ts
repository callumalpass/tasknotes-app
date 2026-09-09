import { useEffect, useRef, type RefObject } from "react";
import { registerOverlay } from "../components/overlays/overlay-stack";

/** Bridge FullCalendar's imperative popover into the application's overlay owner. */
export function useCalendarOverflow(rootRef: RefObject<HTMLElement | null>) {
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let popup: HTMLElement | null = null;
    let release: ReturnType<typeof registerOverlay> | undefined;
    let closeButton: HTMLElement | null = null;
    const close = () => closeButton?.click();
    const activateClose = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        close();
      }
    };
    const detach = (restore = true) => {
      release?.(restore);
      release = undefined;
      closeButton?.removeEventListener("keydown", activateClose);
    };
    closeRef.current = () => {
      detach(false);
      close();
    };
    const synchronize = () => {
      const next = root.querySelector<HTMLElement>(".fc-more-popover");
      if (next === popup) return;
      detach();
      popup = next;
      closeButton =
        popup?.querySelector<HTMLElement>(".fc-popover-close") ?? null;
      if (!popup) return;
      popup.setAttribute("role", "dialog");
      if (!popup.hasAttribute("aria-labelledby"))
        popup.setAttribute(
          "aria-label",
          `Tasks for ${popup.querySelector(".fc-popover-title")?.textContent ?? "selected day"}`,
        );
      closeButton?.setAttribute("role", "button");
      closeButton?.setAttribute("aria-label", "Close additional tasks");
      if (closeButton) closeButton.tabIndex = 0;
      closeButton?.addEventListener("keydown", activateClose);
      release = registerOverlay({
        root: popup,
        modal: false,
        dismissOnTab: "boundary",
        dismiss: close,
        returnFocus: root.querySelector<HTMLElement>(
          '.fc-more-link[aria-expanded="true"]',
        ),
        initialFocus: () =>
          popup?.querySelector<HTMLElement>(
            '.full-calendar-event-content[role="button"]',
          ) ?? closeButton,
      });
    };
    const observer = new MutationObserver(synchronize);
    observer.observe(root, { childList: true, subtree: true });
    synchronize();
    return () => {
      observer.disconnect();
      detach(false);
      closeRef.current = () => {};
    };
  }, [rootRef]);
  // Navigation owns its new focus; don't restore the calendar trigger over it.
  return () => closeRef.current();
}
