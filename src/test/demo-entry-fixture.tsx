import { useState } from "react";
import { TaskNotesApp } from "../app/tasknotes-app";
import { DemoApp } from "../demo/demo-app";

/** Original demo semantics, retained solely for local browser assertions.
 * This entry is unreachable and omitted outside the exact e2e build mode;
 * none of its behavior qualifies native source writes or model readiness.
 */
export function DemoEntryFixture() {
  if (
    import.meta.env.MODE !== "e2e" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  )
    throw new Error("Demo fixtures require a local e2e build.");
  const [{ count, embedded }] = useState(() => {
    const url = new URL(location.href);
    const embedded = /\/embed(?:\/|$)/.test(url.pathname);
    const requested = Number(url.searchParams.get("demo") ?? 0);
    return { count: embedded && requested <= 0 ? 24 : requested, embedded };
  });
  return count > 0 ? (
    <DemoApp count={count} embedded={embedded} />
  ) : (
    <TaskNotesApp />
  );
}
