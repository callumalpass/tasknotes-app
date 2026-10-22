// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  applyCollectionResources,
  assessCollectionResources,
  init,
  validateRecord,
  type CollectionSetup,
} from "mdbase";
import { stringify } from "yaml";
import { serializeMarkdownDocument } from "@tasknotes/model/frontmatter";
import type { MdbaseClient } from "@mdbase-dev/sdk";
import { pinnedCoreBytes, sha256 } from "./next-resource-core.test-helper.mjs";
import pin from "../../vendor/mdbase-browser.pin.json";
import bases from "../../vendor/obsidian-base-1.0.0.json";
import manifest from "../generated/mdbase-app.json";
import {
  nativeResourceSetupAssessment,
  recheckPreparedResourceSetup,
} from "./next-resource-plan";
import { taskNotesDefaultBaseSources } from "../domain/default-view-source";
import { SCRATCHPAD_TYPE } from "../domain/scratchpad";
import { SCRATCH_IMAGE_TYPE } from "../domain/scratch-image";
import { newScratchpadValues } from "./scratchpads";

vi.mock("../cloud/next-model-pack-core", () => ({
  initializeModelPackCore: async () => {
    const bytes = pinnedCoreBytes();
    expect(bytes.length).toBe(pin.wasmBytes);
    expect(sha256(bytes)).toBe(pin.wasmSha256);
    await init({ wasm: bytes });
  },
}));
afterEach(() => vi.restoreAllMocks());
const signal = () => new AbortController().signal;
const client = () =>
  ({
    listAppBasesViews: vi.fn().mockResolvedValue({
      kind: "success",
      continuation: null,
      clock: { instant: 1, tz: "UTC", localDate: "1970-01-01" },
      collectionRevision: "sha256:" + "ab".repeat(32),
      views: [],
    }),
  }) as unknown as MdbaseClient;
const assess = (resources: Record<string, string>, missingOnly = false) =>
  nativeResourceSetupAssessment(
    resources,
    client(),
    taskNotesDefaultBaseSources,
    signal(),
    missingOnly,
  );

it("adds missing scratch packs idempotently while preserving customized task seeds and original prepared v3 scope", async () => {
  await init({ wasm: pinnedCoreBytes() });
  const config =
    "spec_version: '0.3.0'\nsettings:\n  record_extensions: [md, base]\n";
  // Reproduce the previous two-pack declaration, using actual Core planning.
  const declaration: Omit<CollectionSetup, "declaration_digest"> = {
    application_id: manifest.id,
    requirements: {
      configuration: [
        {
          id: "base-extension",
          path: "/settings/record_extensions",
          predicate: "contains",
          value: "base",
        },
      ],
    },
    provisions: {
      configuration: [
        {
          requirement: "base-extension",
          path: "/settings/record_extensions",
          operation: "set_add",
          value: "base",
        },
      ],
      type_packs: [manifest.provisions.type_packs[0]!, bases].map((p) => ({
        provision: {
          manifest: stringify(p.manifest, { lineWidth: 0 }),
          sources: Object.fromEntries(
            p.resources.map((r) => [r.source, r.document]),
          ),
        },
        options: { installed_by: manifest.id },
      })),
    },
  };
  const input = {
    resources: [{ path: "mdbase.yaml", source: config }],
    setup: {
      ...declaration,
      declaration_digest:
        "sha256:" +
        sha256(new TextEncoder().encode(JSON.stringify(declaration))),
    },
  };
  const assessment = await assessCollectionResources(input);
  const applied = await applyCollectionResources({
    ...input,
    expectedDigest: assessment.assessment_digest,
  });
  const existing: Record<string, string> = { "mdbase.yaml": config };
  for (const op of applied.ops)
    if (op.kind === "resource_put") existing[op.path] = op.doc;
  const original = {
    assessmentDigest: assessment.assessment_digest,
    provisionDigest: assessment.provision_digest,
    packs: assessment.type_packs.map((p) => p.pack),
    resourceOps: applied.ops,
    resourceReadback: [
      ...new Set([
        "mdbase.yaml",
        "mdbase.lock.yaml",
        "mdbase.provisions.yaml",
        ...applied.ops.map((op) => op.path),
      ]),
    ].map((path) => ({ path, doc: existing[path]! })),
    sources: [],
  };
  await recheckPreparedResourceSetup(
    { "mdbase.yaml": config },
    original,
    signal(),
  );
  existing["_types/task.md"] += "\nUser-owned notes survive.\n";
  const missing = await assess(existing, true);
  expect(
    missing.resourceOps
      .filter((op) => op.path.startsWith("_types/"))
      .map((op) => op.path),
  ).toEqual([
    "_types/tasknotes-scratch.md",
    "_types/tasknotes-scratch-image.md",
  ]);
  expect(
    missing.resourceReadback.find((r) => r.path === "_types/task.md")!.doc,
  ).toBe(existing["_types/task.md"]);
  for (const op of missing.resourceOps)
    if (op.kind === "resource_put") existing[op.path] = op.doc;
  expect((await assess(existing, true)).resourceOps).toEqual([]);
});

it("refuses an additive round that would upgrade an existing definition", async () => {
  const baselines = manifest.provisions.type_packs[0]!.manifest.resources.find(
    (r) => r.kind === "type",
  )!.upgrade_from!;
  if (!Array.isArray(baselines))
    throw new Error("Publisher baselines unavailable.");
  const baseline = baselines[0]!;
  await expect(
    assess(
      {
        "mdbase.yaml": "spec_version: '0.3.0'\n",
        "_types/task.md": baseline.document,
      },
      true,
    ),
  ).rejects.toThrow("cannot replace or delete");
});

it("validates actual scratch note/image documents against installed Core types, not the permissive CRUD stand-in", async () => {
  const assessment = await assess({});
  const resources = Object.fromEntries(
    assessment.resourceReadback
      .filter((r) => r.doc !== null)
      .map((r) => [r.path, r.doc!]),
  );
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
