import { useSyncExternalStore } from "react";
import { registerTaskNotesServiceWorker } from "../service-worker-registration";

let initialized = false;
let available = false;
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | undefined;
let acceptedWaiting: ServiceWorker | null = null;

/** Offer only installed updates or replacement controllers, never incomplete downloads.
 * Waiting workers retain old-tab assets. Activation follows explicit saved consent. */
export function initializePwaUpdate(): void {
  if (initialized || typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  initialized = true;
  const workers = navigator.serviceWorker;
  let current = workers.controller;
  let offeredWaiting: ServiceWorker | null = null;
  workers.addEventListener("controllerchange", () => {
    const next = workers.controller;
    if (!next || next === current) return;
    const replacesPrevious = current !== null;
    current = next;
    if (replacesPrevious && next !== acceptedWaiting) setAvailable(true);
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
  const observe = (next: ServiceWorkerRegistration) => {
    registration = next;
    if (observed.has(next)) return;
    observed.add(next);
    if (next.waiting) offer(next.waiting);
    const watch = () => {
      const worker = next.installing;
      if (!worker) return;
      offer(worker);
      worker.addEventListener("statechange", () => offer(worker));
    };
    next.addEventListener("updatefound", watch);
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

/** Called only after this tab has saved and checked every reload participant. */
export function activatePwaUpdate(): Promise<void> {
  const waiting = registration?.waiting;
  if (!waiting) return Promise.resolve();
  acceptedWaiting = waiting;
  const workers = navigator.serviceWorker;
  return new Promise((resolve, reject) => {
    const stop = () => {
      workers.removeEventListener("controllerchange", changed);
      waiting.removeEventListener("statechange", stateChanged);
    };
    const changed = () => {
      if (workers.controller !== waiting) return;
      stop();
      resolve();
    };
    const stateChanged = () => {
      if (waiting.state !== "redundant") return;
      stop();
      reject(
        new Error(
          "The update could not activate. Keep this page open and try again.",
        ),
      );
    };
    workers.addEventListener("controllerchange", changed);
    waiting.addEventListener("statechange", stateChanged);
    try {
      waiting.postMessage({ type: "mdbase-shell:activate" });
    } catch (error) {
      stop();
      reject(error);
    }
  });
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
