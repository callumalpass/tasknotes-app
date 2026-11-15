import { describe, it, expect } from "vitest";
import {
  makePlan,
  importedIdentity,
  sourceIdentity,
  safeFolder,
  type ImportOptions,
} from "./plan";
import { exampleSource, exampleTarget } from "./example";
const options: ImportOptions = {
  folder: "tasks",
  dateTarget: "scheduled",
  priorities: { 1: "high", 2: "normal", 3: "low", 4: "none" },
};
const plan = (
  ids = ["brief"],
  target = exampleTarget,
  source = exampleSource,
  opts = options,
) => makePlan(source, new Set(ids), target, opts, "2026-09-14T00:00:00Z");
describe("migration planning", () => {
  it("creates schema-valid TaskNotes records with the canonical identifying tag", async () => {
    const [task] = await plan();
    expect(task.errors).toEqual([]);
    expect(task.frontmatter).toMatchObject({
      title: "Write the project brief",
      status: "open",
      tags: ["writing", "task"],
      scheduled: "2026-10-02",
      due: "2026-10-05",
      timeEstimate: 45,
    });
    expect(importedIdentity(task.body)).toBe(task.identity);
    expect(task.body).toContain("section_name");
  });
  it("uses account-scoped, deterministic identity but independent destination IDs", async () => {
    const [a] = await plan(),
      [b] = await plan();
    expect(a.path).toBe(b.path);
    expect(a.frontmatter.id).not.toBe(b.frontmatter.id);
    expect(await sourceIdentity("a", "1")).not.toBe(
      await sourceIdentity("b", "1"),
    );
    expect(await sourceIdentity("a:1", "2")).not.toBe(
      await sourceIdentity("a", "1:2"),
    );
  });
  it("only imports supported all-day recurrence", async () => {
    const [weekly, unsupported] = await plan(["review", "plants"]);
    expect(weekly.errors).toEqual([]);
    expect(weekly.frontmatter.recurrence).toBe("FREQ=WEEKLY");
    expect(unsupported.errors.join()).toContain(
      "Recurrence requires manual conversion",
    );
  });
  it("blocks floating times, ambiguous due mapping, and unselected priorities", async () => {
    const source = structuredClone(exampleSource);
    source.tasks[0].due!.date = "2026-10-02T10:00:00";
    expect(
      (await plan(["brief"], exampleTarget, source))[0].errors.join(),
    ).toContain("Floating");
    expect(
      (
        await plan(["brief"], exampleTarget, exampleSource, {
          ...options,
          dateTarget: "due",
        })
      )[0].errors.join(),
    ).toContain("Task date and deadline differ");
    expect(
      (
        await plan(["brief"], exampleTarget, exampleSource, {
          ...options,
          priorities: {},
        })
      )[0].errors.join(),
    ).toContain("Choose a destination mapping");
  });
  it("respects custom mapped fields", async () => {
    const target = structuredClone(exampleTarget);
    const schema = target.schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    schema.properties.summary = schema.properties.title;
    delete schema.properties.title;
    schema.required = schema.required.map((k) =>
      k === "title" ? "summary" : k,
    );
    target.fields.title = "summary";
    const [task] = await plan(["brief"], target);
    expect(task.errors).toEqual([]);
    expect(task.frontmatter.summary).toBe(exampleSource.tasks[0].content);
    expect(task.frontmatter.title).toBeUndefined();
  });
  it("blocks unsupported target schemas and missing portable roles", async () => {
    const target = structuredClone(exampleTarget);
    (target.schema.required as string[]).push("company");
    delete target.fields.scheduled;
    const [task] = await plan(["brief"], target);
    expect(task.errors.join()).toContain("company");
    expect(task.errors.join()).toContain("does not map scheduled");
  });
  it.each([
    "../tasks",
    "/tasks",
    "tasks/../other",
    "tasks\\other",
    ".hidden",
    "tasks//other",
    "tasks/<bad>",
  ])("rejects unsafe folder %s", (folder) =>
    expect(() => safeFolder(folder)).toThrow(),
  );
  it("does not treat an embedded source marker as import identity", async () => {
    const [task] = await plan();
    expect(importedIdentity(`${task.body}\nUnrelated content`)).toBeUndefined();
  });
});
