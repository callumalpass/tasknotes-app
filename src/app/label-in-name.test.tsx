import { render, screen } from "../test/render";

import { CaptureFab } from "../components/capture-fab";
import { TaskListSection } from "../components/task-list-section";
import { Navigation } from "./app-shell";

import type { TaskView } from "../domain/view";

/**
 * WCAG 2.5.3 Label in Name, as axe's label-content-name-mismatch reads it:
 * every text node rendered in the control, joined without separators, must
 * appear in the accessible name once punctuation and spacing are normalised.
 * Hidden description text is not drawn, so it is not part of the label.
 */
function visibleLabel(element: Element): string {
  let text = "";
  const walk = (node: Node) => {
    if (node instanceof HTMLElement && node.hidden) return;
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? "";
    node.childNodes.forEach(walk);
  };
  walk(element);
  return text;
}

function curate(text: string) {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expectLabelInName(button: HTMLElement) {
  const label = curate(visibleLabel(button));
  expect(label).not.toBe("");
  const name = curate(
    button.getAttribute("aria-label") ?? visibleLabel(button),
  );
  expect(name).toContain(label);
}

function view(id: string, name: string): TaskView {
  return {
    key: `TaskNotes/Views/${id}.base#${id}`,
    documentId: id,
    documentName: id,
    id,
    name,
    properties: [],
    source: {
      path: `TaskNotes/Views/${id}.base`,
      format: "obsidian.base",
      revision: "one",
      writable: true,
    },
    presentation: { type: "tasknotes.task-list", mappings: {}, options: {} },
  };
}

it("names the capture button by its visible Add task label", () => {
  render(<CaptureFab className="view-context-capture" />);
  const button = screen.getByRole("button", { name: "Add task" });
  expectLabelInName(button);
});

it("names a section toggle by its visible label and count", () => {
  render(
    <TaskListSection label="Overdue" count={4} laneKey="section:overdue">
      Tasks
    </TaskListSection>,
  );
  const toggle = screen.getByRole("button", { name: "Overdue 4" });
  expectLabelInName(toggle);
});

it("starts sidebar destination and project names with their visible text", () => {
  const today = view("today", "Today");
  const upcoming = view("upcoming", "Upcoming");
  const inbox = view("inbox", "Inbox");
  render(
    <Navigation
      active="view:today"
      mode="desktop"
      navigationKeys={[today.key, upcoming.key, inbox.key]}
      views={[today, upcoming, inbox]}
      todayCounts={{ total: 5, overdue: 4 }}
      navigationCounts={{ inbox: 0, upcoming: 9 }}
      projects={[{ label: "Field research", count: 3 }]}
      onNavigate={vi.fn()}
    />,
  );
  const destinations = [
    screen.getByRole("button", { name: "Today 5" }),
    screen.getByRole("button", { name: "Upcoming 9" }),
    screen.getByRole("button", { name: "Inbox 0" }),
  ];
  for (const button of destinations) expectLabelInName(button);
  expect(destinations[0]).toHaveAttribute(
    "title",
    "Today, 5 tasks, 4 overdue (g t)",
  );
  const project = screen.getByRole("button", { name: "Field research 3" });
  expectLabelInName(project);
  expect(project).toHaveAccessibleDescription("Field research, 3 tasks");
});
