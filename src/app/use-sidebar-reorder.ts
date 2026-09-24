import { useState, type DragEvent, type KeyboardEvent } from "react";

type Placement = "before" | "after";

/**
 * Desktop sidebar ordering: drag a destination with a fine pointer, or press
 * Alt+Up/Down while it has focus. Every move goes through the same adjacent
 * swap used by Manage views, so the first destination remains Home.
 */
export function useSidebarReorder(
  navigationKeys: readonly string[],
  onMove: ((key: string, direction: -1 | 1) => void) | undefined,
) {
  const [dragKey, setDragKey] = useState<string>();
  const [drop, setDrop] = useState<{ key: string; placement: Placement }>();
  const [announcement, setAnnouncement] = useState("");

  function moveBy(key: string, steps: number) {
    if (!onMove || !steps) return;
    const direction = steps < 0 ? -1 : 1;
    for (let step = 0; step < Math.abs(steps); step += 1)
      onMove(key, direction);
  }

  function itemProps(key: string, label: string) {
    if (!onMove) return {};
    const index = navigationKeys.indexOf(key);
    return {
      draggable: true,
      "data-drop":
        drop?.key === key && dragKey !== key ? drop.placement : undefined,
      "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
      onDragStart(event: DragEvent<HTMLElement>) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", label);
        setDragKey(key);
      },
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!dragKey) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        setDrop({
          key,
          placement:
            event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
        });
      },
      onDrop(event: DragEvent<HTMLElement>) {
        if (!dragKey) return;
        event.preventDefault();
        const from = navigationKeys.indexOf(dragKey);
        const placement =
          drop?.key === key ? drop.placement : ("after" as Placement);
        const target =
          placement === "before"
            ? from < index
              ? index - 1
              : index
            : from < index
              ? index
              : index + 1;
        moveBy(dragKey, target - from);
        if (target !== from) setAnnouncement(`${label} moved.`);
        setDragKey(undefined);
        setDrop(undefined);
      },
      onDragEnd() {
        setDragKey(undefined);
        setDrop(undefined);
      },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (!event.altKey) return;
        const direction =
          event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        const next = index + direction;
        if (!direction || next < 0 || next >= navigationKeys.length) return;
        event.preventDefault();
        onMove(key, direction);
        setAnnouncement(
          `${label} moved ${direction < 0 ? "up" : "down"}${next === 0 ? ", now Home" : ""}.`,
        );
      },
    };
  }

  return { itemProps, announcement };
}
