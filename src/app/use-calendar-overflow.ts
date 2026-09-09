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
      if (next === popup) {
        if (popup) fitCalendarPopup(popup);
        return;
      }
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
      fitCalendarPopup(popup);
      release = registerOverlay({
        root: popup,
        modal: false,
        dismissOnTab: "boundary",
        dismissOnCover: true,
        inertRoots: [
          ...(popup.parentElement?.querySelectorAll<HTMLElement>(
            ":scope > .fc-view",
          ) ?? []),
        ],
        dismiss: (reason) => {
          detach(reason === "escape");
          // FullCalendar reconciles React event content; don't close it inside
          // another overlay's layout effect.
          queueMicrotask(close);
        },
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
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("resize", close);
      observer.disconnect();
      detach(false);
      closeRef.current = () => {};
    };
  }, [rootRef]);
  // Navigation owns its new focus; don't restore the calendar trigger over it.
  return () => closeRef.current();
}

function fitCalendarPopup(popup: HTMLElement) {
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const height = viewport?.height ?? window.innerHeight;
  const navigation = document
    .querySelector(".bottom-navigation")
    ?.getBoundingClientRect();
  const surface = popup
    .closest(".full-calendar-surface")
    ?.getBoundingClientRect();
  const upper = Math.max(top + 12, surface?.top ?? top + 12);
  const bottom =
    Math.min(
      top + height,
      navigation?.height ? navigation.top : top + height,
      surface?.bottom ?? Infinity,
    ) - 12;
  const left = Math.max(12, surface?.left ?? 12);
  const right = Math.min(
    window.innerWidth - 12,
    surface?.right ?? window.innerWidth - 12,
  );
  popup.style.maxWidth = `${Math.max(44, right - left)}px`;
  popup.style.maxHeight = `${Math.max(44, Math.min(height * 0.7, bottom - upper))}px`;
  const bounds = popup.getBoundingClientRect();
  const desiredTop = Math.max(
    upper,
    Math.min(bounds.top, bottom - bounds.height),
  );
  const desiredLeft = Math.max(
    left,
    Math.min(bounds.left, right - bounds.width),
  );
  popup.style.top = `${(parseFloat(popup.style.top) || 0) + desiredTop - bounds.top}px`;
  popup.style.left = `${(parseFloat(popup.style.left) || 0) + desiredLeft - bounds.left}px`;
}
