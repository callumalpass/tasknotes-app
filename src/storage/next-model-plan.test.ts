import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { expect, it } from "vitest";
import { nativeModelDefinitionPlan } from "./next-model-plan";

it("plans only the two canonical inline Markdown definitions, not configuration or auxiliary schema files", () => {
  const ops = nativeModelDefinitionPlan(new Map());
  expect(ops.map((op) => op.path)).toEqual([
    "_contracts/tasknotes.task.md",
    "_types/task.md",
  ]);
  expect(ops.every((op) => op.kind === "resource_put" && op.mustNotExist)).toBe(
    true,
  );
  const contract = parseFrontmatter(ops[0].doc).frontmatter;
  const type = parseFrontmatter(ops[1].doc).frontmatter;
  expect(contract.kind).toBe("mdbase.contract");
  expect(contract.id).toBe("tasknotes.task");
  expect(contract.record_schema).toHaveProperty("value");
  expect(contract.binding_schema).toHaveProperty("value");
  expect(type.schema).toHaveProperty("value");
  expect(type.implements).toEqual([
    expect.objectContaining({
      binding: expect.objectContaining({ profiles: ["core-lite"] }),
    }),
  ]);
  expect(Object.isFrozen(ops)).toBe(true);
  expect(ops.every(Object.isFrozen)).toBe(true);
});
it("uses the collection's actual definition folders", () => {
  const ops = nativeModelDefinitionPlan(
    new Map([
      ["types_folder", "definitions/types"],
      ["contracts_folder", "definitions/contracts"],
    ]),
  );
  expect(ops.map((op) => op.path)).toEqual([
    "definitions/contracts/tasknotes.task.md",
    "definitions/types/task.md",
  ]);
});
it.each(["", "a//b", "a/../b", "a\\b", "/a", "a/", true])(
  "refuses an invalid definition folder %s",
  (folder) => {
    expect(() =>
      nativeModelDefinitionPlan(new Map([["types_folder", folder]])),
    ).toThrow("require repair");
  },
);
it("refuses colliding definition folders", () => {
  expect(() =>
    nativeModelDefinitionPlan(
      new Map([
        ["types_folder", "same"],
        ["contracts_folder", "same"],
      ]),
    ),
  ).toThrow("distinct");
});
