import { Trans } from "@lingui/react/macro";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { ChevronDown } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { Mdbase } from "@mdbase-dev/sdk";
import {
  CollectionGate,
  type CollectionUiOptions,
  type CollectionView,
} from "@mdbase-dev/ui/collections";
import "@mdbase-dev/ui/collections.css";

import {
  taskNotesMdbase,
  taskNotesUnsyncedEnabled,
} from "../cloud/tasknotes-application";
import { followNativeSignInReturn } from "../native/sign-in";
import { tasknotesMarkUrl } from "./assets";
import type { OpenedCollection } from "./opened-collection";
import { OpenProblemDetails } from "./open-problem-details";
import { followSignOutRoute } from "./sign-out-route";
import { StarterViewArming } from "./starter-view-arming";

const app = {
  name: "TaskNotes",
  mark: <img alt="" src={tasknotesMarkUrl} />,
};

type Workspace = ComponentType<Parameters<typeof OpenedCollection>[0]>;

// The workspace is most of the app's code and is not needed until a collection
// is ready, so it loads beside the SDK's startup instead of ahead of it.
type ReadyCollection = typeof import("./held-collection").ReadyCollection;
let readyCollection: ReadyCollection | null = null;
let readyCollectionLoading: Promise<ReadyCollection> | null = null;
function loadReadyCollection(): Promise<ReadyCollection> {
  readyCollectionLoading ??= import("./held-collection").then(
    (module) => (readyCollection = module.ReadyCollection),
    (error: unknown) => {
      // The next caller fetches again instead of keeping this failure.
      readyCollectionLoading = null;
      throw error;
    },
  );
  return readyCollectionLoading;
}

/** The ready collection, once its code has arrived. Not `lazy` with Suspense:
 * React holds a suspended tree back for a moment after showing its fallback,
 * which would delay a workspace whose code is already here. */
function LoadedReadyCollection(props: Parameters<ReadyCollection>[0]) {
  const [state, setState] = useState<
    { Component: ReadyCollection } | { error: unknown } | null
  >(() => (readyCollection ? { Component: readyCollection } : null));
  useEffect(() => {
    if (state) return;
    let current = true;
    loadReadyCollection()
      // The fetch that failed may be the early one, begun before this mounted.
      .catch(() => loadReadyCollection())
      .then(
        (Component) => current && setState({ Component }),
        (error: unknown) => current && setState({ error }),
      );
    return () => {
      current = false;
    };
  }, [state]);
  if (!state) return <WorkspaceLoading />;
  // The app's error boundary reports a workspace that could not be fetched.
  if ("error" in state) throw state.error;
  return <state.Component {...props} />;
}

/** All routes share one SDK entry; the shared collection UI owns every screen
 * before a collection is ready, and the header switcher afterwards. */
export function TaskNotesApp({
  mdbase: supplied,
  Workspace,
  unsynced = taskNotesUnsyncedEnabled(),
}: {
  mdbase?: Mdbase;
  Workspace?: Workspace;
  /** Offer "Continue without connecting" (the entry was created with it). */
  unsynced?: boolean;
} = {}) {
  const [mdbase] = useState(() => supplied ?? taskNotesMdbase());
  const [arming] = useState(() => new StarterViewArming(mdbase.getSnapshot()));
  useEffect(() => arming.follow(mdbase), [arming, mdbase]);
  useEffect(() => followSignOutRoute(mdbase), [mdbase]);
  useEffect(
    () =>
      Capacitor.isNativePlatform()
        ? followNativeSignInReturn(mdbase)
        : undefined,
    [mdbase],
  );
  useMdbaseLifetime(mdbase);
  useEffect(() => {
    // A failed early fetch is tried again when a collection is ready, and
    // reported if it fails then too.
    void loadReadyCollection().catch(() => undefined);
  }, []);
  const ui = useMemo<CollectionUiOptions>(
    () => ({ mdbase, app, ...(unsynced ? { unsynced: true } : {}) }),
    [mdbase, unsynced],
  );
  return (
    <CollectionGate {...ui} extraActions={(view) => gateExtras(view, mdbase)}>
      {(connection) => (
        <LoadedReadyCollection
          arming={arming}
          connection={connection}
          ui={ui}
          {...(Workspace ? { Workspace } : {})}
        />
      )}
    </CollectionGate>
  );
}

/** The gate starts the SDK; close it when the app really unmounts (not on
 * effect replay). */
function useMdbaseLifetime(mdbase: Mdbase) {
  const lifetime = useRef({ mounts: 0 });
  useEffect(() => {
    const current = lifetime.current;
    current.mounts++;
    return () => {
      current.mounts--;
      queueMicrotask(() => {
        if (current.mounts) return;
        // Worker/SQL/lease drain stays SDK-owned; a failed close is quarantined.
        void mdbase.close().catch(() => undefined);
      });
    };
  }, [mdbase]);
}

/** Where the workspace's own opening screen puts the mark, so nothing moves
 * when it takes over. */
function WorkspaceLoading() {
  return (
    <main className="opening-screen" aria-busy="true">
      <img alt="" src={tasknotesMarkUrl} />
    </main>
  );
}

/** Signed out: what mdbase is. A problem: how to report it, with the SDK's
 * code (issue #436: the shared copy for an unclassified code names no cause). */
function gateExtras(view: CollectionView, mdbase: Mdbase) {
  if (view.kind === "signed_out") return <MdbaseExplainer />;
  if (view.kind === "problem" || view.kind === "unavailable")
    return <OpenProblemDetails mdbase={mdbase} />;
  return null;
}

function MdbaseExplainer() {
  return (
    <details className="mdbase-explainer">
      <summary>
        <span>
          <Trans>What is mdbase?</Trans>
        </span>
        <ChevronDown aria-hidden="true" size={16} />
      </summary>
      <p>
        <Trans>
          mdbase keeps your tasks as portable Markdown files while giving
          compatible apps a shared way to understand them. In mdbase, you choose
          a collection and approve TaskNotes’ access, whether it’s hosted by
          mdbase or available from a connected computer.
        </Trans>
      </p>
    </details>
  );
}
