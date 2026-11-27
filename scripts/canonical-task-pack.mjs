import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TASKNOTES_CONTRACT_CATALOG_URL =
  "https://mdbase.dev/contracts/packs/tasknotes.task/0.3.0-rc.23.json";
export const TASKNOTES_CONTRACT_CATALOG_DIGEST =
  "sha256:cd46a5e3fdbff1bac5ad73dba7404fc9a9254e169851242f97b21612ffe3b6ed";
export const TASKNOTES_APP_TYPE_PACK_VERSION = "0.3.0-rc.23";

export const TASKNOTES_CONTRACT_VENDOR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.23.json",
);

export async function loadCanonicalTaskNotesTypePack() {
  const document = await readFile(TASKNOTES_CONTRACT_VENDOR_PATH, "utf8");
  const digest = `sha256:${createHash("sha256").update(document).digest("hex")}`;
  if (digest !== TASKNOTES_CONTRACT_CATALOG_DIGEST) {
    throw new Error(
      `The vendored TaskNotes catalog provision has digest ${digest}; expected ${TASKNOTES_CONTRACT_CATALOG_DIGEST}.`,
    );
  }
  const provision = JSON.parse(document);
  if (
    provision.manifest?.id !== "tasknotes.task" ||
    provision.manifest?.version !== TASKNOTES_APP_TYPE_PACK_VERSION ||
    !provision.provides?.some(
      (contract) =>
        contract.id === "tasknotes.task" &&
        contract.version === "0.3.0-rc.7" &&
        contract.digest ===
          "sha256:1a0b33928c1e35399b0cffe808047cdca42a0881da27570a10fa6ead51dc51b2",
    )
  ) {
    throw new Error(
      "The vendored TaskNotes catalog provision does not match its identity or published contract.",
    );
  }
  return provision;
}
