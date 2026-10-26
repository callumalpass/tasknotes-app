import { fireEvent, render, screen, waitFor } from "../test/render";
import { expect, it, vi } from "vitest";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { combineTaskDateTime, todayString, type Task } from "../domain/task";
import { shiftTaskDate } from "../domain/task-date-actions";
import { TaskPropertyEditor } from "./task-property-editor";
const updateTask = vi.fn(async () => ({}));
vi.mock("../app/repository-context", () => ({
  useRepository: () => ({
    configuration: defaultTaskCollectionConfiguration(),
    updateTask,
  }),
}));
it("anchors a row recurrence edit to the due date when unscheduled", async () => {
  render(
    <TaskPropertyEditor
      task={{ id: "due-only", due: "2030-08-09" } as Task}
      detail={{ key: "recurrence", label: "Repeat", value: "", rawValue: "" }}
      anchor={{ top: 0, right: 0, bottom: 0, left: 0, width: 40 }}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("combobox", { name: "Repeat" }));
  fireEvent.click(screen.getByRole("option", { name: "Weekly" }));
  await waitFor(() =>
    expect(updateTask).toHaveBeenCalledWith(
      "due-only",
      expect.objectContaining({
        recurrence: "DTSTART:20300809;FREQ=WEEKLY;INTERVAL=1;BYDAY=FR",
      }),
    ),
  );
});

it("reschedules in one decision while preserving the existing time", async () => {
  const close = vi.fn();
  render(
    <TaskPropertyEditor
      task={{ id: "one", scheduled: "2026-08-13T09:00" } as Task}
      detail={{
        key: "scheduled",
        label: "Scheduled",
        value: "9am",
        rawValue: "2026-08-13T09:00",
      }}
      anchor={{ top: 0, right: 0, bottom: 0, left: 0, width: 40 }}
      onClose={close}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
  await waitFor(() =>
    expect(updateTask).toHaveBeenCalledWith("one", {
      scheduled: combineTaskDateTime(shiftTaskDate(todayString(), 1), "09:00"),
    }),
  );
  expect(close).toHaveBeenCalledOnce();
});
