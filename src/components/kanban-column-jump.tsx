import { useLingui } from "@lingui/react/macro";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export function KanbanColumnJump({
  boardRef,
  columns,
}: {
  boardRef: RefObject<HTMLDivElement | null>;
  columns: { key: string; label: string; count: number }[];
}) {
  const { t } = useLingui();
  const first = columns.find((column) => column.count > 0)?.key;
  const selected = useRef(first ?? columns[0]?.key);
  const initialized = useRef(false);
  const strip = useRef<HTMLElement>(null);
  const [activeKey, setActiveKey] = useState(first ?? columns[0]?.key);
  const keys = JSON.stringify(columns.map(({ key }) => key));
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const elements = [
      ...board.querySelectorAll<HTMLElement>("[data-kanban-column-key]"),
    ];
    let width = board.clientWidth;
    let frame = 0;
    const reveal = () => {
      const target = elements.find(
        (element) => element.dataset.kanbanColumnKey === selected.current,
      );
      if (target)
        board.scrollTo?.({
          left:
            board.scrollLeft +
            target.getBoundingClientRect().left -
            board.getBoundingClientRect().left,
          behavior: "instant",
        });
    };
    if (!initialized.current && first) {
      selected.current = first;
      initialized.current = true;
      setActiveKey(first);
      reveal();
    }
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (width !== board.clientWidth) return;
        const left = board.getBoundingClientRect().left;
        const nearest = elements.reduce<HTMLElement | undefined>(
          (current, element) =>
            !current ||
            Math.abs(element.getBoundingClientRect().left - left) <
              Math.abs(current.getBoundingClientRect().left - left)
              ? element
              : current,
          undefined,
        );
        if (nearest?.dataset.kanbanColumnKey) {
          selected.current = nearest.dataset.kanbanColumnKey;
          setActiveKey(selected.current);
        }
      });
    };
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            revealJump(strip.current);
            if (width === board.clientWidth) return;
            width = board.clientWidth;
            reveal();
          });
    resize?.observe(board);
    if (strip.current) resize?.observe(strip.current);
    board.addEventListener("scroll", onScroll);
    return () => {
      resize?.disconnect();
      board.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [boardRef, keys, first]);
  useLayoutEffect(() => {
    revealJump(strip.current);
  }, [activeKey]);
  if (columns.length < 2) return null;
  return (
    <nav
      aria-label={t({ message: "Board columns" })}
      className="kanban-column-jump"
      ref={strip}
    >
      {columns.map((column) => (
        <button
          aria-current={column.key === activeKey ? "true" : undefined}
          data-kanban-jump-key={column.key}
          key={column.key}
          type="button"
          onClick={() => {
            initialized.current = true;
            selected.current = column.key;
            const board = boardRef.current;
            const target = board?.querySelector<HTMLElement>(
              `[data-kanban-column-key="${CSS.escape(column.key)}"]`,
            );
            if (board && target)
              board.scrollTo?.({
                left:
                  board.scrollLeft +
                  target.getBoundingClientRect().left -
                  board.getBoundingClientRect().left,
                behavior: "instant",
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

function revealJump(strip: HTMLElement | null) {
  const button = strip?.querySelector<HTMLElement>("[aria-current='true']");
  if (!strip || !button) return;
  const bounds = strip.getBoundingClientRect();
  const target = button.getBoundingClientRect();
  const offset =
    target.left < bounds.left
      ? target.left - bounds.left
      : target.right > bounds.right
        ? target.right - bounds.right
        : 0;
  if (offset)
    strip.scrollTo?.({ left: strip.scrollLeft + offset, behavior: "instant" });
}
