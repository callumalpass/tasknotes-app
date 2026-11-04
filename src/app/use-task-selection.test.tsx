import { act, render, screen } from "@testing-library/react";
import { memo } from "react";
import { expect, it } from "vitest";
import { SelectionContext, SelectableContext } from "./task-selection-context";
import { TaskSelectionStore } from "./task-selection-store";
import { useTaskSelection } from "./use-task-selection";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";

it("renders only the changed row when selecting within a long memoized list", () => {
  const store = new TaskSelectionStore(),
    model = new TaskNotesTaskModel();
  const tasks = Array.from({ length: 500 }, (_, index) =>
    model.create({ title: String(index) }, { id: String(index) }),
  );
  store.register({}, tasks);
  const rendered = new Map<string, number>();
  const Row = memo(function Row({ id }: { id: string }) {
    const { selected } = useTaskSelection(id);
    rendered.set(id, (rendered.get(id) ?? 0) + 1);
    return <button aria-pressed={selected}>{id}</button>;
  });
  render(
    <SelectionContext.Provider value={store}>
      <SelectableContext.Provider value={true}>
        {tasks.map((task) => (
          <Row key={task.id} id={task.id} />
        ))}
      </SelectableContext.Provider>
    </SelectionContext.Provider>,
  );
  rendered.clear();
  act(() => store.toggle("7"));
  expect([...rendered]).toEqual([["7", 1]]);
  expect(screen.getByRole("button", { name: "7" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
