let registration: Promise<ServiceWorkerRegistration> | null = null;

export function registerTaskNotesServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator))
    return Promise.reject(
      new Error("Service workers are not available in this browser."),
    );
  const base = import.meta.env.BASE_URL;
  const script = import.meta.env.DEV
    ? `${base}src/service-worker.ts`
    : `${base}service-worker.js`;
  registration ??= navigator.serviceWorker.register(script, {
    scope: base,
    type: "module",
  });
  return registration;
}
