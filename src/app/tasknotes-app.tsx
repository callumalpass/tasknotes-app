import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import { ChevronDown } from "lucide-react";
import type { Mdbase, MdbaseApplicationConnection } from "@mdbase-dev/sdk";
import {
  CollectionGate,
  CollectionProblem,
  type CollectionUiOptions,
} from "@mdbase-dev/ui/collections";
import "@mdbase-dev/ui/collections.css";

import { addTaskNotesStarterViews } from "../application/ensure-default-view-source";
import { taskNotesMdbase } from "../cloud/tasknotes-application";
import { registerStartupTiming } from "../observability/startup-timing";
import { NextTaskRepository } from "../storage/next-repository";
import { tasknotesMarkUrl } from "./assets";
import type { CollectionGateContextValue } from "./collection-context";
import { OpenedCollection } from "./opened-collection";
import { StarterViewArming } from "./starter-view-arming";

const app = {
  name: "TaskNotes",
  mark: <img alt="" src={tasknotesMarkUrl} />,
};

type Workspace = ComponentType<Parameters<typeof OpenedCollection>[0]>;

/** All routes share one SDK entry; the shared collection UI owns every screen
 * before a collection is ready, and the header switcher afterwards. */
export function TaskNotesApp({
  mdbase: supplied,
  Workspace = OpenedCollection,
}: {
  mdbase?: Mdbase;
  Workspace?: Workspace;
} = {}) {
  const [mdbase] = useState(() => supplied ?? taskNotesMdbase());
  const [arming] = useState(() => new StarterViewArming(mdbase.getSnapshot()));
  useEffect(() => arming.follow(mdbase), [arming, mdbase]);
  useMdbaseLifetime(mdbase);
  const ui = useMemo<CollectionUiOptions>(() => ({ mdbase, app }), [mdbase]);
  return (
    <CollectionGate {...ui} extraActions={<MdbaseExplainer />}>
      {(connection) => (
        <ReadyCollection
          arming={arming}
          connection={connection}
          ui={ui}
          Workspace={Workspace}
        />
      )}
    </CollectionGate>
  );
}

/** Start once; close when the app really unmounts (not on effect replay). */
function useMdbaseLifetime(mdbase: Mdbase) {
  const lifetime = useRef({ mounts: 0, started: false });
  useEffect(() => {
    const current = lifetime.current;
    current.mounts++;
    if (!current.started) {
      current.started = true;
      // Failures are on the snapshot; the gate shows them with their fix.
      void mdbase.start().catch(() => undefined);
    }
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

// Stable identity: the workspace must not restart when the gate re-renders.
async function preserveOriginalPending(): Promise<void> {
  throw new Error(
    "Original pending collection changes cannot be discarded here.",
  );
}

function ReadyCollection(props: {
  arming: StarterViewArming;
  connection: MdbaseApplicationConnection;
  ui: CollectionUiOptions;
  Workspace: Workspace;
}) {
  // The SDK keeps one connection object per collection generation: a new
  // generation is a new lifetime; re-renders and re-checks keep the workspace.
  return <HeldCollection key={props.connection.generation} {...props} />;
}

function HeldCollection({
  arming,
  connection,
  ui,
  Workspace,
}: {
  arming: StarterViewArming;
  connection: MdbaseApplicationConnection;
  ui: CollectionUiOptions;
  Workspace: Workspace;
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

  return (
    <>
      {problem !== undefined ? (
        <CollectionProblem {...ui} problem={problem} />
      ) : null}
      <Workspace
        actions={actions}
        repository={repository}
        discardPendingRecovery={preserveOriginalPending}
      />
    </>
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

function MdbaseExplainer() {
  return (
    <details className="mdbase-explainer">
      <summary>
        <span>What is mdbase?</span>
        <ChevronDown aria-hidden="true" size={16} />
      </summary>
      <p>
        mdbase keeps your tasks as portable Markdown files while giving
        compatible apps a shared way to understand them. In mdbase, you choose a
        collection and approve TaskNotes’ access, whether it’s hosted by mdbase
        or available from a connected computer.
      </p>
    </details>
  );
}
