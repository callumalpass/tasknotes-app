import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppErrorBoundary } from "../components/app-error-boundary";
import "../styles.css";
import "../accessibility.css";
import { AndroidNotificationSmoke } from "./android-notification-smoke";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AndroidNotificationSmoke />
    </AppErrorBoundary>
  </StrictMode>,
);
