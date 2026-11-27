import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { TASKNOTES_CURRENT_CONTRACT } from "../../../src/domain/tasknotes-contract";
import pack from "../../../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.23.json";
import manifest from "./generated/mdbase-app.json";
import { exampleTarget } from "./example";
import { modelFor } from "./plan";

const hash = (document: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(document).digest("hex")}`;

it("uses the published canonical TaskNotes pack and the matching app contract", () => {
  expect(
    hash(
      readFileSync(
        new URL(
          "../../../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.23.json",
          import.meta.url,
        ),
      ),
    ),
  ).toBe(
    "sha256:cd46a5e3fdbff1bac5ad73dba7404fc9a9254e169851242f97b21612ffe3b6ed",
  );
  expect(pack.manifest).toMatchObject({
    id: "tasknotes.task",
    version: "0.3.0-rc.23",
  });
  expect(pack.provides).toContainEqual({
    id: "tasknotes.task",
    ...TASKNOTES_CURRENT_CONTRACT,
  });
});

it("preserves every canonical setup resource and its original document digest", () => {
  for (const resource of pack.manifest.resources) {
    const document = pack.resources.find(
      (entry) => entry.source === resource.source,
    )?.document;
    expect(document, resource.target).toBeTypeOf("string");
    expect(hash(document!)).toBe(resource.digest);
  }
  expect(manifest.requirements.contracts).toEqual(pack.provides);
  expect(manifest.provisions.type_packs).toEqual([pack]);
  expect(pack.provides).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "tasknotes.settings", version: "1.1.0" }),
      expect.objectContaining({ id: "mdbase.app-settings", version: "2.0.0" }),
    ]),
  );
});

it("uses the canonical task seed rather than the companion settings type for previews", () => {
  expect(exampleTarget.name).toBe("task");
  expect(exampleTarget.fields).toMatchObject({
    title: "title",
    status: "status",
    recurrenceAnchor: "recurrence_anchor",
  });
  expect(modelFor(exampleTarget).defaults.status).toBe("open");
});
