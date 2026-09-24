import { useEffect, useState, type RefObject } from "react";

/**
 * Phone boards show one full-width column at a time. This bar names every
 * column, marks the visible one, and scrolls to a chosen column.
 */
export function KanbanColumnJump({
  boardRef,
  columns,
}: {
  boardRef: RefObject<HTMLDivElement | null>;
  columns: { key: string; label: string; count: number }[];
}) {
  const [activeKey, setActiveKey] = useState(columns[0]?.key);
  useEffect(() => {
    const board = boardRef.current;
    if (!board || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const key = (visible?.target as HTMLElement | undefined)?.dataset
          .kanbanColumnKey;
        if (key) setActiveKey(key);
      },
      { root: board, threshold: [0.5, 0.75] },
    );
    board
      .querySelectorAll<HTMLElement>("[data-kanban-column-key]")
      .forEach((column) => observer.observe(column));
    return () => observer.disconnect();
  }, [boardRef, columns]);

  if (columns.length < 2) return null;
  return (
    <nav aria-label="Board columns" className="kanban-column-jump">
      {columns.map((column) => (
        <button
          aria-current={column.key === activeKey ? "true" : undefined}
          key={column.key}
          type="button"
          onClick={() => {
            const target = boardRef.current?.querySelector<HTMLElement>(
              `[data-kanban-column-key="${CSS.escape(column.key)}"]`,
            );
            target?.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
              inline: "start",
            });
            setActiveKey(column.key);
          }}
        >
          <span>{column.label}</span>
          <small>{column.count}</small>
        </button>
      ))}
    </nav>
  );
}
