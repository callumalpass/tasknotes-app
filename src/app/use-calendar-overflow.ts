import { useLingui } from "@lingui/react/macro";
import { uiCopy } from "../i18n/ui-copy";
import { useEffect, useRef, type RefObject } from "react";
import { registerOverlay } from "../components/overlays/overlay-stack";

/** Bridge the calendar's imperative More popover into the application's overlay owner. */
export function useCalendarOverflow(rootRef: RefObject<HTMLElement | null>) {
  const { t } = useLingui();
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let popup: HTMLElement | null = null;
    let release: ReturnType<typeof registerOverlay> | undefined;
    let closeButton: HTMLElement | null = null;
    // The More link that opened the popover receives focus back.
    let trigger: HTMLElement | null = null;
    const remember = (event: Event) => {
      const more = (event.target as Element | null)?.closest?.<HTMLElement>(
        ".tnc-more",
      );
      if (more) trigger = more;
    };
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
      const next = root.querySelector<HTMLElement>(".tnc-popover");
      if (next === popup) {
        if (popup) fitCalendarPopup(popup);
        return;
      }
      detach();
      popup = next;
      closeButton =
        popup?.querySelector<HTMLElement>(".tnc-popover-close") ?? null;
      if (!popup) return;
      if (!popup.hasAttribute("aria-labelledby"))
        popup.setAttribute(
          "aria-label",
          t`Tasks for ${popup.querySelector(".tnc-popover-title")?.textContent ?? uiCopy("selected day")}`,
        );
      closeButton?.setAttribute(
        "aria-label",
        t({ message: "Close additional tasks" }),
      );
      closeButton?.addEventListener("keydown", activateClose);
      fitCalendarPopup(popup);
      release = registerOverlay({
        root: popup,
        modal: false,
        dismissOnTab: "boundary",
        dismissOnCover: true,
        inertRoots: [
          ...(popup.parentElement?.querySelectorAll<HTMLElement>(
            ":scope > .tnc-view",
          ) ?? []),
        ],
        dismiss: (reason) => {
          detach(reason === "escape");
          // Don't close the calendar's popover inside another overlay's
          // layout effect.
          queueMicrotask(close);
        },
        returnFocus: trigger?.isConnected ? trigger : null,
        initialFocus: () =>
          popup?.querySelector<HTMLElement>('.tnc-item[role="button"]') ??
          closeButton,
      });
    };
    const observer = new MutationObserver(synchronize);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener("click", remember, true);
    root.addEventListener("keydown", remember, true);
    synchronize();
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("resize", close);
      observer.disconnect();
      root.removeEventListener("click", remember, true);
      root.removeEventListener("keydown", remember, true);
      detach(false);
      closeRef.current = () => {};
    };
  }, [rootRef, t]);
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
