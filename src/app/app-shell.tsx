import { lazy, Suspense } from "react";
import { AppShellLoading } from "../components/loading";
import { tasknotesMarkUrl } from "./assets";
import { useCollectionGate } from "./collection-context";

// The existing provider owns readiness and lifetime; only its UI is deferred.
// Module-level identity preserves local screen state after the first load.
const AppShellContent = lazy(async () => ({
  default: (await import("./app-shell-content")).AppShell,
}));

export function AppShell() {
  const { changeCollection } = useCollectionGate();
  return (
    <Suspense
      fallback={
        <AppShellLoading
          markUrl={tasknotesMarkUrl}
          changeCollection={changeCollection}
        />
      }
    >
      <AppShellContent />
    </Suspense>
  );
}
