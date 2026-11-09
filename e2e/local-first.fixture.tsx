import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createMdbase } from "@mdbase-dev/sdk";
import { taskNotesApplicationDeclaration } from "../src/cloud/tasknotes-application";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";
import { TaskNotesApp } from "../src/app/tasknotes-app";
import { AppI18nProvider } from "../src/i18n/app-provider";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import "../src/styles.css";
import "../src/people.css";
import "../src/accessibility.css";

if (import.meta.env.MODE !== "e2e") throw new Error("e2e fixture only");
// The SDK only supplies the signed-out account state here. The collection,
// IndexedDB commits, app shell and record edits are the production implementation.
const mdbase = new URL(location.href).searchParams.has("real-sdk")
  ? createMdbase(
      taskNotesApplicationDeclaration({
        environment: "lab",
        appOrigin: location.origin,
      }),
    )
  : await createTestMdbase({ phase: "signed_out", collections: [] });
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppI18nProvider>
      <TaskNotesApp mdbase={mdbase} />
    </AppI18nProvider>
  </StrictMode>,
);
