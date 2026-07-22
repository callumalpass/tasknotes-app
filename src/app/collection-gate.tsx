import { Cloud, FileText, HardDrive } from "lucide-react";
import { lazy, Suspense, useCallback, useState } from "react";

import { tasknotesMarkUrl } from "./assets";
import type { CollectionChoice } from "./collection-context";

const CloudCollection = lazy(() => import("./cloud-collection"));
const LocalCollection = lazy(() => import("./local-collection"));
const STORAGE_KEY = "tasknotes:collection-choice:v1";

export function CollectionGate() {
  const [choice, setChoice] = useState<CollectionChoice | null>(() =>
    readChoice(),
  );
  const choose = useCallback((next: CollectionChoice) => {
    localStorage.setItem(STORAGE_KEY, next);
    setChoice(next);
  }, []);
  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setChoice(null);
  }, []);

  if (!choice) return <CollectionWelcome onChoose={choose} />;
  if (choice === "cloud")
    return (
      <Suspense fallback={<OpeningCollection label="Opening mdbase cloud" />}>
        <CloudCollection choose={choose} reset={reset} />
      </Suspense>
    );

  return (
    <Suspense fallback={<OpeningCollection label="Opening your tasks" />}>
      <LocalCollection choose={choose} reset={reset} />
    </Suspense>
  );
}

function CollectionWelcome({
  onChoose,
}: {
  onChoose(choice: CollectionChoice): void;
}) {
  return (
    <main className="collection-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <p className="eyebrow">TaskNotes</p>
        <h1>Where should your tasks live?</h1>
        <p>Both choices work offline. You can change this later.</p>
      </div>
      <div className="collection-choices">
        <button type="button" onClick={() => onChoose("local")}>
          <HardDrive aria-hidden="true" size={22} strokeWidth={1.5} />
          <span>
            <strong>On this device</strong>
            <small>No account. Markdown files stay on this device.</small>
          </span>
        </button>
        <button type="button" onClick={() => onChoose("cloud")}>
          <Cloud aria-hidden="true" size={22} strokeWidth={1.5} />
          <span>
            <strong>mdbase cloud</strong>
            <small>Use the same tasks across devices.</small>
          </span>
        </button>
      </div>
      <p className="welcome-portability">
        <FileText aria-hidden="true" size={16} /> Tasks remain portable Markdown
        records.
      </p>
    </main>
  );
}

function OpeningCollection({ label }: { label: string }) {
  return (
    <main className="opening-screen">
      <img alt="" src={tasknotesMarkUrl} />
      <p>{label}</p>
    </main>
  );
}

function readChoice(): CollectionChoice | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "local" || value === "cloud" ? value : null;
}
