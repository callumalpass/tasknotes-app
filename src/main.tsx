import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TaskNotesApp } from "./app/tasknotes-app";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { initializePwaInstall } from "./pwa/install";
import {
  clearTaskNotesServiceWorkerForDevelopment,
  registerTaskNotesServiceWorker,
} from "./service-worker-registration";
import "./styles.css";
import "./accessibility.css";

initializePwaInstall();

const currentUrl = new URL(location.href);
const embeddedDemo = /\/embed(?:\/|$)/.test(currentUrl.pathname);
const requestedDemoCount = Number(currentUrl.searchParams.get("demo") ?? 0);
const demoCount =
  embeddedDemo && requestedDemoCount <= 0 ? 24 : requestedDemoCount;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <TaskNotesApp demoCount={demoCount} embeddedDemo={embeddedDemo} />
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
