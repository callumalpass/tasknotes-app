import { createRoot } from "react-dom/client";
import { createMdbase } from "@mdbase-dev/sdk";
import { taskNotesApplicationDeclaration } from "../src/cloud/tasknotes-application";

// Real public constructor in a genuine browser host. Never start/approve/select:
// no registration, Worker/native initialization, accounts or storage allocation.
const mdbase = createMdbase(
  taskNotesApplicationDeclaration({
    environment: "lab",
    appOrigin: window.location.origin,
  }),
);
const snapshot = mdbase.getSnapshot();
export function Fixture() {
  return (
    <main>
      <p data-testid="entry-status">{snapshot.status}</p>
      <p data-testid="selection-state">{snapshot.selection.state}</p>
      <p data-testid="connection">
        {String(mdbase.connection("unselected") === null)}
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
