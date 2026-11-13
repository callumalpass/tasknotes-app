import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const TASKNOTES_CONTRACT_CATALOG_URL =
  "https://mdbase.dev/contracts/packs/tasknotes.task/0.3.0-rc.20.json";
export const TASKNOTES_CONTRACT_CATALOG_DIGEST =
  "sha256:59c932775e37782d0ea6e152f2534bd77f535f91ad1edd6b6b7471c2213d0995";
export const TASKNOTES_APP_TYPE_PACK_VERSION = "0.3.0-rc.20";

export const TASKNOTES_CONTRACT_VENDOR_PATH = resolve(
  process.cwd(),
  "vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.20.json",
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
