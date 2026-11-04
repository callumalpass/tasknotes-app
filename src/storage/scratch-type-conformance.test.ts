// @vitest-environment node
import { serializeMarkdownDocument } from "@tasknotes/model/frontmatter";
import { init, validateRecord } from "mdbase";
import { beforeAll, expect, it } from "vitest";
import pin from "../../vendor/mdbase-browser.pin.json";
import { SCRATCH_IMAGE_TYPE } from "../domain/scratch-image";
import { SCRATCHPAD_TYPE } from "../domain/scratchpad";
import manifest from "../generated/mdbase-app.json";
import { pinnedCoreBytes, sha256 } from "./next-resource-core.test-helper.mjs";
import { newScratchpadValues } from "./scratchpads";

// The real SDK setup installs these provisions; Core validates what the app writes.
const resources = Object.fromEntries([
  ["mdbase.yaml", 'spec_version: "0.3.0"\n'],
  ...manifest.provisions.type_packs.flatMap((pack) =>
    pack.manifest.resources.map((resource) => [
      resource.target,
      pack.resources.find(({ source }) => source === resource.source)!.document,
    ]),
  ),
]);

beforeAll(async () => {
  const bytes = pinnedCoreBytes();
  expect(bytes.length).toBe(pin.wasmBytes);
  expect(sha256(bytes)).toBe(pin.wasmSha256);
  await init({ wasm: bytes });
});

it("validates actual scratch note/image documents against the provisioned Core types", async () => {
  const note = newScratchpadValues("2026-10-10T09:00:00Z");
  const image = {
    type: SCRATCH_IMAGE_TYPE,
    id: "image",
    dateCreated: "2026-10-10T09:00:00Z",
    dateModified: "2026-10-10T09:00:00Z",
    file: "TaskNotes/Scratchpad/Images/image.png",
    digest: "sha256:" + "a".repeat(64),
    size: 4,
    mediaType: "image/png",
  };
  for (const [type, path, fields, body] of [
    [
      SCRATCHPAD_TYPE,
      `TaskNotes/Scratchpad/${note.frontmatter.id}.md`,
      note.frontmatter,
      note.body,
    ],
    [
      SCRATCH_IMAGE_TYPE,
      "TaskNotes/Scratchpad/Image Metadata/image.md",
      image,
      "",
    ],
  ] as const) {
    const result = await validateRecord({
      resources,
      path,
      source: serializeMarkdownDocument(fields, body),
    });
    expect(result.types).toContain(type);
    expect(result.issues).toEqual([]);
  }
  const invalid = await validateRecord({
    resources,
    path: "TaskNotes/Scratchpad/Image Metadata/image.md",
    source: serializeMarkdownDocument({ ...image, size: -1 }, ""),
  });
  expect(invalid.types).toContain(SCRATCH_IMAGE_TYPE);
  expect(invalid.issues.length).toBeGreaterThan(0);
});
