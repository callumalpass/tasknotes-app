import { Capacitor } from "@capacitor/core";
import {
  ArrowLeft,
  Cloud,
  FileText,
  FolderOpen,
  HardDrive,
} from "lucide-react";
import { lazy, Suspense, useCallback, useState } from "react";

import {
  chooseDefaultLocalCollection,
  chooseExistingLocalCollection,
  localCollectionKey,
  readLocalCollectionLocation,
  type LocalCollectionLocation,
} from "../storage/local-collection-location";
import { tasknotesMarkUrl } from "./assets";
import type { CollectionChoice } from "./collection-context";

const CloudCollection = lazy(() => import("./cloud-collection"));
const LocalCollection = lazy(() => import("./local-collection"));
const STORAGE_KEY = "tasknotes:collection-choice:v1";

export function CollectionGate() {
  const canChooseLocalFolder = Capacitor.isNativePlatform();
  const [choice, setChoice] = useState<CollectionChoice | null>(() =>
    readChoice(),
  );
  const [localLocation, setLocalLocation] = useState<LocalCollectionLocation>(
    () => readLocalCollectionLocation(),
  );
  const [choosingLocalLocation, setChoosingLocalLocation] = useState(false);
  const choose = useCallback((next: CollectionChoice) => {
    localStorage.setItem(STORAGE_KEY, next);
    setChoice(next);
  }, []);
  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setChoice(null);
  }, []);
  const changeLocalCollection = useCallback(
    () => setChoosingLocalLocation(true),
    [],
  );
  const finishLocalChoice = useCallback((location: LocalCollectionLocation) => {
    setLocalLocation(location);
    localStorage.setItem(STORAGE_KEY, "local");
    setChoice("local");
    setChoosingLocalLocation(false);
  }, []);

  if (choosingLocalLocation)
    return (
      <LocalLocationChoice
        onBack={() => setChoosingLocalLocation(false)}
        onChooseDefault={async () =>
          finishLocalChoice(await chooseDefaultLocalCollection())
        }
        onChooseExisting={async () => {
          const location = await chooseExistingLocalCollection();
          if (location) finishLocalChoice(location);
        }}
      />
    );

  if (!choice)
    return (
      <CollectionWelcome
        canChooseLocalFolder={canChooseLocalFolder}
        onChooseCloud={() => choose("cloud")}
        onChooseLocal={() => {
          if (canChooseLocalFolder) setChoosingLocalLocation(true);
          else choose("local");
        }}
      />
    );
  if (choice === "cloud")
    return (
      <Suspense fallback={<OpeningCollection label="Opening mdbase" />}>
        <CloudCollection
          canChooseLocalFolder={canChooseLocalFolder}
          changeLocalCollection={changeLocalCollection}
          choose={choose}
          reset={reset}
        />
      </Suspense>
    );

  return (
    <Suspense fallback={<OpeningCollection label="Opening your tasks" />}>
      <LocalCollection
        canChooseLocalFolder={canChooseLocalFolder}
        changeLocalCollection={changeLocalCollection}
        choose={choose}
        key={localCollectionKey(localLocation)}
        reset={reset}
      />
    </Suspense>
  );
}

function CollectionWelcome({
  canChooseLocalFolder,
  onChooseCloud,
  onChooseLocal,
}: {
  canChooseLocalFolder: boolean;
  onChooseCloud(): void;
  onChooseLocal(): void;
}) {
  return (
    <main className="collection-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <p className="eyebrow">TaskNotes</p>
        <h1>Where should your tasks live?</h1>
        <p>
          You can switch collections later. Choosing a location does not move
          tasks between them.
        </p>
      </div>
      <div className="collection-choices">
        <button type="button" onClick={onChooseCloud}>
          <Cloud aria-hidden="true" size={22} strokeWidth={1.5} />
          <span>
            <span className="collection-choice-title">
              <strong>mdbase</strong>
              <span className="recommendation-label">Recommended</span>
            </span>
            <small>
              Connect a shared collection. Hosted sync can keep working offline.
            </small>
          </span>
        </button>
        <button type="button" onClick={onChooseLocal}>
          <HardDrive aria-hidden="true" size={22} strokeWidth={1.5} />
          <span>
            <strong>On this device</strong>
            <small>
              {canChooseLocalFolder
                ? "Choose a folder and use its Markdown files directly."
                : "Keep the source Markdown in this browser on this device."}
            </small>
          </span>
        </button>
      </div>
      <p className="welcome-portability">
        <FileText aria-hidden="true" size={16} /> In either mode, task records
        use portable Markdown.
      </p>
    </main>
  );
}

function LocalLocationChoice({
  onBack,
  onChooseDefault,
  onChooseExisting,
}: {
  onBack(): void;
  onChooseDefault(): Promise<void>;
  onChooseExisting(): Promise<void>;
}) {
  const [opening, setOpening] = useState<"default" | "existing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(
    kind: "default" | "existing",
    operation: () => Promise<void>,
  ) {
    setOpening(kind);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOpening(null);
    }
  }

  return (
    <main className="collection-welcome local-location-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <p className="eyebrow">On this device</p>
        <h1>Use a folder for your tasks.</h1>
        <p>
          TaskNotes can use its usual folder or a compatible collection you
          already have.
        </p>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="collection-choices">
        <button
          disabled={opening !== null}
          type="button"
          onClick={() => void choose("default", onChooseDefault)}
        >
          <HardDrive aria-hidden="true" size={22} strokeWidth={1.5} />
          <span>
            <strong>Use the TaskNotes folder</strong>
            <small>
              {opening === "default"
                ? "Opening…"
                : "Keep an app-managed folder that is visible in Files."}
            </small>
          </span>
        </button>
        <button
          disabled={opening !== null}
          type="button"
          onClick={() => void choose("existing", onChooseExisting)}
        >
          <FolderOpen aria-hidden="true" size={22} strokeWidth={1.5} />
          <span>
            <strong>Choose an existing folder</strong>
            <small>
              {opening === "existing"
                ? "Waiting for Files…"
                : "Open a local, iCloud, or supported provider folder."}
            </small>
          </span>
        </button>
      </div>
      <button
        className="welcome-back text-action"
        type="button"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" size={17} />
        Back
      </button>
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
