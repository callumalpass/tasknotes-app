import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const TASKNOTES_CONTRACT_CATALOG_URL =
  "https://mdbase.dev/contracts/packs/tasknotes.task/0.3.0-rc.12.json";
export const TASKNOTES_CONTRACT_CATALOG_DIGEST =
  "sha256:b1a051354b5af28c2a623f3b01db0d0d463c944605daf2c4c30069fcb99d3ce5";
export const TASKNOTES_APP_TYPE_PACK_VERSION = "0.3.0-rc.12";

export const TASKNOTES_CONTRACT_VENDOR_PATH = resolve(
  process.cwd(),
  "vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.12.json",
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
    provision.manifest?.version !== TASKNOTES_APP_TYPE_PACK_VERSION
  ) {
    throw new Error(
      "The vendored TaskNotes catalog provision has the wrong identity.",
    );
  }
  return provision;
}
