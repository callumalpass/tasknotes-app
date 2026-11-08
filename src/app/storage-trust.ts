import { t } from "@lingui/core/macro";
export function storageExplanation(): string {
  return t({
    message:
      "mdbase manages local records and synchronization. Syncing requires a connection to the collection.",
  });
}
