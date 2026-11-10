import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ComponentType } from "react";
import type { MdbaseApplicationConnection } from "@mdbase-dev/sdk";
import {
  CollectionProblem,
  type CollectionUiOptions,
} from "@mdbase-dev/ui/collections";

import { addTaskNotesStarterViews } from "../application/ensure-default-view-source";
import { registerStartupTiming } from "../observability/startup-timing";
import { NextTaskRepository } from "../storage/next-repository";
import type { CollectionGateContextValue } from "./collection-context";
import {
  ConnectionNoticeContext,
  useConnectionNotice,
} from "./connection-notice";
import { OpenedCollection } from "./opened-collection";
import type { StarterViewArming } from "./starter-view-arming";

type Workspace = ComponentType<Parameters<typeof OpenedCollection>[0]>;

// Stable identity: the workspace must not restart when the gate re-renders.
async function preserveOriginalPending(): Promise<void> {
  throw new Error(
    "Original pending collection changes cannot be discarded here.",
  );
}

/** A ready collection's workspace. Loaded on demand by `TaskNotesApp`, so it
 * and everything it imports stay out of the entry chunk. */
export function ReadyCollection(props: {
  arming: StarterViewArming;
  connection: MdbaseApplicationConnection;
  ui: CollectionUiOptions;
  Workspace?: Workspace;
}) {
  // The SDK keeps one connection object per collection generation: a new
  // generation is a new lifetime; re-renders and re-checks keep the workspace.
  return <HeldCollection key={props.connection.generation} {...props} />;
}

function HeldCollection({
  arming,
  connection,
  ui,
  Workspace = OpenedCollection,
}: {
  arming: StarterViewArming;
  connection: MdbaseApplicationConnection;
  ui: CollectionUiOptions;
  Workspace?: Workspace;
}) {
  const repository = useHeldRepository(connection);
  const armed = useSyncExternalStore(arming.subscribe, arming.getArmed);
  useEffect(() => {
    if (armed !== connection.id || !arming.take(armed)) return;
    // A collection that already has any view source is left untouched. On
    // refusal the empty state keeps offering Add starter views.
    void repository
      .taskConfiguration()
      .then((configuration) =>
        addTaskNotesStarterViews(repository, configuration, {
          onlyIfNoViews: true,
        }),
      )
      .catch(() => undefined);
  }, [armed, arming, connection.id, repository]);

  const [problem, setProblem] = useState<unknown>(undefined);
  const { mdbase } = ui;
  const collectionId = connection.id;
  const actions = useMemo<CollectionGateContextValue>(() => {
    // Each SDK call runs synchronously in the click, so Connect keeps the gesture.
    const run = (call: () => Promise<unknown>) => {
      setProblem(undefined);
      call().catch((reason: unknown) => setProblem(reason));
    };
    return {
      collectionUi: ui,
      changeCollection: () => run(() => mdbase.chooseAnother()),
      reauthorizeCurrentCollection: () =>
        run(() => mdbase.approve(collectionId)),
    };
  }, [collectionId, mdbase, ui]);

  const notice = useConnectionNotice(mdbase);

  return (
    <ConnectionNoticeContext.Provider value={notice}>
      {problem !== undefined ? (
        <CollectionProblem {...ui} problem={problem} />
      ) : null}
      <Workspace
        actions={actions}
        repository={repository}
        discardPendingRecovery={preserveOriginalPending}
      />
    </ConnectionNoticeContext.Provider>
  );
}

/** This connection's repository. It borrows the SDK client and is disposed
 * when the collection closes (not on StrictMode effect replay). */
function useHeldRepository(
  connection: MdbaseApplicationConnection,
): NextTaskRepository {
  const [repository] = useState(() => {
    const created = new NextTaskRepository(
      connection.records,
      connection.displayName,
      connection.scope.account,
      { clientOwnership: "borrowed", peopleClient: connection.people },
    );
    // Only app-owned stages: no invented native/Worker durations or extra reads.
    registerStartupTiming(created);
    return created;
  });
  const lifetime = useRef({ mounts: 0 });
  useEffect(() => {
    const current = lifetime.current;
    current.mounts++;
    return () => {
      current.mounts--;
      queueMicrotask(() => {
        if (!current.mounts) repository.dispose();
      });
    };
  }, [repository]);
  return repository;
}
