import { useSyncExternalStore } from "react";

export type PwaInstallState =
  "available" | "installed" | "ios-instructions" | "unavailable";

type InstallChoice = "accepted" | "dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: InstallChoice }>;
}

let initialized = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let state: PwaInstallState = initialState();
const listeners = new Set<() => void>();

export function initializePwaInstall(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("beforeinstallprompt", captureInstallPrompt);
  window.addEventListener("appinstalled", markInstalled);
  if (typeof window.matchMedia === "function") {
    window
      .matchMedia("(display-mode: standalone)")
      .addEventListener("change", updateDisplayMode);
  }
}

export function usePwaInstall(): PwaInstallState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export async function requestPwaInstall(): Promise<InstallChoice | null> {
  const prompt = deferredPrompt;
  if (!prompt) return null;
  deferredPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  setState(choice.outcome === "accepted" ? "installed" : fallbackState());
  return choice.outcome;
}

function captureInstallPrompt(event: Event): void {
  event.preventDefault();
  deferredPrompt = event as BeforeInstallPromptEvent;
  setState("available");
}

function markInstalled(): void {
  deferredPrompt = null;
  setState("installed");
}

function updateDisplayMode(): void {
  if (isStandalone()) markInstalled();
}

function initialState(): PwaInstallState {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return "unavailable";
  return fallbackState();
}

function fallbackState(): PwaInstallState {
  if (isStandalone()) return "installed";
  return isIosBrowser() ? "ios-instructions" : "unavailable";
}

function isStandalone(): boolean {
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    iosNavigator.standalone === true ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches)
  );
}

function isIosBrowser(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): PwaInstallState {
  return state;
}

function setState(next: PwaInstallState): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener();
}
