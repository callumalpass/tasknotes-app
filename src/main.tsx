import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { TaskNotesApp } from "./app/tasknotes-app";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { initializePwaInstall } from "./pwa/install";
import {
  clearTaskNotesServiceWorkerForDevelopment,
  registerTaskNotesServiceWorker,
} from "./service-worker-registration";
import "./styles.css";
import "./people.css";
import "./accessibility.css";

initializePwaInstall();

// The local e2e build may exercise the real held-repository gate with an SDK
// protocol stand-in. Neither the fixture module nor this route ships in other modes.
const SmokeFixture =
  import.meta.env.MODE === "e2e"
    ? lazy(() =>
        import("./test/next-entry-smoke-fixture").then((module) => ({
          default: module.NextEntrySmokeFixture,
        })),
      )
    : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      {SmokeFixture && window.__TASKNOTES_NEXT_SMOKE__ ? (
        <Suspense
          fallback={
            <main className="opening-screen">Loading SDK fixture…</main>
          }
        >
          <SmokeFixture />
        </Suspense>
      ) : (
        <TaskNotesApp />
      )}
    </AppErrorBoundary>
  </StrictMode>,
);

if (import.meta.env.PROD)
  void registerTaskNotesServiceWorker().catch((error: unknown) =>
    console.warn("TaskNotes offline support could not start.", error),
  );
else
  void clearTaskNotesServiceWorkerForDevelopment()
    .then((removed) => {
      if (removed && navigator.serviceWorker.controller) location.reload();
    })
    .catch((error: unknown) =>
      console.warn("TaskNotes development worker cleanup failed.", error),
    );
