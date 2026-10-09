import {
  applyCollectionResources,
  assessCollectionResources,
  loadCatalog,
  type CollectionResourceApplication,
  type CollectionSetup,
  type PackOptions,
  type Resources,
} from "mdbase";
import { stringify } from "yaml";
import { MdbaseError, type MdbaseClient } from "@mdbase-dev/sdk";
import type { JsonObject, TypePackProvision } from "@mdbase-dev/connect";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import manifest from "../generated/mdbase-app.json";
import bases from "../../vendor/obsidian-base-1.0.0.json";
import { initializeModelPackCore } from "../cloud/next-model-pack-core";
import type { ModelResourcePlan } from "../application/ports/model-setup";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import { TASKNOTES_DEFAULT_VIEW_SOURCES } from "../domain/default-view-source";
import { resolveTaskTypeDefinition } from "./tasknotes-collection";
import { iterateNativeDiscovery } from "./next-bases-discovery";
import { MODEL_SETUP_LIMITS } from "../application/ports/model-setup";

const provisions = [
  manifest.provisions.type_packs[0] as TypePackProvision,
  bases,
];
// This hashes actual declaration DATA only. Core independently binds actual
// setup inputs; neither digest is a trusted native head or file witness.
async function declarationDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return (
    "sha256:" +
    [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Build strict typed Core inputs from unchanged publisher bytes and actual settings.
 * Core resolves defaults when the complete native resource inventory has no
 * configuration. Only Core's guarded configuration operation materializes it.
 */
async function setup(
  resources: Resources,
  signal: AbortSignal,
): Promise<CollectionSetup> {
  const catalog = await loadCatalog(resources);
  signal.throwIfAborted();
  const packs = provisions.map((p) => {
    const options: PackOptions = { installed_by: manifest.id };
    const overrides: Record<string, string> = {};
    for (const r of p.manifest.resources) {
      const prefix =
        r.kind === "type"
          ? ["_types/", catalog.settings.types_folder]
          : r.kind === "contract"
            ? ["_contracts/", catalog.settings.contracts_folder]
            : null;
      if (prefix && r.target.startsWith(prefix[0]!)) {
        const target = `${prefix[1]}/${r.target.slice(prefix[0]!.length)}`;
        if (target !== r.target) overrides[r.target] = target;
      }
    }
    if (Object.keys(overrides).length) options.target_overrides = overrides;
    return {
      provision: {
        manifest: stringify(p.manifest, { lineWidth: 0 }),
        sources: Object.fromEntries(
          p.resources.map((r) => [r.source, r.document]),
        ),
      },
      options,
    };
  });
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
      type_packs: packs,
    },
  };
  const digest = await declarationDigest(declaration);
  signal.throwIfAborted();
  return { ...declaration, declaration_digest: digest };
}
const rows = (resources: Resources) =>
  Object.entries(resources).map(([path, source]) => ({ path, source }));

/** Materialize DATA only to resolve the actual staged/preserved type, not to plan a native head. */
function prospective(
  resources: Resources,
  applied: CollectionResourceApplication,
): Resources {
  const data: Resources = Object.assign(Object.create(null), resources);
  for (const op of applied.ops) {
    if (op.kind === "resource_put") data[op.path] = op.doc;
    else delete data[op.path];
  }
  return data;
}
async function configuration(
  data: Resources,
  signal: AbortSignal,
): Promise<TaskCollectionConfiguration> {
  const catalog = await loadCatalog(data);
  signal.throwIfAborted();
  if (!catalog.valid)
    throw new Error("The staged resource catalog is invalid.");
  const implementations = catalog.implementations.filter(
    (i) =>
      i.contract === "tasknotes.task" &&
      i.version === TASKNOTES_SPEC_VERSION &&
      i.contract_digest === TASKNOTES_CONTRACT_DIGEST,
  );
  if (implementations.length !== 1)
    throw new Error(
      "The staged/preserved TaskNotes implementation is unavailable or ambiguous.",
    );
  const implementation = implementations[0]!;
  const type = catalog.types.find((t) => t.name === implementation.type);
  if (!type)
    throw new Error("The staged/preserved TaskNotes type is unavailable.");
  return resolveTaskTypeDefinition(type.raw, {
    typeName: type.name,
    fields: Object.fromEntries(implementation.fields),
    configuration: implementation.binding as JsonObject,
  }).model.configuration();
}
function readback(
  applied: CollectionResourceApplication,
  data: Resources,
): ModelResourcePlan["resourceReadback"] {
  const paths = new Set([
    "mdbase.yaml",
    "mdbase.lock.yaml",
    "mdbase.provisions.yaml",
  ]);
  const retired = new Set<string>();
  for (const pack of applied.assessment.type_packs)
    for (const r of pack.resources) {
      paths.add(r.target);
      if (r.action === "retire") retired.add(r.target);
    }
  for (const op of applied.ops) paths.add(op.path);
  return [...paths].map((path) => {
    const doc = data[path];
    if (typeof doc !== "string" && !retired.has(path))
      throw new Error(
        "Mdbase has not supplied an installed/preserved setup resource.",
      );
    return Object.freeze({ path, doc: doc ?? null });
  });
}
export type DefaultSourceFactory = (
  configuration: TaskCollectionConfiguration,
) => readonly { path: string; document: string }[];

async function retainedNativePaths(
  client: MdbaseClient,
  resources: Resources,
  signal: AbortSignal,
): Promise<ReadonlySet<string>> {
  const catalog = await loadCatalog(resources);
  signal.throwIfAborted();
  // Without an ACTUAL current resolved contract, ordinary .base occupancy stays
  // UNKNOWN. Proposed pack resources do not fabricate native source discovery.
  if (
    !catalog.implementations.some(
      (i) =>
        i.contract === "obsidian.base" &&
        i.version === "1.0.0" &&
        i.contract_digest === bases.provides[0]!.digest,
    )
  )
    return new Set();
  const paths = new Set<string>();
  let pages = 0,
    bytes = 0;
  for await (const views of iterateNativeDiscovery(async (continuation) => {
    if (++pages > MODEL_SETUP_LIMITS.readbacks)
      throw new Error("Native Bases discovery exceeded setup bounds.");
    const result = await client.listAppBasesViews(
      { captureTimezone: "UTC", limit: 128, continuation },
      signal,
    );
    signal.throwIfAborted();
    if (result.kind === "refusal") throw new MdbaseError(result.problem);
    bytes += new TextEncoder().encode(JSON.stringify(result)).byteLength;
    if (bytes > MODEL_SETUP_LIMITS.plaintextBytes)
      throw new Error("Native Bases discovery exceeded setup bounds.");
    return result;
  }, signal))
    for (const view of views) paths.add(view.path);
  return paths;
}

/** Pure component plan after COMPLETE native resource collection. Existing native
 * Bases source paths are retained. Other path occupancy is UNKNOWN, not absence;
 * the ONE atomic explicit-path Create/create-only mutation decides at native head.
 */
export type ResourceSetupAssessment = Omit<ModelResourcePlan, "sources"> & {
  readonly sources: readonly {
    readonly path: string;
    readonly document: string;
  }[];
};

export async function nativeResourceSetupAssessment(
  resources: Resources,
  client: MdbaseClient,
  sources: DefaultSourceFactory,
  signal: AbortSignal,
): Promise<ResourceSetupAssessment> {
  await initializeModelPackCore(signal);
  signal.throwIfAborted();
  const declaration = await setup(resources, signal);
  const input = { resources: rows(resources), setup: declaration };
  const assessment = await assessCollectionResources(input);
  signal.throwIfAborted();
  const applied = await applyCollectionResources({
    ...input,
    expectedDigest: assessment.assessment_digest,
  });
  signal.throwIfAborted();
  const data = prospective(resources, applied);
  const existingNativeBasePaths = await retainedNativePaths(
    client,
    resources,
    signal,
  );
  const generated = sources(await configuration(data, signal));
  const expected = new Set(TASKNOTES_DEFAULT_VIEW_SOURCES.map((s) => s.path));
  const seen = new Set<string>();
  if (generated.length !== expected.size)
    throw new Error("The exact five TaskNotes sources are unavailable.");
  for (const source of generated) {
    if (
      !expected.has(source.path) ||
      seen.has(source.path) ||
      typeof source.document !== "string" ||
      !source.document.length
    )
      throw new Error(
        "The original TaskNotes source generator changed its scope.",
      );
    seen.add(source.path);
  }
  // Candidates carry UNKNOWN ordinary-file occupancy, not absence. Assessment
  // is READ-only: do not mint record or mutation identities during inspect.
  const creates = generated
    .filter((s) => !existingNativeBasePaths.has(s.path))
    .map((s) => Object.freeze({ path: s.path, document: s.document }));
  return Object.freeze({
    assessmentDigest: assessment.assessment_digest,
    provisionDigest: assessment.provision_digest,
    packs: Object.freeze(
      assessment.type_packs.map((p) => Object.freeze({ ...p.pack })),
    ),
    resourceOps: Object.freeze(
      applied.ops.map((op) => Object.freeze({ ...op })),
    ),
    resourceReadback: Object.freeze(readback(applied, data)),
    sources: Object.freeze(creates),
  });
}

/** Capture ALL original source identities before journal/submit awaits. */
export function captureResourceSetupPlan(
  assessment: ResourceSetupAssessment,
): ModelResourcePlan {
  return Object.freeze({
    ...assessment,
    sources: Object.freeze(
      assessment.sources.map((s) =>
        Object.freeze({
          id: crypto.randomUUID(),
          path: s.path,
          document: s.document,
        }),
      ),
    ),
  });
}

/** Prepared-only resource reassessment. Never regenerate sources/UUIDs or invoke
 * this after attempt/UNKNOWN; subsequent recovery reconciles the ORIGINAL receipt.
 */
export async function recheckPreparedResourceSetup(
  resources: Resources,
  original: ModelResourcePlan,
  signal: AbortSignal,
): Promise<void> {
  await initializeModelPackCore(signal);
  signal.throwIfAborted();
  const applied = await applyCollectionResources({
    resources: rows(resources),
    setup: await setup(resources, signal),
    expectedDigest: original.assessmentDigest,
  });
  signal.throwIfAborted();
  if (
    applied.assessment.provision_digest !== original.provisionDigest ||
    JSON.stringify(applied.assessment.type_packs.map((p) => p.pack)) !==
      JSON.stringify(original.packs) ||
    JSON.stringify(applied.ops) !== JSON.stringify(original.resourceOps) ||
    JSON.stringify(readback(applied, prospective(resources, applied))) !==
      JSON.stringify(original.resourceReadback)
  )
    throw new Error(
      "The original resource setup plan changed; no replacement will be submitted.",
    );
}
