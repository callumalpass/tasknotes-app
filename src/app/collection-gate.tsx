import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { cloudSession, isCloudCallback } from "../cloud/connect";
import { requireConnectOutcome } from "../cloud/outcome";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import { useCloudSessionSnapshot } from "../cloud/use-session";
import { appPlatform } from "../native/app-platform";
import { CollectionPicker } from "./collection-picker";

const CloudCollection = lazy(() => import("./cloud-collection"));

export function CollectionGate() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [authorizationError, setAuthorizationError] = useState<string | null>(
    null,
  );
  const handledCallbackUrls = useRef(new Set<string>());
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

  const complete = useCallback(
    async (url: string) => {
      if (!isCloudCallback(url) || handledCallbackUrls.current.has(url)) return;
      handledCallbackUrls.current.add(url);
      try {
        requireConnectOutcome(
          await cloudSession.handleAuthorizationCallback(url, requestOptions()),
        );
        setAuthorizationError(null);
        setPickerOpen(false);
      } catch (reason) {
        setAuthorizationError(message(reason));
      } finally {
        await appPlatform.closeAuthorizationBrowser();
      }
    },
    [requestOptions],
  );

  useEffect(() => {
    const initialize = async () => {
      requireConnectOutcome(await cloudSession.start(requestOptions()));
      if (isCloudCallback(location.href)) await complete(location.href);
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
  }, [complete, requestOptions]);

  const authorizeAnotherCollection = useCallback(() => {
    setPickerOpen(false);
    setAuthorizationError(null);
    void cloudSession
      .authorize("choose", requestOptions())
      .then(requireConnectOutcome)
      .catch((reason) => setAuthorizationError(message(reason)));
  }, [requestOptions]);

  const reauthorizeCurrentCollection = useCallback(() => {
    setPickerOpen(false);
    setAuthorizationError(null);
    void cloudSession
      .authorize("selected", requestOptions())
      .then(requireConnectOutcome)
      .catch((reason) => setAuthorizationError(message(reason)));
  }, [requestOptions]);

  const selectCollection = useCallback((collectionId: string) => {
    try {
      requireConnectOutcome(
        cloudSession.select(collectionId, { history: "replace" }),
      );
      setAuthorizationError(null);
      setPickerOpen(false);
    } catch (reason) {
      setAuthorizationError(message(reason));
    }
  }, []);

  const selectedCollectionId =
    "collectionId" in session ? session.collectionId : null;

  return (
    <>
      <Suspense fallback={<OpeningCollection />}>
        <CloudCollection
          authorizationError={authorizationError}
          authorizeAnotherCollection={authorizeAnotherCollection}
          openCollectionPicker={() => setPickerOpen(true)}
          reauthorizeCurrentCollection={reauthorizeCurrentCollection}
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
