// Local SDK-snapshot/approval/selection stand-ins. No accounts, popup,
// native enrollment, keys, transport, SDK client or durability qualification.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";
import { CloudConnectionView } from "../src/app/cloud-connection-view";
import { collectionRecoveryTarget } from "../src/app/cloud-collection-recovery";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "../src/styles.css";
import "../src/accessibility.css";

if (import.meta.env.MODE !== "e2e")
  throw Error("recovery fixture requires e2e mode");
const id = "11111111-1111-4111-8111-111111111111";
const approved: AppWebSignInSnapshot = {
  status: "blocked",
  problem: "outcome_unknown",
  selectedCollectionId: id,
  collections: [
    { collectionId: id, displayName: "Original collection", role: "owner" },
  ],
  timing: null,
  signIn: {
    requestId: id,
    installationId: id,
    deviceId: id,
    appId: "5cdfa020-c201-4da8-845a-f2cc9969eade",
    kind: "app-runtime",
    verificationUri: "http://127.0.0.1/fixture-approval",
    state: "paired",
    accountId: id,
    collectionIds: [id],
    createCollections: false,
    requestedCreateCollections: false,
  },
};
export function Fixture() {
  const [session, setSession] = useState<AppWebSignInSnapshot>({
    status: "signed_out",
    problem: null,
    selectedCollectionId: null,
    collections: [],
    timing: null,
    signIn: null,
  });
  const [selections, setSelections] = useState<string[]>([]);
  const [waiting, setWaiting] = useState(false);
  const target = collectionRecoveryTarget(session);
  return (
    <>
      <aside aria-label="Local fixture controls">
        <p>Local presentation stand-in; no native enrollment.</p>
        <button onClick={() => setSession(approved)}>
          Simulate account approval
        </button>
        <output aria-label="Original-target selection count">
          {selections.length}
        </output>
        <output aria-label="Last selected target">
          {selections.at(-1) ?? "none"}
        </output>
        {waiting ? (
          <button
            onClick={() => {
              setWaiting(false);
              setSession({ ...approved, status: "unselected", problem: null });
            }}
          >
            Settle original-target check
          </button>
        ) : null}
      </aside>
      <CloudConnectionView
        session={session}
        sdk={{ snapshot: session }}
        error={
          target
            ? "Opening this collection could not be confirmed. Retry to check the original request."
            : null
        }
        startError={null}
        reviewingCollection={false}
        firstVisit
        busy={waiting}
        sdkWaiting={false}
        authorizationPending={false}
        opening={null}
        openingCollectionId={waiting ? id : null}
        selectedCollectionId={session.selectedCollectionId}
        availableConnections={session.collections}
        retryCollection={
          target
            ? () => {
                if (waiting) return;
                setSelections((previous) => [...previous, target]);
                setWaiting(true);
              }
            : undefined
        }
        connect={async () => {}}
        open={async () => {}}
        applyCollectionSetup={async () => {}}
        cancelAuthorization={() => {}}
      />
    </>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("missing fixture root");
createRoot(root).render(<Fixture />);
