import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { Trans } from "@lingui/react/macro";
import { AppI18nProvider } from "./i18n/app-provider";
import { TaskNotesApp } from "./app/tasknotes-app";
import {
  deliverAppGrantReturn,
  isAppGrantReturn,
} from "./cloud/app-grant-return";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { AppUpdateNotice } from "./components/app-update-notice";
import { ReturningUserNotice } from "./components/returning-user-notice";
import { initializePwaInstall } from "./pwa/install";
import { initializePwaUpdate } from "./pwa/update";
import {
  clearTaskNotesServiceWorkerForDevelopment,
  registerTaskNotesServiceWorker,
} from "./service-worker-registration";
import "./styles.css";
import "./people.css";
import "./accessibility.css";

// The Private collection grant window returns here: hand its result to the
// waiting original SDK owner, without starting a second mdbase owner. That owner
// closes this SAME popup only after verified completion and original custody ACK.
const grantReturn = isAppGrantReturn(new URL(window.location.href));
if (grantReturn) {
  void deliverAppGrantReturn(new URL(window.location.href)).catch(
    () => undefined,
  );
  createRoot(document.getElementById("root")!).render(
    <AppI18nProvider>
      <main className="opening-screen">
        <Trans>You can close this window.</Trans>
      </main>
    </AppI18nProvider>,
  );
} else startApp();

function startApp(): void {
  initializePwaInstall();
  if (import.meta.env.PROD) initializePwaUpdate();

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

  // Retain the demo backend solely for localhost e2e assertions, with no embedded
  // entry point. The held-client fixture above always takes precedence.
  const DemoFixture =
    import.meta.env.MODE === "e2e"
      ? lazy(() =>
          import("./test/demo-entry-fixture").then((module) => ({
            default: module.DemoEntryFixture,
          })),
        )
      : null;

  const CutoverFixture =
    import.meta.env.MODE === "e2e" &&
    new URL(location.href).searchParams.has("update-cutover")
      ? lazy(() =>
          import("./test/update-cutover-fixture").then((module) => ({
            default: module.UpdateCutoverFixture,
          })),
        )
      : null;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppI18nProvider>
        <AppErrorBoundary>
          <ReturningUserNotice />
          <AppUpdateNotice />
          {CutoverFixture ? (
            <Suspense fallback={<p>Loading cutover fixture…</p>}>
              <CutoverFixture />
            </Suspense>
          ) : SmokeFixture && window.__TASKNOTES_NEXT_SMOKE__ ? (
            <Suspense
              fallback={
                <main className="opening-screen">Loading SDK fixture…</main>
              }
            >
              <SmokeFixture />
            </Suspense>
          ) : DemoFixture ? (
            <Suspense
              fallback={
                <main className="opening-screen">
                  Loading demo test fixture…
                </main>
              }
            >
              <DemoFixture />
            </Suspense>
          ) : (
            <TaskNotesApp />
          )}
        </AppErrorBoundary>
      </AppI18nProvider>
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
}
