import { Capacitor } from "@capacitor/core";
import {
  ArrowLeft,
  BellOff,
  BellRing,
  Check,
  Cloud,
  FileText,
  FolderOpen,
  HardDrive,
  Search,
  Smartphone,
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
  const [confirmingBrowserLocal, setConfirmingBrowserLocal] = useState(false);
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

  if (confirmingBrowserLocal)
    return (
      <BrowserLocalConfirmation
        onBack={() => setConfirmingBrowserLocal(false)}
        onConfirm={() => {
          setConfirmingBrowserLocal(false);
          choose("local");
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
          else setConfirmingBrowserLocal(true);
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
        <h1>Choose how TaskNotes stores your tasks.</h1>
        <p>
          This affects notification delivery, performance as your collection
          grows, and where your Markdown files live.
        </p>
      </div>
      <div className="collection-choices collection-choice-comparison">
        <button
          className="collection-choice recommended"
          type="button"
          onClick={onChooseCloud}
        >
          <Cloud aria-hidden="true" size={22} strokeWidth={1.5} />
          <span className="collection-choice-content">
            <span className="collection-choice-title">
              <strong>mdbase</strong>
              <span className="recommendation-label">Best experience</span>
            </span>
            <span className="collection-choice-benefits">
              <small>
                <Search aria-hidden="true" size={15} />
                Faster search and saved views as your collection grows
              </small>
              <small>
                <BellRing aria-hidden="true" size={15} />
                mdbase delivers reminders while TaskNotes is closed
              </small>
              <small>
                <Check aria-hidden="true" size={15} />
                Hosted sync or a direct connection to your computer
              </small>
            </span>
            <span className="collection-choice-action">Connect mdbase</span>
          </span>
        </button>
        <button
          className="collection-choice"
          type="button"
          onClick={onChooseLocal}
        >
          <HardDrive aria-hidden="true" size={22} strokeWidth={1.5} />
          <span className="collection-choice-content">
            <strong>On this device</strong>
            <span className="collection-choice-benefits">
              <small>
                <FileText aria-hidden="true" size={15} />
                {canChooseLocalFolder
                  ? "Use a folder and its Markdown files directly"
                  : "Keep Markdown in this browser on this device"}
              </small>
              <small>
                <BellOff aria-hidden="true" size={15} />
                Reminder details are saved, but notifications are not delivered
              </small>
              <small>
                <Smartphone aria-hidden="true" size={15} />
                No account required
              </small>
            </span>
            <span className="collection-choice-action">
              Use {canChooseLocalFolder ? "this device" : "this browser"}
            </span>
          </span>
        </button>
      </div>
      <p className="welcome-portability">
        <FileText aria-hidden="true" size={16} /> Both options use portable
        Markdown. Switching later does not move tasks between collections.
      </p>
    </main>
  );
}

function BrowserLocalConfirmation({
  onBack,
  onConfirm,
}: {
  onBack(): void;
  onConfirm(): void;
}) {
  return (
    <main className="collection-welcome browser-local-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <p className="eyebrow">On this device</p>
        <h1>Keep tasks in this browser?</h1>
        <p>
          This is a private, account-free option for one browser. It is best for
          smaller collections.
        </p>
      </div>
      <div className="collection-caveat" role="note">
        <BellOff aria-hidden="true" size={20} />
        <div>
          <strong>Notifications are not available</strong>
          <p>
            Reminder details remain in Markdown, but this browser cannot deliver
            task notifications. Clearing its site data can also remove the
            browser-held collection.
          </p>
        </div>
      </div>
      <div className="welcome-actions">
        <button className="outline-action" type="button" onClick={onConfirm}>
          Use this browser
        </button>
        <button className="text-action" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={17} />
          Back
        </button>
      </div>
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
