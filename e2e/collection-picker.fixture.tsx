// Guarded local layout/callback fixture, not SDK or native authority evidence.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CollectionPicker,
  type CollectionChoice,
} from "../src/app/collection-picker";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "../src/styles.css";
import "../src/accessibility.css";

if (import.meta.env.MODE !== "e2e")
  throw new Error("picker fixture requires e2e mode");
const parameters = new URL(location.href).searchParams;
const choices: CollectionChoice[] = parameters.has("empty")
  ? []
  : [
      {
        collectionId: "alpha",
        displayName: "Personal",
        authority: { kind: "hosted" },
      },
      {
        collectionId: "beta",
        displayName: "Work",
        authority: { kind: "connector" },
      },
      {
        collectionId: "gamma",
        displayName:
          "A collection with a very long descriptive name for projects and shared writing",
      },
      {
        collectionId: "delta",
        displayName: "UnbrokenCollectionNameForNarrowScreensAndLargeText",
      },
      { collectionId: "epsilon", displayName: "Travel" },
      { collectionId: "zeta", displayName: "Archive" },
    ];
function Fixture() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(
    choices[0]?.collectionId ?? null,
  );
  const [opening, setOpening] = useState<string | null>(null);
  const [calls, setCalls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(
    parameters.has("error") ? "This collection needs approval." : null,
  );
  const record = (action: string) =>
    setCalls((previous) => [...previous, action]);
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ overflowWrap: "anywhere" }}>
        Workspace:{" "}
        {choices.find((choice) => choice.collectionId === current)
          ?.displayName ?? "None"}
      </h1>
      <p>Existing page remains on this device.</p>
      <button className="secondary-button" onClick={() => setOpen(true)}>
        Change collection
      </button>
      <output data-testid="caller-actions">{JSON.stringify(calls)}</output>
      {open ? (
        <CollectionPicker
          connections={choices}
          selectedCollectionId={current}
          openingCollectionId={opening}
          error={error}
          onRetry={() => {
            record("retry");
            setError(null);
          }}
          onClose={() => setOpen(false)}
          onAuthorize={() => record("authorize")}
          onSelect={(id) => {
            record(`select:${id}`);
            setOpening(id);
            // Callback/UI progress only. No records, connections or READY signal.
            setTimeout(() => {
              setCurrent(id);
              setOpening(null);
              setOpen(false);
            }, 1500);
          }}
        />
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
