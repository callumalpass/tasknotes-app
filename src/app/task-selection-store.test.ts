import { describe, expect, it, vi } from "vitest";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { TaskSelectionStore } from "./task-selection-store";

const model = new TaskNotesTaskModel();
const tasks = Array.from({ length: 500 }, (_, index) =>
  model.create({ title: `Task ${index}` }, { id: String(index) }),
);
const fixture = () => {
  const store = new TaskSelectionStore(),
    owner = {};
  store.register(owner, tasks);
  return { store, owner };
};
describe("task selection", () => {
  it("toggles and ranges in data order without mounted rows", () => {
    const { store } = fixture();
    store.toggle("3");
    store.range("403");
    expect(store.count).toBe(401);
    expect(store.selectedTasks.map((task) => task.id)).toEqual(
      tasks.slice(3, 404).map((task) => task.id),
    );
    store.range("1");
    expect(store.selectedTasks.map((task) => task.id)).toEqual(["1", "2", "3"]);
    store.toggle("2");
    expect(store.selectedTasks.map((task) => task.id)).toEqual(["1", "3"]);
  });
  it("extends from focus, preserves its anchor and can contract again", () => {
    const { store } = fixture();
    store.range("11", "10");
    store.range("12", "11");
    store.range("11", "12");
    expect(store.selectedTasks.map((task) => task.id)).toEqual(["10", "11"]);
  });
  it("prunes tasks removed by a query or collapsed section and keeps current summaries", () => {
    const { store, owner } = fixture();
    store.all();
    store.register(owner, [{ ...tasks[1], revision: 42 }, tasks[3]]);
    expect(store.selectedTasks.map((task) => task.id)).toEqual(["1", "3"]);
    expect(store.selectedTasks[0].revision).toBe(42);
    store.unregister(owner);
    expect(store.count).toBe(0);
  });
  it("selects unique records across project groups and clears on navigation", () => {
    const { store } = fixture();
    store.register({}, tasks.slice(0, 3));
    store.all();
    expect(store.count).toBe(500);
    store.clear();
    expect(store.count).toBe(0);
    expect(store.mode).toBe(false);
    store.toggle("3");
    store.range("4");
    expect(store.count).toBe(2);
  });
  it("changes only affected row snapshots and does not publish unchanged query refreshes", () => {
    const { store, owner } = fixture();
    const rowSnapshots = tasks.map((task) => store.isSelected(task.id));
    store.toggle("7");
    expect(
      tasks
        .filter(
          (task, index) => store.isSelected(task.id) !== rowSnapshots[index],
        )
        .map((task) => task.id),
    ).toEqual(["7"]);
    const listener = vi.fn();
    store.subscribe(listener);
    store.register(
      owner,
      tasks.map((task) => ({ ...task })),
    );
    expect(listener).not.toHaveBeenCalled();
  });
  it("locks selection while writes run and retains only failures", () => {
    const { store } = fixture();
    store.toggle("1");
    store.toggle("2");
    store.setBusy(true);
    store.toggle("3");
    store.all();
    store.range("4");
    expect(store.count).toBe(2);
    store.remove(["1"]);
    store.setBusy(false);
    expect(store.selectedTasks.map((task) => task.id)).toEqual(["2"]);
  });
});
