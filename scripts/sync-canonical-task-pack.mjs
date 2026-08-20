import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  TASKNOTES_CONTRACT_CATALOG_DIGEST,
  TASKNOTES_CONTRACT_CATALOG_URL,
  TASKNOTES_CONTRACT_VENDOR_PATH,
} from "./canonical-task-pack.mjs";

const response = await fetch(TASKNOTES_CONTRACT_CATALOG_URL);
if (!response.ok) {
  throw new Error(
    `Could not download ${TASKNOTES_CONTRACT_CATALOG_URL}: ${response.status} ${response.statusText}`,
  );
}
const document = await response.text();
const digest = `sha256:${createHash("sha256").update(document).digest("hex")}`;
if (digest !== TASKNOTES_CONTRACT_CATALOG_DIGEST) {
  throw new Error(
    `The published TaskNotes catalog provision has digest ${digest}; expected ${TASKNOTES_CONTRACT_CATALOG_DIGEST}.`,
  );
}
await mkdir(dirname(TASKNOTES_CONTRACT_VENDOR_PATH), { recursive: true });
await writeFile(TASKNOTES_CONTRACT_VENDOR_PATH, document);
console.log(`Synced ${TASKNOTES_CONTRACT_CATALOG_URL}`);
