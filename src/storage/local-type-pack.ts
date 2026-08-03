import type { TaskNotesMdbaseTypePack } from "@tasknotes/model/mdbase";
import { parse as parseYaml } from "yaml";

import type { Vault } from "./vault";

const LOCK_PATH = "mdbase.lock.yaml";
const JOURNAL_PATH = ".mdbase/type-pack-transaction.json";

interface ReceiptResource {
  kind: "contract" | "type" | "schema";
  mode: "managed" | "seed";
  source: string;
  target: string;
  digest: string;
}

interface Receipt {
  id: string;
  version: string;
  digest: string;
  installed_by: string;
  resources: ReceiptResource[];
}

interface LockFile {
  kind: "mdbase.type-pack-lock";
  lock_version: 1;
  packs: Receipt[];
}

interface Mutation {
  target: string;
  before: string | null;
  after: string | null;
}

interface Journal {
  kind: "tasknotes.type-pack-transaction";
  version: 1;
  mutations: Mutation[];
}

export interface DefinitionAdoptionResource {
  path: string;
  currentDigest: string;
  desiredDigest: string;
}

export interface DefinitionAdoptionRequest {
  packId: string;
  desiredVersion: string;
  resources: DefinitionAdoptionResource[];
  message: string;
}

/**
 * Apply the same managed/seed ownership model used by mdbase authorities to a
 * mobile Vault. The portable lock is committed last through a roll-forward
 * journal, so an interrupted native write can be completed safely on restart.
 */
export async function applyLocalTypePack(
  vault: Vault,
  provision: TaskNotesMdbaseTypePack,
  options: {
    installedBy: string;
    approveAdoption?: (
      request: DefinitionAdoptionRequest,
    ) => boolean | Promise<boolean>;
    targetOverrides?: Record<string, string>;
  },
): Promise<void> {
  await recoverJournal(vault);
  const lockSource = await readOptional(vault, LOCK_PATH);
  const lock = parseLock(lockSource);
  const current = lock.packs.find(
    (receipt) => receipt.id === provision.manifest.id,
  );
  const overrides = options.targetOverrides ?? {};
  for (const target of Object.keys(overrides)) {
    if (
      !provision.manifest.resources.some(
        (resource) => resource.target === target,
      )
    )
      throw new Error(`${target} is not a target in ${provision.manifest.id}.`);
  }
  const definitions = provision.manifest.resources.map((resource) => ({
    ...resource,
    target: overrides[resource.target] ?? resource.target,
  }));
  if (
    new Set(definitions.map((resource) => resource.target)).size !==
    definitions.length
  )
    throw new Error(
      "TaskNotes definition target overrides resolve to the same path.",
    );
  const desired: Receipt = {
    id: provision.manifest.id,
    version: provision.manifest.version,
    digest: await digest(canonicalJson(provision.manifest)),
    installed_by: current?.installed_by ?? options.installedBy,
    resources: definitions.map(
      ({ kind, mode, source, target, digest: resourceDigest }) => ({
        kind,
        mode,
        source,
        target,
        digest: resourceDigest,
      }),
    ),
  };
  if (
    current &&
    current.version === desired.version &&
    current.digest !== desired.digest
  ) {
    throw new Error(
      `${desired.id} ${desired.version} changed without a pack version change. ` +
        "Publish a new pack version before updating this collection.",
    );
  }

  const documents = new Map(
    provision.resources.map((resource) => [resource.source, resource.document]),
  );
  const currentResources = new Map(
    current?.resources.map((resource) => [resource.source, resource]) ?? [],
  );
  const otherOwners = new Map(
    lock.packs
      .filter((receipt) => receipt.id !== desired.id)
      .flatMap((receipt) =>
        receipt.resources
          .filter((resource) => resource.mode === "managed")
          .map((resource) => [resource.target, receipt.id] as const),
      ),
  );
  const mutations: Mutation[] = [];
  const adoption: DefinitionAdoptionResource[] = [];

  for (const definition of definitions) {
    const document = documents.get(definition.source);
    if (document === undefined)
      throw new Error(`The type pack is missing ${definition.source}.`);
    if ((await digest(document)) !== definition.digest)
      throw new Error(
        `The type pack digest for ${definition.source} is invalid.`,
      );
    const before = await readOptional(vault, definition.target);
    const beforeDigest = before === null ? null : await digest(before);
    const prior = currentResources.get(definition.source);
    const installed = prior?.target === definition.target ? prior : undefined;
    const otherOwner = otherOwners.get(definition.target);
    if (otherOwner)
      throw new Error(
        `${definition.target} is already managed by ${otherOwner}.`,
      );
    if (definition.mode === "seed") {
      if (before === null && !prior)
        mutations.push({ target: definition.target, before, after: document });
      continue;
    }
    if (installed) {
      if (installed.mode !== "managed")
        throw new Error(
          `${definition.target} was installed as a seed and cannot be claimed automatically.`,
        );
      if (beforeDigest !== installed.digest)
        throw new Error(
          `${definition.target} changed after ${current?.id} ${current?.version} was applied. ` +
            "TaskNotes left it untouched; restore it or move your customization to the task type.",
        );
      if (beforeDigest !== definition.digest)
        mutations.push({ target: definition.target, before, after: document });
      continue;
    }
    if (before === null) {
      mutations.push({ target: definition.target, before, after: document });
    } else if (beforeDigest && beforeDigest !== definition.digest) {
      adoption.push({
        path: definition.target,
        currentDigest: beforeDigest,
        desiredDigest: definition.digest,
      });
      mutations.push({ target: definition.target, before, after: document });
    }
  }

  const desiredBySource = new Map(
    definitions.map((definition) => [definition.source, definition]),
  );
  for (const installed of current?.resources ?? []) {
    if (desiredBySource.get(installed.source)?.target === installed.target)
      continue;
    if (installed.mode === "seed") continue;
    const before = await readOptional(vault, installed.target);
    const beforeDigest = before === null ? null : await digest(before);
    if (beforeDigest !== installed.digest)
      throw new Error(
        `${installed.target} changed and cannot be relocated safely. ` +
          "TaskNotes left it untouched; restore the managed definition before changing definition folders.",
      );
    mutations.push({ target: installed.target, before, after: null });
  }

  if (adoption.length) {
    const approved = await options.approveAdoption?.({
      packId: desired.id,
      desiredVersion: desired.version,
      resources: adoption,
      message:
        "TaskNotes found older unmanaged contract definitions. Review and adopt them so future definition upgrades remain safe and automatic.",
    });
    if (!approved)
      throw new Error(
        "TaskNotes needs approval to adopt and update the collection's older contract definitions.",
      );
  }

  const nextLock: LockFile = {
    kind: "mdbase.type-pack-lock",
    lock_version: 1,
    packs: [
      ...lock.packs.filter((receipt) => receipt.id !== desired.id),
      desired,
    ].sort((left, right) => left.id.localeCompare(right.id)),
  };
  const nextLockSource = `${JSON.stringify(nextLock, null, 2)}\n`;
  if (lockSource !== nextLockSource)
    mutations.push({
      target: LOCK_PATH,
      before: lockSource,
      after: nextLockSource,
    });
  if (!mutations.length) return;
  await commit(vault, mutations);
}

async function commit(vault: Vault, mutations: Mutation[]): Promise<void> {
  const journal: Journal = {
    kind: "tasknotes.type-pack-transaction",
    version: 1,
    mutations,
  };
  await vault.writeText(JOURNAL_PATH, `${JSON.stringify(journal, null, 2)}\n`);
  await rollForward(vault, journal);
  await vault.delete(JOURNAL_PATH);
}

async function recoverJournal(vault: Vault): Promise<void> {
  const source = await readOptional(vault, JOURNAL_PATH);
  if (source === null) return;
  const journal = JSON.parse(source) as Partial<Journal>;
  if (
    journal.kind !== "tasknotes.type-pack-transaction" ||
    journal.version !== 1 ||
    !Array.isArray(journal.mutations)
  )
    throw new Error(
      "The interrupted type-pack transaction journal is invalid.",
    );
  await rollForward(vault, journal as Journal);
  await vault.delete(JOURNAL_PATH);
}

async function rollForward(vault: Vault, journal: Journal): Promise<void> {
  for (const mutation of journal.mutations) {
    const current = await readOptional(vault, mutation.target);
    if (current !== mutation.before && current !== mutation.after)
      throw new Error(
        `${mutation.target} changed during an interrupted definition update. ` +
          "TaskNotes stopped before overwriting the unexpected content.",
      );
  }
  for (const mutation of journal.mutations) {
    if (mutation.after === null) await vault.delete(mutation.target);
    else await vault.writeText(mutation.target, mutation.after);
  }
}

function parseLock(source: string | null): LockFile {
  if (source === null)
    return { kind: "mdbase.type-pack-lock", lock_version: 1, packs: [] };
  const value = parseYaml(source) as Partial<LockFile> | null;
  if (
    !value ||
    value.kind !== "mdbase.type-pack-lock" ||
    value.lock_version !== 1 ||
    !Array.isArray(value.packs)
  )
    throw new Error(`${LOCK_PATH} is not a valid type-pack lock.`);
  return value as LockFile;
}

async function readOptional(
  vault: Vault,
  path: string,
): Promise<string | null> {
  try {
    return await vault.readText(path);
  } catch (error) {
    if (isMissingPath(error)) return null;
    throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "NotFoundError")
    return true;
  const message = error instanceof Error ? error.message : String(error);
  return /not found|could not be found|does not exist|missing|enoent/i.test(
    message,
  );
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("A type pack contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new Error("A type pack contains a non-JSON value.");
}
