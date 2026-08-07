import { describe, expect, it } from "vitest";

import {
  formatPropertyValue,
  propertyLabel,
  viewPropertyDetails,
} from "./view-values";

import type { Task } from "./task";
import type { TaskViewRow } from "./view";

const task: Task = {
  id: "one",
  path: "tasks/one.md",
  title: "Write calendar tests",
  status: "open",
  completed: false,
  archived: false,
  priority: "high",
  due: "2026-07-24",
  body: "",
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  tags: ["task"],
  contexts: [],
  projects: ["mdbase"],
  attachments: [],
  blockedBy: [],
  completeInstances: [],
  skippedInstances: [],
  reminders: [],
  timeEntries: [],
  customProperties: {},
  revision: 1,
  frontmatter: {
    name: "Write calendar tests",
    status: "open",
    due: "2026-07-24",
  },
};

const row: TaskViewRow = {
  task,
  values: {
    'note["name"]': task.title,
    'note["status"]': task.status,
    'note["due"]': task.due,
    "formula.progress": "Active",
  },
};

describe("saved-view values", () => {
  it("omits the task identity while preserving configured property order", () => {
    expect(
      viewPropertyDetails(
        row,
        [
          { key: 'note["name"]', label: "Name" },
          { key: 'note["status"]', label: "State" },
          { key: "formula.progress", label: "Progress" },
          { key: 'note["due"]', label: "Due", format: "date" },
        ],
        { identityProperty: "name" },
      ),
    ).toEqual([
      {
        key: 'note["status"]',
        label: "State",
        value: "open",
        rawValue: "open",
      },
      {
        key: "formula.progress",
        label: "Progress",
        value: "Active",
        rawValue: "Active",
      },
      {
        key: 'note["due"]',
        label: "Due",
        value: formatPropertyValue("2026-07-24", "date"),
        rawValue: "2026-07-24",
      },
    ]);
  });

  it("recognizes dotted and bracketed note property labels", () => {
    expect(propertyLabel("note.time_estimate")).toBe("Time estimate");
    expect(propertyLabel('note["complete_instances"]')).toBe(
      "Complete instances",
    );
  });

  it("renders configured defaults and false values rather than treating them as empty", () => {
    expect(
      viewPropertyDetails(
        {
          ...row,
          values: {
            ...row.values,
            'note["priority"]': "normal",
            'note["archived"]': false,
          },
        },
        [
          { key: 'note["status"]', label: "Status" },
          { key: 'note["priority"]', label: "Priority" },
          { key: 'note["archived"]', label: "Archived" },
          { key: 'note["due"]', label: "Due", format: "date" },
        ],
      ),
    ).toEqual([
      {
        key: 'note["status"]',
        label: "Status",
        value: "open",
        rawValue: "open",
      },
      {
        key: 'note["priority"]',
        label: "Priority",
        value: "normal",
        rawValue: "normal",
      },
      {
        key: 'note["archived"]',
        label: "Archived",
        value: "No",
        rawValue: false,
      },
      {
        key: 'note["due"]',
        label: "Due",
        value: formatPropertyValue("2026-07-24", "date"),
        rawValue: "2026-07-24",
      },
    ]);
  });

  it("omits explicit none status and priority values", () => {
    expect(
      viewPropertyDetails(
        {
          ...row,
          values: {
            ...row.values,
            'note["status"]': "none",
            'note["priority"]': "none",
          },
        },
        [
          { key: 'note["status"]', label: "Status" },
          { key: 'note["priority"]', label: "Priority" },
          { key: 'note["due"]', label: "Due", format: "date" },
        ],
      ),
    ).toEqual([
      {
        key: 'note["due"]',
        label: "Due",
        value: formatPropertyValue("2026-07-24", "date"),
        rawValue: "2026-07-24",
      },
    ]);
  });

  it("formats empty and structured values without leaking markup", () => {
    expect(formatPropertyValue([])).toBeNull();
    expect(formatPropertyValue(["one", "two"])).toBe("one, two");
    expect(formatPropertyValue("<strong>Ready</strong>")).toBe("Ready");
    expect(formatPropertyValue("2026-07-23T23:00:00Z")).toBe(
      new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
      }).format(new Date("2026-07-23T23:00:00Z")),
    );
  });
});
