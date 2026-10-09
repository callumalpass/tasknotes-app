import { useEffect, useRef, useState } from "react";
import type {
  AppInstallationSignInView,
  AppInstallationCollection,
  AppInstallationCollectionConsentView,
} from "@mdbase-dev/sdk/app-host";
import type { NextInstallationBuildInput } from "../cloud/next-installation-protocol";
import { NextInstallationWorker } from "../cloud/next-installation-worker";

/** Real protected C5/device consumer UI. Build inputs come from authenticated
 * bundled release intake, never a redirect. Discovery metadata isn't native
 * READ/collection readiness; onCollection must open the actual native host. */
export function NextInstallationScreen({
  build,
  onCollection,
}: {
  build: NextInstallationBuildInput;
  onCollection(collectionId: string): Promise<void>;
}) {
  const owner = useRef<NextInstallationWorker | null>(null);
  const current = useRef(true);
  const lifetime = useRef<AbortController | null>(null);
  const [view, setView] = useState<AppInstallationSignInView | null>(null);
  const [consent, setConsent] =
    useState<AppInstallationCollectionConsentView | null>(null);
  const [collections, setCollections] = useState<
    readonly AppInstallationCollection[]
  >([]);
  const [requestCreate, setRequestCreate] = useState(false);
  const [creationAttempted, setCreationAttempted] = useState(false);
  const [creationRecorded, setCreationRecorded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [requestReady, setRequestReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(false);
  useEffect(() => {
    current.current = true;
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      current.current = false;
      controller.abort();
      void owner.current?.close().catch(() => {});
      owner.current = null;
    };
  }, []);
  async function run(work: () => Promise<void>) {
    if (operation.current || !current.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    setExpired(false);
    try {
      await work();
    } catch (reason) {
      if (current.current) {
        const code =
          reason instanceof Error
            ? /^TaskNotes native sign-in: ([a-z_]{1,64})$/.exec(
                reason.message,
              )?.[1]
            : undefined;
        setCollections([]);
        if (code === "expired") {
          setExpired(true);
          setRequestReady(false);
          setConsent(null);
          setError(
            "This sign-in request expired. Start a new request on this device to continue.",
          );
        } else {
          setError(
            `The native installation operation did not complete${code ? ` (${code})` : ""}. Preserve device storage and explicitly resume the same request.`,
          );
        }
      }
    } finally {
      operation.current = false;
      if (current.current) setBusy(false);
    }
  }
  async function open(mode: "fresh" | "existing") {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || !current.current)
      throw Error("installation UI ended");
    await owner.current?.close();
    signal.throwIfAborted();
    owner.current = null;
    setDeviceReady(false);
    setRequestReady(false);
    setConsent(null);
    const opened = await NextInstallationWorker.open(
      build,
      mode,
      mode === "fresh" ? requestCreate : undefined,
      signal,
    );
    if (
      !current.current ||
      signal.aborted ||
      lifetime.current?.signal !== signal
    ) {
      await opened.worker.close();
      return;
    }
    owner.current = opened.worker;
    setView(opened.view);
    const started = await opened.worker.start();
    if (current.current) {
      setView(started);
      setRequestReady(true);
    }
  }
  const paired = view?.state === "paired";
  return (
    <main className="opening-screen" aria-busy={busy}>
      <h1>Open TaskNotes</h1>
      <p>
        Sign in on this device, explicitly confirm the selected account, then
        approve named collections.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {!view ? (
        <>
          <label>
            <input
              type="checkbox"
              checked={requestCreate}
              onChange={(event) => setRequestCreate(event.target.checked)}
              disabled={busy}
            />
            Request permission to create collections
          </label>
          <button disabled={busy} onClick={() => void run(() => open("fresh"))}>
            Sign in on this device
          </button>
          <button
            disabled={busy}
            onClick={() => void run(() => open("existing"))}
          >
            Resume this device's original sign-in
          </button>
        </>
      ) : null}
      {view && !paired && requestReady ? (
        <>
          <a
            href={view.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
          >
            Select account and approve in mdbase Connect
          </a>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await owner.current!.exchange();
                if (current.current) setView(next);
              })
            }
          >
            Check original approval
          </button>
        </>
      ) : null}
      {view?.accountId && !deviceReady && requestReady ? (
        <section>
          <p>
            Selected account: <code>{view.accountId}</code>
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await owner.current!.confirmAccount(
                  view.accountId!,
                );
                if (current.current) {
                  setView(next);
                  setDeviceReady(true);
                }
              })
            }
          >
            Confirm this account on this device
          </button>
        </section>
      ) : null}
      {deviceReady && !paired && requestReady ? (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const next = await owner.current!.attest();
              if (current.current) setView(next);
            })
          }
        >
          Send original device approval
        </button>
      ) : null}
      {view && expired ? (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              // Explicit renewal only; keep original native ownership and keys.
              // Until ready, never expose the expired parent's portal actions.
              setRequestReady(false);
              setConsent(null);
              setCollections([]);
              const next = await owner.current!.renewExpiredPairing();
              if (current.current) {
                setView(next);
                setRequestReady(true);
              }
            })
          }
        >
          Start a new sign-in request on this device
        </button>
      ) : null}
      {view && !expired ? (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const next = await owner.current!.start();
              if (current.current) {
                setView(next);
                setRequestReady(true);
              }
            })
          }
        >
          Retry original sign-in request
        </button>
      ) : null}
      {paired && deviceReady ? (
        <section>
          <h2>Create a collection</h2>
          <p>
            Create a new collection with a cloud copy. A collection name is not
            available during this setup. Creation does not mean its records are
            ready to open.
          </p>
          {creationRecorded ? (
            <>
              <p role="status">
                Collection creation recorded. Refresh approved collections to
                open it.
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  setCreationRecorded(false);
                  setCreationAttempted(false);
                }}
              >
                Create another collection
              </button>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const reconcile = creationAttempted;
                setCreationAttempted(true);
                void run(async () => {
                  await owner.current!.createCollection(reconcile);
                  if (current.current) setCreationRecorded(true);
                });
              }}
            >
              <button type="submit" disabled={busy || !view.createCollections}>
                {creationAttempted
                  ? "Resume original collection creation"
                  : "Create collection"}
              </button>
            </form>
          )}
          {!view.createCollections ? (
            <p>Approve permission to create collections before creating one.</p>
          ) : null}
          <h2>Approved collections</h2>
          <p>
            Collection names are approval metadata. Opening one still checks
            current native authority.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await owner.current!.collections();
                if (current.current) setCollections(next);
              })
            }
          >
            Refresh approved collections
          </button>
          <ul>
            {collections.map((collection) => (
              <li key={collection.collectionId}>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => onCollection(collection.collectionId))
                  }
                >
                  {collection.displayName}
                </button>
              </li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={requestCreate}
              onChange={(event) => setRequestCreate(event.target.checked)}
              disabled={busy}
            />
            Request permission to create collections
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await owner.current!.startConsent(requestCreate);
                if (current.current) setConsent(next);
              })
            }
          >
            Approve additional collection access
          </button>
          {consent ? (
            <>
              <a
                href={consent.verificationUri}
                target="_blank"
                rel="noopener noreferrer"
              >
                Review additional access in mdbase Connect
              </a>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await owner.current!.exchangeConsent();
                    if (current.current) {
                      setConsent(next);
                      if (next.state === "scope_updated")
                        setView((previous) =>
                          previous
                            ? {
                                ...previous,
                                createCollections:
                                  previous.createCollections ||
                                  next.approvedCreateCollections,
                              }
                            : previous,
                        );
                    }
                  })
                }
              >
                Check additional approval
              </button>
              <p>
                {consent.state === "scope_updated"
                  ? "Additional approval recorded for the original device."
                  : "Additional approval is pending."}
              </p>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
