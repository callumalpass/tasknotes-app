import { useRef } from "react";
import { fireEvent, render, screen } from "../test/render";
import { expect, it, vi } from "vitest";
import { KanbanColumnJump } from "./kanban-column-jump";

function Board({
  columns,
  scrollTo,
}: {
  columns: { key: string; label: string; count: number }[];
  scrollTo?: HTMLDivElement["scrollTo"];
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <KanbanColumnJump boardRef={boardRef} columns={columns} />
      <div
        ref={(element) => {
          boardRef.current = element;
          if (element && scrollTo) element.scrollTo = scrollTo;
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
