import {
  applyTypePack,
  assessTypePack,
  loadCatalog,
  type Assessment,
  type PackInput,
  type PackOptions,
  type Resources,
} from "mdbase";
import { stringify } from "yaml";
import type { TypePackProvision } from "@mdbase-dev/connect";
import type { ModelPackPlan } from "../application/ports/model-setup";
import manifest from "../generated/mdbase-app.json";
import { initializeModelPackCore } from "../cloud/next-model-pack-core";

// Reuse the app's existing pinned publisher provision. The build's canonical
// loader verifies its vendor digest; no rc.15 builder/profile selection occurs.
export const TASKNOTES_MODEL_PACK = Object.freeze({
  id: "tasknotes.task",
  version: "0.3.0-rc.18",
});
const provision = manifest.provisions.type_packs[0] as TypePackProvision;
// Match the editor contract-catalog's kind/identity/resource-count preflight.
// Core's existing pack loader (inside assess/apply) validates all resource kinds,
// paths, documents, digests and seed baselines. The protocol manifest validator
// imports node:crypto and cannot be used in this browser entry point.
if (
  provision.manifest.kind !== "mdbase.type-pack" ||
  provision.manifest.id !== TASKNOTES_MODEL_PACK.id ||
  provision.manifest.version !== TASKNOTES_MODEL_PACK.version ||
  provision.manifest.resources.length !== 4 ||
  provision.resources.length !== provision.manifest.resources.length
)
  throw new Error("The pinned TaskNotes catalog provision is invalid.");
const pack: PackInput = {
  // PackInput takes YAML text. Serialization does not alter publisher metadata,
  // resource bytes, digests or any of the seed-upgrade baselines.
  manifest: stringify(provision.manifest, { lineWidth: 0 }),
  sources: Object.fromEntries(
    provision.resources.map(({ source, document }) => [source, document]),
  ),
};

/** Existing core configuration/defaults + spec target_overrides; never rewrite
 * a publisher document to accommodate collection-specific definition folders.
 * The held caller initializes the pinned universal engine before these helpers.
 */
async function options(
  resources: Resources,
  signal: AbortSignal,
): Promise<PackOptions> {
  if (typeof resources["mdbase.yaml"] !== "string")
    throw new Error("Mdbase has not supplied the collection configuration.");
  const catalog = await loadCatalog(resources);
  signal.throwIfAborted();
  const targetOverrides: Record<string, string> = {};
  for (const resource of provision.manifest.resources) {
    const prefix =
      resource.kind === "type"
        ? ["_types/", catalog.settings.types_folder]
        : resource.kind === "contract"
          ? ["_contracts/", catalog.settings.contracts_folder]
          : null;
    if (prefix && resource.target.startsWith(prefix[0]!)) {
      const target = `${prefix[1]}/${resource.target.slice(prefix[0]!.length)}`;
      if (target !== resource.target) targetOverrides[resource.target] = target;
    }
  }
  return {
    installed_by: manifest.id,
    ...(Object.keys(targetOverrides).length
      ? { target_overrides: targetOverrides }
      : {}),
  };
}

/** READ-only spec assessment of the entire pinned provision. */
export async function nativeModelPackAssessment(
  resources: Resources,
  signal: AbortSignal,
): Promise<Assessment> {
  await initializeModelPackCore(signal);
  signal.throwIfAborted();
  const assessment = await assessTypePack({
    pack,
    resources,
    options: await options(resources, signal),
  });
  signal.throwIfAborted();
  return assessment;
}

/** Re-assess the fresh confirmed snapshot against the ORIGINAL digest. The core
 * supplies ordered guarded operations, preserved seed bytes and the exact lock.
 * A concurrent_modification result is not retried or converted to overwrite.
 */
export async function nativeModelPackPlan(
  resources: Resources,
  expectedDigest: string,
  signal: AbortSignal,
): Promise<ModelPackPlan> {
  await initializeModelPackCore(signal);
  signal.throwIfAborted();
  const applied = await applyTypePack({
    pack,
    resources,
    options: await options(resources, signal),
    expectedDigest,
  });
  signal.throwIfAborted();
  const assessment = applied.assessment;
  if (
    assessment.pack.id !== TASKNOTES_MODEL_PACK.id ||
    assessment.pack.version !== TASKNOTES_MODEL_PACK.version ||
    assessment.assessment_digest !== expectedDigest
  )
    throw new Error("The original TaskNotes pack assessment changed.");
  const readback = assessment.resources.map((resource) => {
    const doc = resource.document ?? resources[resource.target] ?? null;
    // Only a core-retired target may be absent. A missing installed/preserved
    // seed is not silently treated as an expected deletion.
    if (doc === null && resource.source !== "")
      throw new Error("Mdbase has not supplied a preserved pack resource.");
    if (resource.action === "delete")
      return Object.freeze({ path: resource.target, doc: null });
    return Object.freeze({ path: resource.target, doc });
  });
  readback.push(
    Object.freeze({ path: "mdbase.lock.yaml", doc: assessment.lock_document }),
  );
  return Object.freeze({
    pack: Object.freeze({ ...assessment.pack }),
    assessmentDigest: assessment.assessment_digest,
    // Capture EXACT core operations. Do not infer them from writes/deletes.
    ops: Object.freeze(applied.ops.map((op) => Object.freeze({ ...op }))),
    readback: Object.freeze(readback),
  });
}
