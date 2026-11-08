import { useEffect, useState } from "react";
import {
  hasTransferWork,
  pendingTransferSource,
} from "../application/local-transfer";
import type { LocalTaskRepository } from "../storage/local-task-repository";

type LocalTransferSource = Pick<
  LocalTaskRepository,
  "exportSnapshot" | "transfer" | "transferHistory" | "subscribe"
>;

/** Visibility follows the destination's confirmed import history, not retained
 * recovery copies. An older read must never restore a stale review prompt. */
export function useLocalTransferReview(
  local: LocalTransferSource,
  destination: string | undefined,
): boolean {
  const [review, setReview] = useState<{
    destination: string;
    needed: boolean;
  }>();
  useEffect(() => {
    if (!destination) return;
    let generation = 0;
    const update = () => {
      const current = ++generation;
      void Promise.all([
        local.exportSnapshot(),
        local.transfer(destination),
        local.transferHistory(destination),
      ])
        .then(([source, pending, history]) => {
          if (current !== generation) return;
          setReview({
            destination,
            needed:
              Boolean(pending) ||
              hasTransferWork(pendingTransferSource(source, history)),
          });
        })
        .catch(() => undefined);
    };
    const stop = local.subscribe(update);
    update();
    return () => {
      generation++;
      stop();
    };
  }, [local, destination]);
  return !!review && review.destination === destination && review.needed;
}
