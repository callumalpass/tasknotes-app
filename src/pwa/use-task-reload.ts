import { useEffect, type RefObject } from "react";
import { registerReloadParticipant } from "./reload";

const clear = () => false;

export function useTaskReloadGuard<T>(
  {
    draftRef,
    dirtyRef,
    editVersion,
    savesInFlight,
    persist,
  }: {
    draftRef: RefObject<T>;
    dirtyRef: RefObject<boolean>;
    editVersion: RefObject<number>;
    savesInFlight: RefObject<Map<number, Promise<void>>>;
    persist(draft: T, version: number): Promise<void>;
  },
  needsReview: () => boolean = clear,
  writeState: () => unknown = clear,
): void {
  useEffect(
    () =>
      registerReloadParticipant({
        save: async () => {
          if (needsReview())
            throw new Error(
              "Review your recovered task edit before reloading.",
            );
          if (dirtyRef.current)
            await persist(draftRef.current, editVersion.current);
          await Promise.all([...savesInFlight.current.values()]);
        },
        check: () => {
          if (dirtyRef.current || needsReview() || writeState())
            throw new Error(
              "Some task changes are not saved. Keep this page open and finish saving before reloading.",
            );
        },
      }),
    [
      dirtyRef,
      draftRef,
      editVersion,
      savesInFlight,
      persist,
      needsReview,
      writeState,
    ],
  );
}
