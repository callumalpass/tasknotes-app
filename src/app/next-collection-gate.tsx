import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import type { TaskRepository } from "../application/ports/task-repository";
import { loadNativeBuild } from "../cloud/next-native-build";
import type { NextInstallationBuildInput } from "../cloud/next-installation-protocol";
import { NextInstallationScreen } from "./next-installation-screen";
import { OpenedCollection } from "./opened-collection";

/** Keep the installation owner mounted while its original data-only repository
 * is rendered. Replacing the held lifetime closes it, not just the UI selection. */
export function NextCollectionGate({
  loadBuild = loadNativeBuild,
  InstallationScreen = NextInstallationScreen,
}: {
  loadBuild?: typeof loadNativeBuild;
  InstallationScreen?: ComponentType<
    Parameters<typeof NextInstallationScreen>[0]
  >;
} = {}) {
  const [build, setBuild] = useState<NextInstallationBuildInput | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [repository, setRepository] = useState<TaskRepository | null>(null);
  const [generation, setGeneration] = useState(0);
  const ownership = useRef<{
    generation: number;
    repository: TaskRepository | null;
  }>({ generation: 0, repository: null });
  useEffect(() => {
    const owner = new AbortController();
    void loadBuild(owner.signal).then(
      (next) => {
        if (!owner.signal.aborted) setBuild(next);
      },
      () => {
        if (!owner.signal.aborted) setUnavailable(true);
      },
    );
    return () => owner.abort();
  }, [loadBuild]);
  const receive = useCallback(
    async (held: TaskRepository) => {
      // A Worker exposes exactly one original repository. Replacement requires
      // change(), which closes/remounts that owner, not just its consumer.
      if (
        ownership.current.generation !== generation ||
        (ownership.current.repository && ownership.current.repository !== held)
      )
        throw new Error(
          "The original native repository owner must be replaced first.",
        );
      ownership.current.repository = held;
      setRepository(held);
    },
    [generation],
  );
  const change = useCallback(() => {
    ownership.current = {
      generation: ownership.current.generation + 1,
      repository: null,
    };
    setRepository(null);
    setGeneration(ownership.current.generation);
  }, []);
  const preservePending = useCallback(async () => {
    throw new Error(
      "Native pending changes must be reconciled with the original collection; they cannot be discarded here.",
    );
  }, []);
  if (unavailable)
    return (
      <main className="opening-screen">
        <h1>Open TaskNotes</h1>
        <p role="alert">
          This build has no configured native release bundle. Preserve device
          storage and use a configured app build.
        </p>
      </main>
    );
  if (!build)
    return (
      <main className="opening-screen">
        <p>Loading TaskNotes…</p>
      </main>
    );
  return (
    <>
      <div hidden={repository !== null}>
        <InstallationScreen
          key={generation}
          build={build}
          onCollection={receive}
        />
      </div>
      {repository ? (
        <OpenedCollection
          key={generation}
          repository={repository}
          authorizeAnotherCollection={change}
          changeCollection={change}
          reauthorizeCurrentCollection={change}
          discardPendingRecovery={preservePending}
        />
      ) : null}
    </>
  );
}
