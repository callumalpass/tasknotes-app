let registration: Promise<ServiceWorkerRegistration> | null = null;
const TASKNOTES_CACHE_PREFIX = "tasknotes-app-shell-";

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

export async function clearTaskNotesServiceWorkerForDevelopment(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const scope = new URL(import.meta.env.BASE_URL, location.href).href;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const owned = registrations.filter(({ scope: registrationScope }) =>
    registrationScope.startsWith(scope),
  );
  const cacheNames = "caches" in window ? await caches.keys() : [];
  await Promise.all([
    ...owned.map((item) => item.unregister()),
    ...cacheNames
      .filter((name) => name.startsWith(TASKNOTES_CACHE_PREFIX))
      .map((name) => caches.delete(name)),
  ]);
  return owned.length > 0;
}
