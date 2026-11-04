import { useContext, useSyncExternalStore, type MouseEvent } from "react";
import { SelectionContext, SelectableContext } from "./task-selection-context";
const noopSubscribe = () => () => {};

export function useTaskSelection(id: string) {
  const store = useContext(SelectionContext);
  const selectable = useContext(SelectableContext) && Boolean(store);
  const selected = useSyncExternalStore(
    selectable ? store!.subscribe : noopSubscribe,
    () => selectable && store!.isSelected(id),
  );
  return {
    selected,
    selectable,
    active: () => selectable && store!.mode,
    start: () => {
      if (selectable) {
        store!.enter();
        store!.toggle(id);
      }
    },
    click(event: MouseEvent<HTMLElement>) {
      if (!selectable || !event.currentTarget.contains(event.target as Node))
        return false;
      const target = event.target as HTMLElement;
      // Completion and other inline controls keep their ordinary action.
      if (
        target.closest(
          "button:not(.task-row-title), a, input, textarea, select, [contenteditable]",
        )
      )
        return false;
      const touch =
        "pointerType" in event.nativeEvent &&
        event.nativeEvent.pointerType === "touch";
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !store!.explicit &&
        !(touch && store!.mode)
      )
        return false;
      event.preventDefault();
      event.stopPropagation();
      if (store!.busy) return true;
      if (event.shiftKey) store!.range(id);
      else store!.toggle(id);
      event.currentTarget
        .querySelector<HTMLButtonElement>(".task-row-title")
        ?.focus({ preventScroll: true });
      return true;
    },
  };
}
