import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useState } from "react";

import {
  cleanCallbackUrl,
  CLOUD_OPERATIONS,
  cloudConnect,
  isCloudCallback,
} from "../cloud/connect";
import { createConnectTaskRepository } from "../storage/connect-repository";
import { tasknotesMarkUrl } from "./assets";
import type { CollectionChoice } from "./collection-context";
import { OpenedCollection } from "./opened-collection";

export default function CloudCollection({
  choose,
  reset,
}: {
  choose(choice: CollectionChoice): void;
  reset(): void;
}) {
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [repository, setRepository] = useState(() =>
    cloudConnect.connection()
      ? createConnectTaskRepository(cloudConnect)
      : null,
  );
  const changeCollection = useCallback(() => {
    cloudConnect.disconnect();
    setCallbackError(null);
    setRepository(null);
  }, []);

  const complete = useCallback(async (url: string) => {
    if (!isCloudCallback(url)) return;
    const callback = new URL(url);
    const denied = callback.searchParams.get("error");
    if (denied) {
      setCallbackError(
        callback.searchParams.get("error_description") ??
          "Cloud access was not approved.",
      );
      await finishBrowserCallback();
      return;
    }
    try {
      await cloudConnect.completeAuthorization(url);
      setCallbackError(null);
      setRepository(createConnectTaskRepository(cloudConnect));
      await finishBrowserCallback();
    } catch (reason) {
      setCallbackError(message(reason));
    }
  }, []);

  useEffect(() => {
    if (isCloudCallback(location.href)) {
      const callbackUrl = location.href;
      queueMicrotask(() => void complete(callbackUrl));
    }
    if (!Capacitor.isNativePlatform()) return;
    const listeners = [
      CapacitorApp.addListener("appUrlOpen", ({ url }) => void complete(url)),
    ];
    void CapacitorApp.getLaunchUrl().then((value) => {
      if (value?.url) void complete(value.url);
    });
    return () => {
      for (const listener of listeners)
        void listener.then((handle) => handle.remove());
    };
  }, [complete]);

  if (!repository)
    return <CloudConnection error={callbackError} onBack={reset} />;

  return (
    <OpenedCollection
      changeConnectedCollection={changeCollection}
      choice="cloud"
      choose={choose}
      repository={repository}
    />
  );
}

function CloudConnection({
  error,
  onBack,
}: {
  error: string | null;
  onBack(): void;
}) {
  const [opening, setOpening] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  function connect() {
    setOpening(true);
    setStartError(null);
    void cloudConnect.authorize([...CLOUD_OPERATIONS]).catch((reason) => {
      setOpening(false);
      setStartError(message(reason));
    });
  }

  return (
    <main className="collection-welcome cloud-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <p className="eyebrow">mdbase</p>
        <h1>Open your TaskNotes collection.</h1>
        <p>
          Choose a collection from mdbase cloud or from a computer running
          mdbase connect.
        </p>
      </div>
      {error || startError ? (
        <p className="inline-error" role="alert">
          {error ?? startError}
        </p>
      ) : null}
      <div className="welcome-actions">
        <button
          className="outline-action"
          disabled={opening && !error}
          type="button"
          onClick={connect}
        >
          {opening && !error ? "Opening mdbase…" : "Continue to mdbase"}
        </button>
        <button className="text-action" type="button" onClick={onBack}>
          Choose another location
        </button>
      </div>
    </main>
  );
}

async function finishBrowserCallback(): Promise<void> {
  if (Capacitor.isNativePlatform())
    await Browser.close().catch(() => undefined);
  else cleanCallbackUrl();
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
