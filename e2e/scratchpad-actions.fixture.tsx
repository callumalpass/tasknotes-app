// Presentation-only fixture with synthetic image-capable data; no native authorization evidence.
import { createRoot } from "react-dom/client";
import { AppI18nProvider } from "../src/i18n/app-provider";
import { OpenedCollection } from "../src/app/opened-collection";
import { DemoTaskRepository } from "../src/demo/demo-task-repository";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "../src/styles.css";
import "../src/accessibility.css";
if (
  import.meta.env.MODE !== "e2e" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
)
  throw new Error("Scratchpad action fixture requires local e2e mode");
history.replaceState({}, "", "/scratchpad/");
const unavailable = () => {
  throw new Error(
    "Collection actions are outside this local presentation fixture",
  );
};
createRoot(document.getElementById("root")!).render(
  <AppI18nProvider>
    <OpenedCollection
      repository={new DemoTaskRepository(0)}
      actions={{
        collectionUi: null,
        changeCollection: unavailable,
        reauthorizeCurrentCollection: unavailable,
      }}
      discardPendingRecovery={async () => unavailable()}
    />
  </AppI18nProvider>,
);
