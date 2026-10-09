import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { assessTypePack, init, loadPack, parseLock } from "mdbase";
import { expect, it, vi } from "vitest";
import { stringify } from "yaml";
import publisher from "../../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.18.json";
import publisherBytes from "../../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.18.json?raw";
import manifest from "../generated/mdbase-app.json";
import {
  nativeModelPackAssessment,
  nativeModelPackPlan,
} from "./next-model-plan";

vi.mock("../cloud/next-model-pack-core", () => ({
  initializeModelPackCore: async (signal: AbortSignal) => {
    signal.throwIfAborted();
    await init();
    signal.throwIfAborted();
  },
}));
const config = 'spec_version: "0.3.0"\n';
const signal = () => new AbortController().signal;
const pack = {
  manifest: stringify(publisher.manifest, { lineWidth: 0 }),
  sources: Object.fromEntries(
    publisher.resources.map((resource) => [resource.source, resource.document]),
  ),
};
async function plan(
  resources: Record<string, string> = { "mdbase.yaml": config },
) {
  const assessment = await nativeModelPackAssessment(resources, signal());
  return nativeModelPackPlan(resources, assessment.assessment_digest, signal());
}

it("uses the exact pinned publisher provision, all resources/baselines, and the core assessment", async () => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(publisherBytes),
    ),
  );
  expect(
    "sha256:" +
      [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  ).toBe(
    "sha256:9a9ebc26e6f63ad2fc3d92f87d38f6c140a3af90408de47d667ae7b9ba0dc9ef",
  );
  expect(manifest.provisions.type_packs[0]).toEqual(publisher);
  const assessment = await nativeModelPackAssessment(
    { "mdbase.yaml": config },
    signal(),
  );
  expect(assessment).toEqual(
    await assessTypePack({
      pack,
      resources: { "mdbase.yaml": config },
      options: { installed_by: manifest.id },
    }),
  );
  const loaded = await loadPack(pack);
  expect(loaded.digest).toBe(
    "sha256:2baa081621dadce611db7215597f156c5035bfaa425722554818291a8753736e",
  );
  expect(
    loaded.resources.find((resource) => resource.kind === "type")!.baselines,
  ).toHaveLength(4);
  const planned = await plan();
  expect(planned.pack).toEqual(assessment.pack);
  expect(planned.assessmentDigest).toBe(assessment.assessment_digest);
  expect(planned.ops.map((op) => op.path)).toEqual([
    ...publisher.manifest.resources.map((resource) => resource.target),
    "mdbase.lock.yaml",
  ]);
  for (const resource of publisher.manifest.resources) {
    const document = publisher.resources.find(
      (candidate) => candidate.source === resource.source,
    )!.document;
    expect(planned.ops).toContainEqual({
      kind: "resource_put",
      path: resource.target,
      doc: document,
      mustNotExist: true,
    });
    expect(planned.readback).toContainEqual({
      path: resource.target,
      doc: document,
    });
  }
  expect(
    planned.ops.every(
      (op) =>
        op.kind === "resource_put" &&
        op.mustNotExist &&
        op.baseRevision === undefined,
    ),
  ).toBe(true);
  expect(planned.ops.some((op) => op.path === "mdbase.yaml")).toBe(false);
  const contract = parseFrontmatter(
    publisher.resources[0]!.document,
  ).frontmatter;
  const type = parseFrontmatter(publisher.resources[1]!.document).frontmatter;
  expect(contract.kind).toBe("mdbase.contract");
  expect(contract.id).toBe("tasknotes.task");
  expect(contract.record_schema).toHaveProperty("value");
  expect(contract.binding_schema).toHaveProperty("value");
  expect(type.schema).toHaveProperty("value");
  expect(type.implements).toEqual([
    expect.objectContaining({
      binding: expect.objectContaining({
        profiles: ["core-lite", "recurrence", "materialized-occurrences"],
      }),
    }),
  ]);
  const lock = await parseLock(planned.readback.at(-1)!.doc!);
  expect(lock.packs[0]).toMatchObject({
    id: publisher.manifest.id,
    version: publisher.manifest.version,
    digest: loaded.digest,
    installed_by: manifest.id,
  });
  expect(lock.packs[0]!.resources).toHaveLength(4);
  expect(Object.isFrozen(planned)).toBe(true);
  expect(Object.isFrozen(planned.ops)).toBe(true);
  expect(planned.ops.every(Object.isFrozen)).toBe(true);
  expect(planned.readback.every(Object.isFrozen)).toBe(true);
});

it("uses core's actual collection folders via target_overrides without modifying publisher bytes", async () => {
  const planned = await plan({
    "mdbase.yaml": stringify({
      spec_version: "0.3.0",
      settings: {
        types_folder: "definitions/types",
        contracts_folder: "definitions/contracts",
      },
    }),
  });
  expect(planned.ops.map((op) => op.path)).toEqual([
    "definitions/contracts/tasknotes.task.md",
    "definitions/types/task.md",
    ...publisher.manifest.resources.slice(2).map((resource) => resource.target),
    "mdbase.lock.yaml",
  ]);
  expect(planned.ops[0]).toMatchObject({
    doc: publisher.resources[0]!.document,
    mustNotExist: true,
  });
  expect(planned.ops[1]).toMatchObject({
    doc: publisher.resources[1]!.document,
    mustNotExist: true,
  });
});
it.each(["", "a//b", "a/../b", "a\\b", true])(
  "refuses a core-invalid definition folder %s",
  async (folder) => {
    await expect(
      plan({
        "mdbase.yaml": stringify({
          spec_version: "0.3.0",
          settings: { types_folder: folder },
        }),
      }),
    ).rejects.toThrow();
  },
);
it.each(["/a", "a/"])(
  "uses core's folder normalization for %s instead of a second config parser",
  async (folder) => {
    const planned = await plan({
      "mdbase.yaml": stringify({
        spec_version: "0.3.0",
        settings: { types_folder: folder },
      }),
    });
    expect(planned.ops[1]).toMatchObject({
      path: "a/task.md",
      mustNotExist: true,
      doc: publisher.resources[1]!.document,
    });
  },
);
it("refuses colliding definition folders through core conformance", async () => {
  await expect(
    plan({
      "mdbase.yaml": stringify({
        spec_version: "0.3.0",
        settings: { types_folder: "same", contracts_folder: "same" },
      }),
    }),
  ).rejects.toThrow();
});
it("requires actual configuration and refuses a stale assessment without returning operations", async () => {
  await expect(plan({})).rejects.toThrow("configuration");
  const initial = { "mdbase.yaml": config };
  const assessment = await nativeModelPackAssessment(initial, signal());
  await expect(
    nativeModelPackPlan(
      { ...initial, "_types/task.md": publisher.resources[1]!.document },
      assessment.assessment_digest,
      signal(),
    ),
  ).rejects.toMatchObject({ code: "concurrent_modification" });
});
it("retains a preserved customized seed in full readback, although it is absent from changed ops", async () => {
  const resources: Record<string, string> = { "mdbase.yaml": config };
  for (const op of (await plan(resources)).ops)
    if (op.kind === "resource_put") resources[op.path] = op.doc;
  resources["_types/task.md"] += "\nUser-owned notes survive.\n";
  const planned = await plan(resources);
  expect(planned.ops).toEqual([]);
  expect(planned.readback).toContainEqual({
    path: "_types/task.md",
    doc: resources["_types/task.md"],
  });
  expect(planned.readback).toHaveLength(5);
});
it.each([0, 1, 2, 3])(
  "uses publisher seed baseline %s through actual core upgrade assessment",
  async (index) => {
    const seed = publisher.manifest.resources.find(
      (resource) => resource.kind === "type",
    )!;
    const baseline = seed.upgrade_from![index]!;
    const resources = {
      "mdbase.yaml": config,
      "_types/task.md": baseline.document,
    };
    const assessment = await nativeModelPackAssessment(resources, signal());
    expect(assessment.applicable).toBe(true);
    expect(
      assessment.resources.find((resource) => resource.kind === "type")!
        .upgrade_baseline,
    ).toEqual({ digest: baseline.digest, version: baseline.version });
    const planned = await nativeModelPackPlan(
      resources,
      assessment.assessment_digest,
      signal(),
    );
    expect(planned.ops.find((op) => op.path === "_types/task.md")).toEqual({
      kind: "resource_put",
      path: "_types/task.md",
      doc: publisher.resources[1]!.document,
      mustNotExist: false,
      baseRevision: baseline.digest,
    });
  },
);
