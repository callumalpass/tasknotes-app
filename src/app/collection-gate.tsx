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

const CloudCollection = lazy(() => import("./cloud-collection"));

export function CollectionGate({ onTryDemo }: { onTryDemo?(): void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [authorizationError, setAuthorizationError] = useState<string | null>(
    null,
  );
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
          await startSession();
          requireConnectOutcome(
            await cloudSession.handleAuthorizationCallback(
              url,
              requestOptions(),
            ),
          );
          pendingCallbackUrls.current.delete(url);
          handledCallbackUrls.current.add(url);
          setCallbackRetryAvailable(pendingCallbackUrls.current.size > 0);
          setAuthorizationError(null);
          setPickerOpen(false);
        } catch (reason) {
          setCallbackRetryAvailable(true);
          setAuthorizationError(message(reason));
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
    setAuthorizationError(null);
    void startSession()
      .then(() =>
        Promise.all(
          [...pendingCallbackUrls.current].map((url) => complete(url)),
        ),
      )
      .catch((reason) => setAuthorizationError(message(reason)));
  }, [complete, startSession]);

  useEffect(() => {
    const initialize = async () => {
      const initialUrl = location.href;
      if (isCloudCallback(initialUrl)) await complete(initialUrl);
      else await startSession();
    };
    queueMicrotask(() => {
      void initialize().catch((reason) =>
        setAuthorizationError(message(reason)),
      );
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
    setAuthorizationError(null);
    void startSession()
      .then(() => cloudSession.authorize("choose", requestOptions()))
      .then(requireConnectOutcome)
      .catch((reason) => setAuthorizationError(message(reason)));
  }, [requestOptions, startSession]);

  const reauthorizeCurrentCollection = useCallback(() => {
    setPickerOpen(false);
    setAuthorizationError(null);
    void startSession()
      .then(() => cloudSession.authorize("selected", requestOptions()))
      .then(requireConnectOutcome)
      .catch((reason) => setAuthorizationError(message(reason)));
  }, [requestOptions, startSession]);

  const selectCollection = useCallback(
    (collectionId: string) => {
      void startSession()
        .then(() => {
          requireConnectOutcome(
            cloudSession.select(collectionId, { history: "replace" }),
          );
          setAuthorizationError(null);
          setPickerOpen(false);
        })
        .catch((reason) => setAuthorizationError(message(reason)));
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

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
