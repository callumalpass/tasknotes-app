import { createContext, useContext, useEffect } from "react";
import type {
  RecordWriteStatus,
  RecordWriteTarget,
} from "../application/ports/task-repository";

export type RecordWriteEntry = {
  target: RecordWriteTarget;
  state: RecordWriteStatus;
};
export type RegisterWriteStatus = (entry: RecordWriteEntry) => () => void;
export const WriteStatusContext = createContext<RegisterWriteStatus | null>(
  null,
);

export function useRegisterWriteStatus(
  target: RecordWriteTarget,
  state: RecordWriteStatus | undefined,
) {
  const register = useContext(WriteStatusContext);
  const kind = target.kind;
  const key = target.kind === "source" ? target.path : target.id;
  useEffect(() => {
    if (!register || !state) return;
    return register({
      state,
      target: kind === "source" ? { kind, path: key } : { kind, id: key },
    });
  }, [register, kind, key, state]);
  return register !== null;
}
