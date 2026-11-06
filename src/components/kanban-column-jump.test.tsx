import { useRef } from "react";
import { act, fireEvent, render, screen } from "../test/render";
import { expect, it, vi } from "vitest";
import { KanbanColumnJump } from "./kanban-column-jump";

function Board({
  columns,
  scrollTo,
  overflowing = true,
}: {
  columns: { key: string; label: string; count: number }[];
  scrollTo?: HTMLDivElement["scrollTo"];
  overflowing?: boolean;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <KanbanColumnJump boardRef={boardRef} columns={columns} />
      <div
        ref={(element) => {
          boardRef.current = element;
          if (element && scrollTo) element.scrollTo = scrollTo;
          if (element) {
            Object.defineProperty(element, "clientWidth", {
              configurable: true,
              value: 700,
            });
            Object.defineProperty(element, "scrollWidth", {
              configurable: true,
              value: overflowing ? 1000 : 700,
            });
          }
        }}
      >
        {columns.map(({ key }) => (
          <section data-kanban-column-key={key} key={key} />
        ))}
      </div>
    </>
  );
}

it("initially reveals the first populated column without removing empty columns", () => {
  const scrollTo = vi.fn();
  const { rerender } = render(
    <Board
      scrollTo={scrollTo}
      columns={[
        { key: "empty", label: "Custom empty", count: 0 },
        { key: "match", label: "Custom matching", count: 3 },
      ]}
    />,
  );
  expect(
    screen.getByRole("button", { name: /Custom matching\s*3/ }),
  ).toHaveAttribute("aria-current", "true");
  expect(scrollTo).toHaveBeenCalledOnce();
  const empty = screen.getByRole("button", { name: /Custom empty\s*0/ });
  fireEvent.click(empty);
  expect(empty).toHaveAttribute("aria-current", "true");
  rerender(
    <Board
      columns={[
        { key: "empty", label: "Custom empty", count: 0 },
        { key: "match", label: "Custom matching", count: 4 },
      ]}
    />,
  );
  expect(empty).toHaveAttribute("aria-current", "true");
});

it("hides the jump strip when all configured columns fit", () => {
  const { container } = render(
    <Board
      overflowing={false}
      columns={Array.from({ length: 12 }, (_, index) => ({
        key: String(index),
        label: `Status ${index}`,
        count: 1,
      }))}
    />,
  );
  expect(container.querySelector(".kanban-column-jump")).toHaveAttribute(
    "hidden",
  );
  expect(
    screen.queryByRole("navigation", { name: "Board columns" }),
  ).not.toBeInTheDocument();
});

it("keeps an activated end column current at the clamped edge until scrolling away", async () => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  const { container } = render(
    <Board
      columns={[
        { key: "first", label: "Revising", count: 1 },
        { key: "last", label: "Shipped", count: 1 },
      ]}
    />,
  );
  const board = container.querySelector(
    "[data-kanban-column-key]",
  )!.parentElement!;
  const firstColumn = board.firstElementChild!;
  const lastColumn = board.lastElementChild!;
  vi.spyOn(firstColumn, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 300, 100),
  );
  vi.spyOn(lastColumn, "getBoundingClientRect").mockReturnValue(
    new DOMRect(300, 0, 300, 100),
  );
  const last = screen.getByRole("button", { name: /Shipped/ });
  fireEvent.click(last);
  await act(() => board.dispatchEvent(new Event("scroll")));
  expect(last).toHaveAttribute("aria-current", "true");
  board.scrollLeft = 20;
  await act(() => board.dispatchEvent(new Event("scroll")));
  expect(screen.getByRole("button", { name: /Revising/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  vi.restoreAllMocks();
});
