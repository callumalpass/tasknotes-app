import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";

export const TASKNOTES_CONTRACT_CATALOG_URL =
  "https://mdbase.dev/contracts/packs/tasknotes.task/0.3.0-rc.22.json";
export const TASKNOTES_CONTRACT_CATALOG_DIGEST =
  "sha256:7411d08797aaf564d5e6e75b1870110c83feff57c2fe71dc60728b7de3516ce7";
export const TASKNOTES_APP_TYPE_PACK_VERSION = "0.3.0-rc.22";

export const TASKNOTES_CONTRACT_VENDOR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.22.json",
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
        contract.version === TASKNOTES_SPEC_VERSION &&
        contract.digest === TASKNOTES_CONTRACT_DIGEST,
    )
  ) {
    throw new Error(
      "The vendored TaskNotes catalog provision does not match its identity or model contract.",
    );
  }
  return provision;
}
