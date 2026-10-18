import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  cloudSession,
  isCloudCallback,
  startCloudSession,
} from "../cloud/connect";
import { requireConnectOutcome } from "../cloud/outcome";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import { useCloudSessionSnapshot } from "../cloud/use-session";
import { appPlatform } from "../native/app-platform";
import { CollectionPicker } from "./collection-picker";
import { collectionErrorMessage as message } from "./collection-error";

const CloudCollection = lazy(() => import("./cloud-collection"));

export function CollectionGate({ onTryDemo }: { onTryDemo?(): void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Keep the original failure so a sync-service cutover can be explained with
  // the server's own message rather than a generic retry.
  const [authorizationFailure, setAuthorizationFailure] = useState<{
    reason: unknown;
  } | null>(null);
  const authorizationError = authorizationFailure
    ? message(authorizationFailure.reason)
    : null;
  const [callbackRetryAvailable, setCallbackRetryAvailable] = useState(false);
  const handledCallbackUrls = useRef(new Set<string>());
  const pendingCallbackUrls = useRef(new Set<string>());
  const callbackOperations = useRef(new Map<string, Promise<void>>());
  const lifecycleController = useRef(new AbortController());
  const session = useCloudSessionSnapshot();

  const requestOptions = useCallback(() => {
    if (lifecycleController.current.signal.aborted)
      lifecycleController.current = new AbortController();
    return {
      signal: lifecycleController.current.signal,
      timeoutMs: TASKNOTES_REQUEST_BUDGETS.authorizationMs,
    };
  }, []);

  const startSession = useCallback(
    () => startCloudSession(requestOptions()),
    [requestOptions],
  );

  const complete = useCallback(
    async (url: string) => {
      if (!isCloudCallback(url) || handledCallbackUrls.current.has(url)) return;
      pendingCallbackUrls.current.add(url);
      const existing = callbackOperations.current.get(url);
      if (existing) return existing;
      const operation = (async () => {
        try {
          // Startup consumes an initial web callback. Join it while startup is
          // in flight; calling the handler afterward would exchange it twice.
          // The SDK also waits for startup before handling native deep links.
          const [, outcome] = await Promise.all([
            startSession(),
            cloudSession.handleAuthorizationCallback(url, requestOptions()),
          ]);
          requireConnectOutcome(outcome);
          pendingCallbackUrls.current.delete(url);
          handledCallbackUrls.current.add(url);
          setCallbackRetryAvailable(pendingCallbackUrls.current.size > 0);
          setAuthorizationFailure(null);
          setPickerOpen(false);
        } catch (reason) {
          setCallbackRetryAvailable(true);
          setAuthorizationFailure({ reason });
        } finally {
          await appPlatform.closeAuthorizationBrowser();
        }
      })();
      callbackOperations.current.set(url, operation);
      try {
        await operation;
      } finally {
        callbackOperations.current.delete(url);
      }
    },
    [requestOptions, startSession],
  );

  const retryStartup = useCallback(() => {
    setAuthorizationFailure(null);
    const pending = [...pendingCallbackUrls.current];
    void (
      pending.length > 0
        ? Promise.all(pending.map((url) => complete(url)))
        : startSession()
    ).catch((reason) => setAuthorizationFailure({ reason }));
  }, [complete, startSession]);

  useEffect(() => {
    const initialize = async () => {
      const initialUrl = location.href;
      if (isCloudCallback(initialUrl)) await complete(initialUrl);
      else await startSession();
    };
    queueMicrotask(() => {
      void initialize().catch((reason) => setAuthorizationFailure({ reason }));
    });
    const listener = appPlatform.addUrlOpenListener(
      (url) => void complete(url),
    );
    void appPlatform.launchUrl().then((url) => {
      if (url) void complete(url);
    });
    return () => {
      lifecycleController.current.abort(
        new DOMException("TaskNotes connection flow closed.", "AbortError"),
      );
      void listener.then((handle) => handle?.remove());
    };
  }, [complete, startSession]);

  const authorizeAnotherCollection = useCallback(() => {
    setPickerOpen(false);
    setAuthorizationFailure(null);
    void cloudSession
      .authorize("choose", {
        ...requestOptions(),
        presentation: "popup",
        timeoutMs: TASKNOTES_REQUEST_BUDGETS.authorizationPopupMs,
      })
      .then(requireConnectOutcome)
      .catch((reason) => setAuthorizationFailure({ reason }));
  }, [requestOptions]);

  const reauthorizeCurrentCollection = useCallback(() => {
    setPickerOpen(false);
    setAuthorizationFailure(null);
    void cloudSession
      .authorize("selected", {
        ...requestOptions(),
        presentation: "popup",
        timeoutMs: TASKNOTES_REQUEST_BUDGETS.authorizationPopupMs,
      })
      .then(requireConnectOutcome)
      .catch((reason) => setAuthorizationFailure({ reason }));
  }, [requestOptions]);

  const selectCollection = useCallback(
    (collectionId: string) => {
      void startSession()
        .then(() => {
          requireConnectOutcome(
            cloudSession.select(collectionId, { history: "replace" }),
          );
          setAuthorizationFailure(null);
          setPickerOpen(false);
        })
        .catch((reason) => setAuthorizationFailure({ reason }));
    },
    [startSession],
  );

  const selectedCollectionId =
    "collectionId" in session ? session.collectionId : null;

  return (
    <>
      <Suspense fallback={<OpeningCollection />}>
        <CloudCollection
          authorizationError={authorizationError}
          authorizationFailure={authorizationFailure?.reason}
          authorizeAnotherCollection={authorizeAnotherCollection}
          callbackRetryAvailable={callbackRetryAvailable}
          ensureStarted={startSession}
          openCollectionPicker={() => setPickerOpen(true)}
          reauthorizeCurrentCollection={reauthorizeCurrentCollection}
          retryStartup={retryStartup}
          onTryDemo={onTryDemo}
        />
      </Suspense>
      {pickerOpen ? (
        <CollectionPicker
          connections={session.connections}
          selectedCollectionId={selectedCollectionId}
          onAuthorize={authorizeAnotherCollection}
          onClose={() => setPickerOpen(false)}
          onSelect={selectCollection}
        />
      ) : null}
    </>
  );
}

function OpeningCollection() {
  return (
    <main className="opening-screen">
      <p>Opening mdbase…</p>
    </main>
  );
}
