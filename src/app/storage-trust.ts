import { t } from "@lingui/core/macro";
export function storageExplanation(): string {
  return t({
    message: "mdbase is the source of truth. Changes require a connection.",
  });
}
