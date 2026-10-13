import { useSyncExternalStore } from "react";
import { registerTaskNotesServiceWorker } from "../service-worker-registration";

let initialized = false;
let available = false;
const listeners = new Set<() => void>();

/** Offer only installed updates or replacement controllers, never incomplete downloads.
 * Waiting workers retain old-tab assets. Never activate or reload automatically. */
export function initializePwaUpdate(): void {
  if (initialized || typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  initialized = true;
  const workers = navigator.serviceWorker;
  let current = workers.controller;
  let offeredWaiting: ServiceWorker | null = null;
  let handledWaiting: ServiceWorker | null = null;
  let reloaded = false;
  try {
    reloaded = sessionStorage.getItem("tasknotes-update-reload") === "1";
    sessionStorage.removeItem("tasknotes-update-reload");
  } catch {
    /* Update detection also works without browser storage. */
  }
  workers.addEventListener("controllerchange", () => {
    const next = workers.controller;
    if (!next || next === current) return;
    const replacesPrevious = current !== null;
    current = next;
    if (replacesPrevious && next !== handledWaiting) setAvailable(true);
  });
  const observed = new WeakSet<ServiceWorkerRegistration>();
  const offer = (worker: ServiceWorker) => {
    if (
      worker.state !== "installed" ||
      !workers.controller ||
      worker === offeredWaiting
    )
      return;
    offeredWaiting = worker;
    setAvailable(true);
  };
  const observe = (registration: ServiceWorkerRegistration) => {
    if (observed.has(registration)) return;
    observed.add(registration);
    if (reloaded && registration.waiting) {
      offeredWaiting = handledWaiting = registration.waiting;
    } else if (registration.waiting) offer(registration.waiting);
    reloaded = false;
    const watch = () => {
      const worker = registration.installing;
      if (!worker) return;
      offer(worker);
      worker.addEventListener("statechange", () => offer(worker));
    };
    registration.addEventListener("updatefound", watch);
    watch();
  };
  void Promise.resolve()
    .then(registerTaskNotesServiceWorker)
    .then(observe)
    .catch(() => undefined);
  let checking = false;
  const check = () => {
    if (document.visibilityState === "hidden" || checking) return;
    checking = true;
    void Promise.resolve()
      .then(registerTaskNotesServiceWorker)
      .then((registration) => {
        observe(registration);
        return registration.update();
      })
      .catch(() => undefined)
      .finally(() => {
        checking = false;
      });
  };
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
}

export function usePwaUpdate(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export function deferPwaUpdate(): void {
  setAvailable(false);
}

/** This tab explicitly loaded the new app while the SDK keeps its worker waiting. */
export function markPwaUpdateReloaded(): void {
  try {
    sessionStorage.setItem("tasknotes-update-reload", "1");
  } catch {
    /* Optional acknowledgement. */
  }
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
