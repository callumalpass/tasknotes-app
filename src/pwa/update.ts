import { useSyncExternalStore } from "react";

let initialized = false;
let available = false;
const listeners = new Set<() => void>();

/** Observe activation, not a download that may still fail or remain waiting.
 * First-time control is not an update. Never reload a tab automatically. */
export function initializePwaUpdate(): void {
  if (initialized || typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  initialized = true;
  const workers = navigator.serviceWorker;
  let current = workers.controller;
  workers.addEventListener("controllerchange", () => {
    const next = workers.controller;
    if (!next || next === current) return;
    const replacesPrevious = current !== null;
    current = next;
    if (replacesPrevious) setAvailable(true);
  });
}

export function usePwaUpdate(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export function deferPwaUpdate(): void {
  setAvailable(false);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean {
  return available;
}

function setAvailable(next: boolean): void {
  if (available === next) return;
  available = next;
  for (const listener of listeners) listener();
}
