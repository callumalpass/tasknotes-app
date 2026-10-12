import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { TaskView } from "../domain/view";

/** The same object while the view's content is unchanged. A catalog refresh
 * rebuilds every view object; that alone must not re-query or re-render. */
export function useStableView(
  view: TaskView | undefined,
): TaskView | undefined {
  const identity = view ? JSON.stringify(view) : "";
  const [stable, setStable] = useState({ identity, view });
  if (stable.identity !== identity) {
    setStable({ identity, view });
    return view;
  }
  return stable.view;
}

/** A callback with a fixed identity that always calls the latest `callback`,
 * so memoized rows are not re-rendered by a parent's new closures. */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
