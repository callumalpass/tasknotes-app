import { useSyncExternalStore } from "react";

import { cloudSession } from "./connect";

const subscribe = (listener: () => void) => cloudSession.subscribe(listener);
const getSnapshot = () => cloudSession.getSnapshot();

export function useCloudSessionSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
