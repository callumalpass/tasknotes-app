import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CollectionGate } from "./app/collection-gate";
import { AppErrorBoundary } from "./components/app-error-boundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <CollectionGate />
    </AppErrorBoundary>
  </StrictMode>,
);
