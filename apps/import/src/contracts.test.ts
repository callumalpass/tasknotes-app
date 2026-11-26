import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import pack from "../../../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.22.json";
import manifest from "./generated/mdbase-app.json";
import { exampleTarget } from "./example";
import { modelFor } from "./plan";

const hash = (document: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(document).digest("hex")}`;

it("uses the published canonical TaskNotes pack and the matching stable model contract", () => {
  expect(
    hash(
      readFileSync(
        new URL(
          "../../../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.22.json",
          import.meta.url,
        ),
      ),
    ),
  ).toBe(
    "sha256:7411d08797aaf564d5e6e75b1870110c83feff57c2fe71dc60728b7de3516ce7",
  );
  expect(pack.manifest).toMatchObject({
    id: "tasknotes.task",
    version: "0.3.0-rc.22",
  });
  expect(pack.provides).toContainEqual({
    id: "tasknotes.task",
    version: TASKNOTES_SPEC_VERSION,
    digest: TASKNOTES_CONTRACT_DIGEST,
  });
  expect(TASKNOTES_SPEC_VERSION).toBe("0.3.0-rc.6");
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
