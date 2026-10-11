// Local presentation only: no SDK session, account, credentials or popup.
import { createRoot } from "react-dom/client";
import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";
import { CloudConnectionView } from "../src/app/cloud-connection-view";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "../src/styles.css";
import "../src/accessibility.css";

if (import.meta.env.MODE !== "e2e")
  throw new Error("welcome layout fixture requires e2e mode");

const session: AppWebSignInSnapshot = {
  status: "signed_out",
  collections: [],
  selectedCollectionId: null,
  problem: null,
  timing: null,
  signIn: null,
};
const opening = new URL(location.href).searchParams.has("opening");
createRoot(document.getElementById("root")!).render(
  <CloudConnectionView
    session={session}
    sdk={{ snapshot: session }}
    error={null}
    startError={null}
    reviewingCollection={false}
    firstVisit
    busy={opening}
    sdkWaiting={false}
    authorizationPending={opening}
    opening={opening ? "another" : null}
    openingCollectionId={null}
    selectedCollectionId={null}
    availableConnections={[]}
    connect={async () => {}}
    open={async () => {}}
    applyCollectionSetup={async () => {}}
    cancelAuthorization={() => {}}
  />,
);
