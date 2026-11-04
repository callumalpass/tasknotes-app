import { useLingui } from "@lingui/react/macro";
import { CheckCheck } from "lucide-react";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { hasOpenOverlay } from "../components/overlays/overlay-stack";
import {
  isEditableTarget,
  plainShortcutsSuspended,
} from "./keyboard-shortcuts";
import { TaskSelectionStore } from "./task-selection-store";
import { BulkTaskActions } from "./bulk-task-actions";
import type { TaskSummary } from "../domain/task";

import { SelectionContext, SelectableContext } from "./task-selection-context";

export function TaskSelectionProvider({
  children,
  navigationKey,
}: {
  children: ReactNode;
  navigationKey: string;
}) {
  const [store] = useState(() => new TaskSelectionStore());
  useLayoutEffect(() => {
    store.clear();
  }, [store, navigationKey]);
  return (
    <SelectionContext.Provider value={store}>
      {children}
      <SelectionKeyboard store={store} />
      <BulkTaskActions store={store} navigationKey={navigationKey} />
    </SelectionContext.Provider>
  );
}

/** Registration does not subscribe the list or its memoized rows to selection changes. */
export function TaskSelectionList({
  tasks,
  children,
  enabled = true,
}: {
  tasks: readonly TaskSummary[];
  children: ReactNode;
  enabled?: boolean;
}) {
  const store = useContext(SelectionContext);
  const owner = useRef({});
  useLayoutEffect(() => {
    store?.register(owner.current, enabled ? tasks : []);
  });
  useLayoutEffect(() => {
    const token = owner.current;
    return () => store?.unregister(token);
  }, [store]);
  return (
    <SelectableContext.Provider value={enabled}>
      {enabled ? <div data-task-selection-list="">{children}</div> : children}
    </SelectableContext.Provider>
  );
}

export function SelectTasksOption() {
  const { t } = useLingui();
  const store = useContext(SelectionContext);
  if (!store) return null;
  return (
    <button
      aria-label={t`Select tasks`}
      className="view-header-action"
      title={t`Select tasks`}
      type="button"
      onClick={() => store.enter()}
    >
      <CheckCheck aria-hidden="true" size={18} />
    </button>
  );
}

function SelectionKeyboard({ store }: { store: TaskSelectionStore }) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        isEditableTarget(event.target) ||
        event.isComposing ||
        event.defaultPrevented ||
        hasOpenOverlay() ||
        target?.closest("details[open]")
      )
        return;
      if (
        event.key === "Escape" &&
        !plainShortcutsSuspended(event) &&
        (store.mode || store.count)
      ) {
        event.preventDefault();
        store.clear();
        return;
      }
      const row = target?.closest<HTMLElement>(
        "[data-task-selection-list] .task-row[data-task-id]",
      );
      const region = target?.closest<HTMLElement>("[data-task-selection-list]");
      if (!region) return;
      const key = event.key.toLowerCase();
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        key === "a"
      ) {
        event.preventDefault();
        store.all();
        return;
      }
      if (!row || plainShortcutsSuspended(event)) return;
      const id = row.dataset.taskId!;
      if (key === "v" && !event.shiftKey) {
        event.preventDefault();
        store.toggle(id);
        return;
      }
      const direction =
        key === "j" || key === "arrowdown"
          ? 1
          : key === "k" || key === "arrowup"
            ? -1
            : 0;
      if (!direction || !event.shiftKey) return;
      event.preventDefault();
      const ids = store.ids,
        next = ids[ids.indexOf(id) + direction];
      if (!next) return;
      store.range(next, id);
      const title = region.querySelector<HTMLButtonElement>(
        `.task-row[data-task-id="${CSS.escape(next)}"] .task-row-title`,
      );
      if (title) {
        title.focus({ preventScroll: true });
        title.scrollIntoView({ block: "nearest" });
      } else
        region.dispatchEvent(
          new CustomEvent("tasknotes:reveal-task", { detail: next }),
        );
    };
    // Capture precedes the existing navigation handler without editing its layer.
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [store]);
  return null;
}
