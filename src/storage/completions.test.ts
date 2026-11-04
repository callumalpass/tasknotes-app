import { expect, it } from "vitest";

import {
  completeRecords,
  completeTaskValues,
  usedValuesFirst,
} from "./completions";

import type { Task } from "../domain/task";

it("deduplicates and filters large cached value sets without provider work", () => {
  const tasks = Array.from({ length: 50_000 }, (_, index) => ({
    frontmatter: {
      contexts: [`context-${index % 2_000}`, "shared"],
    },
  })) as unknown as Task[];
  const started = performance.now();
  const values = completeTaskValues(tasks, {
    field: "contexts",
    kind: "values",
    query: "context-19",
    limit: 12,
  });
  const elapsed = performance.now() - started;

  expect(values).toHaveLength(12);
  expect(new Set(values.map(({ value }) => value)).size).toBe(12);
  expect(elapsed).toBeLessThan(500);
});

it("writes record completions as unambiguous collection-root links", () => {
  const [completion] = completeRecords(
    [
      {
        path: "Projects/mobile roadmap.md",
        label: "Mobile roadmap",
        frontmatter: {},
        types: [],
      },
    ],
    { field: "projects", kind: "records" },
    "markdown",
  );

  expect(completion.value).toBe(
    "[Mobile roadmap](/Projects/mobile%20roadmap.md)",
  );
});

it("honors known target types while retaining untyped portable notes", () => {
  const values = completeRecords(
    [
      {
        path: "Projects/typed.md",
        label: "Typed project",
        frontmatter: {},
        types: ["project"],
      },
      {
        path: "Projects/portable.md",
        label: "Portable project",
        frontmatter: {},
        types: [],
      },
      {
        path: "People/person.md",
        label: "Person",
        frontmatter: {},
        types: ["person"],
      },
    ],
    {
      field: "projects",
      kind: "records",
      targetTypes: ["project"],
    },
    "wikilink",
  );

  expect(values.map(({ label }) => label)).toEqual([
    "Portable project",
    "Typed project",
  ]);
  expect(values.map(({ value }) => value)).toEqual([
    "[[Projects/portable|Portable project]]",
    "[[Projects/typed|Typed project]]",
  ]);
});

it("offers values the collection uses before other linkable records", () => {
  const tasks = [
    { frontmatter: { projects: ["Operations"] } },
    { frontmatter: { projects: ["[[notes/launch|Launch]]"] } },
  ] as unknown as Task[];
  const record = (label: string) => ({
    kind: "record" as const,
    value: `[[notes/${label}]]`,
    label,
    detail: `notes/${label}.md`,
  });
  const request = { field: "projects", kind: "records" as const };
  expect(
    usedValuesFirst(tasks, request, [record("Launch"), record("Refine copy")]),
  ).toEqual([
    { kind: "value", value: "[[notes/launch|Launch]]", label: "Launch" },
    { kind: "value", value: "Operations", label: "Operations" },
    record("Refine copy"),
  ]);
});
