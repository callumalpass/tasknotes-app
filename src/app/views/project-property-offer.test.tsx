import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ProjectPropertyOffer } from "./project-property-offer";

import type { TaskView } from "../../domain/view";

const fixture = vi.hoisted(() => ({
  readViewSource: vi.fn(),
  updateViewSource: vi.fn(),
}));
vi.mock("../repository-context", () => ({
  useRepository: () => ({
    repository: fixture,
    configuration: { fieldMapping: { projects: "projects" } },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

const today: TaskView = {
  key: "TaskNotes/Views/today.base#today",
  documentId: "today",
  documentName: "Today",
  id: "today",
  name: "Today",
  properties: [{ key: "note.scheduled" }, { key: "note.due" }],
  source: {
    path: "TaskNotes/Views/today.base",
    format: "obsidian.base",
    revision: "r1",
    writable: true,
  },
  presentation: { type: "tasknotes.task-list", mappings: {}, options: {} },
};

it("adds the project property to an existing Today view only when chosen", async () => {
  fixture.readViewSource.mockResolvedValue({
    path: today.source.path,
    format: "obsidian.base",
    revision: "r1",
    document:
      "views:\n  - type: tasknotesTaskList\n    name: Today\n    order:\n      - note.title\n      - note.scheduled\n",
  });
  fixture.updateViewSource.mockResolvedValue(undefined);
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(<ProjectPropertyOffer view={today} onChanged={onChanged} />);

  fireEvent.click(screen.getByRole("button", { name: "Show projects" }));

  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  const update = fixture.updateViewSource.mock.calls[0][0];
  expect(update.ifRevision).toBe("r1");
  expect(update.document).toContain("note.projects");
  expect(screen.queryByText("Show each task’s project on Today?")).toBeNull();
});

it("stays dismissed and never offers when projects are already shown", () => {
  const { unmount } = render(
    <ProjectPropertyOffer view={today} onChanged={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  unmount();
  render(<ProjectPropertyOffer view={today} onChanged={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Show projects" })).toBeNull();
  cleanup();
  localStorage.clear();

  render(
    <ProjectPropertyOffer
      view={{
        ...today,
        properties: [...today.properties, { key: "note.projects" }],
      }}
      onChanged={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Show projects" })).toBeNull();
  expect(fixture.updateViewSource).not.toHaveBeenCalled();
});
