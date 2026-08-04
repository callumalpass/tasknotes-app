import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { unwrapConnectOutcome } from "@mdbase-dev/connect";
import { cloudSession, isCloudCallback } from "../cloud/connect";
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
  const session = useCloudSessionSnapshot();

  const complete = useCallback(async (url: string) => {
    if (!isCloudCallback(url) || handledCallbackUrls.current.has(url)) return;
    handledCallbackUrls.current.add(url);
    try {
      unwrapConnectOutcome(await cloudSession.handleAuthorizationCallback(url));
      setAuthorizationError(null);
      setPickerOpen(false);
    } catch (reason) {
      setAuthorizationError(message(reason));
    } finally {
      await appPlatform.closeAuthorizationBrowser();
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      unwrapConnectOutcome(await cloudSession.start());
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
      void listener.then((handle) => handle?.remove());
    };
  }, [complete]);

  const authorizeAnotherCollection = useCallback(() => {
    setPickerOpen(false);
    setAuthorizationError(null);
    void cloudSession
      .authorize("choose")
      .then(unwrapConnectOutcome)
      .catch((reason) => setAuthorizationError(message(reason)));
  }, []);

  const reauthorizeCurrentCollection = useCallback(() => {
    setPickerOpen(false);
    setAuthorizationError(null);
    void cloudSession
      .authorize("selected")
      .then(unwrapConnectOutcome)
      .catch((reason) => setAuthorizationError(message(reason)));
  }, []);

  const selectCollection = useCallback((collectionId: string) => {
    try {
      unwrapConnectOutcome(
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
