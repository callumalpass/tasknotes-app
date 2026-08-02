import { MarkdownCollection } from "./collection";
import {
  transferLocalCollectionToHosted,
  type CollectionTransferResult,
} from "./collection-transfer";
import {
  localCollectionSourceName,
  type LocalCollectionLocation,
} from "./local-collection-location";
import { createLocalVault } from "./vault";

export function transferPlatformLocalCollectionToHosted({
  sourceLocation,
  ...options
}: Omit<
  Parameters<typeof transferLocalCollectionToHosted>[0],
  "source" | "sourceName"
> & {
  sourceLocation: LocalCollectionLocation;
}): Promise<CollectionTransferResult> {
  return transferLocalCollectionToHosted({
    ...options,
    source: new MarkdownCollection(createLocalVault(sourceLocation)),
    sourceName: localCollectionSourceName(sourceLocation),
  });
}
