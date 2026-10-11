import { createRoot } from "react-dom/client";
import { type MdbaseApplicationSnapshot } from "@mdbase-dev/sdk";
import { createApplicationFixture } from "@mdbase-dev/sdk/testing";
import { useEffect, useState } from "react";
import { ApplicationCollectionGate } from "../src/app/application-collection-gate";
import { CollectionPicker } from "../src/app/collection-picker";
import { taskNotesApplicationDeclaration } from "../src/cloud/tasknotes-application";

// Declared public SDK UI metadata/selection stand-in. No native client, keys,
// enrollment, Worker, transport or account authority exists in this fixture.
const id = "11111111-1111-4111-8111-111111111111";
const facet = { checking: false, assessment: null, problem: null };
const initial: MdbaseApplicationSnapshot = {
  status: "blocked",
  collections: [
    { collectionId: id, displayName: "Original tasks", role: "owner" },
  ],
  selectedCollectionId: null,
  problem: "outcome_unknown",
  timing: null,
  signIn: {
    requestId: id,
    installationId: id,
    deviceId: id,
    appId: "5cdfa020-c201-4da8-845a-f2cc9969eade",
    kind: "app-runtime",
    verificationUri: `https://connect-lab.mdbase.dev/pair/${id}`,
    state: "paired",
    accountId: id,
    collectionIds: [id],
    createCollections: false,
    requestedCreateCollections: true,
  },
  readiness: {
    ...facet,
    facets: {
      capabilities: facet,
      contracts: facet,
      configuration: facet,
      files: facet,
      people: facet,
      notifications: facet,
    },
  },
  selection: {
    state: "blocked",
    requested: {
      collectionId: id,
      source: "user",
      displayName: "Original tasks",
      approved: true,
    },
    usable: null,
    problem: null,
  },
};
const sdk = createApplicationFixture({
  declaration: taskNotesApplicationDeclaration({
    environment: "lab",
    appOrigin: window.location.origin,
  }),
  connections: [],
  initialSnapshot: initial,
});
export function Fixture() {
  const [count, setCount] = useState(0);
  const [target, setTarget] = useState("");
  const [finish, setFinish] = useState<(() => void) | null>(null);
  useEffect(
    () =>
      sdk.controls.setHandler("select", (call) => {
        setCount((value) => value + 1);
        setTarget(call.collectionId ?? "");
        sdk.controls.publishSnapshot({
          ...initial,
          status: "opening",
          problem: null,
          selection: { ...initial.selection, state: "opening" },
        });
        return new Promise<void>((resolve) =>
          setFinish(() => () => {
            sdk.controls.publishSnapshot({
              ...initial,
              status: "unselected",
              problem: null,
              selection: { ...initial.selection, state: "none" },
            });
            resolve();
            setFinish(null);
          }),
        );
      }),
    [],
  );
  return (
    <>
      <ApplicationCollectionGate entry={sdk.entry} Picker={CollectionPicker} />
      <p data-testid="selection-count">{count}</p>
      <p data-testid="selection-target">{target}</p>
      {finish ? (
        <button onClick={finish}>Finish original selection</button>
      ) : null}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
