import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "../../domain/task-configuration";
import {
  clearProjectJump,
  isProjectsPresentation,
  requestProjectJump,
  setFocusedProject,
} from "../project-jump";
import { ProjectsView } from "./projects-view";

import type { TaskSummary } from "../../domain/task";
import type { TaskView, TaskViewExecution } from "../../domain/view";

vi.mock("../repository-context", () => ({
  useRepository: () => ({
    configuration: defaultTaskCollectionConfiguration(),
  }),
}));

afterEach(cleanup);

function task(id: string, title: string, projects: string[]): TaskSummary {
  return {
    id,
    path: `Tasks/${id}.md`,
    title,
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    tags: ["action"],
    contexts: [],
    projects,
    attachments: [],
    assignees: [],
    blockedBy: [],
    skipped: false,
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: { projects },
  };
}

const starterProjectsBaseView: TaskView = {
  key: "TaskNotes/Views/projects.base#0",
  documentId: "projects",
  documentName: "Projects",
  id: "0",
  name: "Projects",
  properties: [],
  sort: [],
  source: {
    path: "TaskNotes/Views/projects.base",
    format: "obsidian.base",
    writable: true,
    revision: "1",
  },
  presentation: {
    type: "tasknotes.task-list",
    mappings: {},
    options: { create: false },
  },
};

function execution(
  view: TaskView = starterProjectsBaseView,
): TaskViewExecution {
  return {
    view,
    rows: [],
    groups: [],
    totalCount: 0,
    hasMore: false,
  };
}

describe("isProjectsPresentation", () => {
  it("recognizes both tasknotes.projects and the starter Projects task-list Base", () => {
    expect(isProjectsPresentation(starterProjectsBaseView)).toBe(true);
    expect(
      isProjectsPresentation({
        ...starterProjectsBaseView,
        source: {
          ...starterProjectsBaseView.source,
          path: "Custom/other.base",
        },
        name: "Custom",
        presentation: { type: "tasknotes.projects", mappings: {}, options: {} },
      }),
    ).toBe(true);
  });

  it("does not override a starter Projects view changed to Kanban or Calendar", () => {
    expect(
      isProjectsPresentation({
        ...starterProjectsBaseView,
        presentation: { type: "tasknotes.kanban", mappings: {}, options: {} },
      }),
    ).toBe(false);
  });
});

describe("ProjectsView sidebar project jumps", () => {
  it("focuses the requested project when clicked while Projects is already open", () => {
    clearProjectJump();
    setFocusedProject(null);
    const tasks = [
      task("1", "Book class", ["[[Get First Aid Certificate]]"]),
      task("2", "Pack kit", ["[[Get First Aid Certificate]]"]),
      task("3", "Write outline", ["[[Make Skybird]]"]),
    ];

    render(
      <ProjectsView
        execution={execution()}
        linkWriteFormat="wikilink"
        projectsField="projects"
        tasks={tasks}
        onCreate={vi.fn()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("Book class")).toBeInTheDocument();
    expect(screen.getByText("Write outline")).toBeInTheDocument();

    act(() => {
      requestProjectJump("Get First Aid Certificate");
    });

    expect(screen.getByText("Book class")).toBeInTheDocument();
    expect(screen.queryByText("Write outline")).toBeNull();
    expect(
      screen.getByRole("button", { name: "All projects" }),
    ).toBeInTheDocument();

    act(() => {
      requestProjectJump("Make Skybird");
    });

    expect(screen.getByText("Write outline")).toBeInTheDocument();
    expect(screen.queryByText("Book class")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All projects" }));
    expect(screen.getByText("Book class")).toBeInTheDocument();
    expect(screen.getByText("Write outline")).toBeInTheDocument();
  });

  it("retains a pending jump until tasks arrive after mount", async () => {
    clearProjectJump();
    setFocusedProject(null);
    requestProjectJump("Make Skybird");

    const tasks = [
      task("1", "Book class", ["[[Get First Aid Certificate]]"]),
      task("3", "Write outline", ["[[Make Skybird]]"]),
    ];

    const view = render(
      <ProjectsView
        execution={execution()}
        linkWriteFormat="wikilink"
        projectsField="projects"
        tasks={[]}
        onCreate={vi.fn()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    view.rerender(
      <ProjectsView
        execution={execution()}
        linkWriteFormat="wikilink"
        projectsField="projects"
        tasks={tasks}
        onCreate={vi.fn()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Write outline")).toBeInTheDocument();
      expect(screen.queryByText("Book class")).toBeNull();
    });
  });
});
