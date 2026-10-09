import type { MdbaseClient, wire } from "@mdbase-dev/sdk";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import {
  MODEL_SETUP_LIMITS,
  ModelSetupError,
} from "../application/ports/model-setup";

/** Application collection bounds, not native cursor or snapshot witnesses.
 * Reuse the setup plaintext/work bounds; never truncate an inventory to fit.
 * Snapshot coherence belongs to the native cursor binding and its typed errors.
 */
export const MODEL_RESOURCE_INVENTORY_LIMITS = Object.freeze({
  pages: MODEL_SETUP_LIMITS.readbacks,
  pageSize: 128,
  bytes: MODEL_SETUP_LIMITS.plaintextBytes,
  // Native resource-list contract's opaque cursor UTF-8 bound.
  cursorBytes: 4 * 1024,
});

function refuse(): never {
  throw new ModelSetupError({
    state: "blocked",
    message:
      "Mdbase has not supplied a complete confirmed resource inventory within TaskNotes setup limits. No partial inventory will be used.",
  });
}

/** All pages on the original held client, or no inventory. Never restart a
 * cursor, reinterpret currentness errors, or publish a first-page witness.
 */
export async function modelResourceInventory(
  client: { readonly resources: Pick<MdbaseClient["resources"], "list"> },
  ownerSignal: AbortSignal,
): Promise<wire.ResourceView[]> {
  ownerSignal.throwIfAborted();
  const signal = AbortSignal.any([
    ownerSignal,
    AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.foregroundMs),
  ]);
  const resources: wire.ResourceView[] = [];
  const paths = new Set<string>();
  const cursors = new Set<string>();
  const encoder = new TextEncoder();
  let bytes = 0;
  let cursor: string | undefined;
  for (
    let pageNumber = 0;
    pageNumber < MODEL_RESOURCE_INVENTORY_LIMITS.pages;
    pageNumber++
  ) {
    signal.throwIfAborted();
    const page = await client.resources.list({
      text: true,
      limit: MODEL_RESOURCE_INVENTORY_LIMITS.pageSize,
      ...(cursor === undefined ? {} : { cursor }),
      signal,
    });
    signal.throwIfAborted();
    bytes += encoder.encode(JSON.stringify(page)).byteLength;
    if (
      bytes > MODEL_RESOURCE_INVENTORY_LIMITS.bytes ||
      page.resources.length > MODEL_RESOURCE_INVENTORY_LIMITS.pageSize ||
      typeof page.complete !== "boolean" ||
      (page.complete
        ? page.cursor !== undefined
        : !page.resources.length ||
          typeof page.cursor !== "string" ||
          !page.cursor.length ||
          encoder.encode(page.cursor).byteLength >
            MODEL_RESOURCE_INVENTORY_LIMITS.cursorBytes ||
          cursors.has(page.cursor))
    )
      refuse();
    for (const resource of page.resources) {
      if (
        resource.state !== "confirmed" ||
        typeof resource.text !== "string" ||
        typeof resource.path !== "string" ||
        !resource.path.length ||
        resource.path.length > MODEL_SETUP_LIMITS.pathCodeUnits ||
        paths.has(resource.path)
      )
        refuse();
      paths.add(resource.path);
      // Do not retain mutable page containers between asynchronous requests.
      resources.push({ ...resource });
    }
    if (page.complete) return resources;
    cursor = page.cursor!;
    cursors.add(cursor);
  }
  return refuse();
}
