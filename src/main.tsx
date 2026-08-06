import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CollectionGate } from "./app/collection-gate";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { DemoApp } from "./demo/demo-app";
import {
  clearTaskNotesServiceWorkerForDevelopment,
  registerTaskNotesServiceWorker,
} from "./service-worker-registration";
import "./styles.css";
import "./accessibility.css";

const demoCount = Number(new URL(location.href).searchParams.get("demo") ?? 0);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      {demoCount > 0 ? <DemoApp count={demoCount} /> : <CollectionGate />}
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
