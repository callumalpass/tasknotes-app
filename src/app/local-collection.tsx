import { useMemo } from "react";

import { IndexedMarkdownRepository } from "../storage/repository";
import type { CollectionChoice } from "./collection-context";
import { OpenedCollection } from "./opened-collection";

export default function LocalCollection({
  choose,
  reset,
}: {
  choose(choice: CollectionChoice): void;
  reset(): void;
}) {
  const repository = useMemo(() => new IndexedMarkdownRepository(), []);
  return (
    <OpenedCollection
      choice="local"
      choose={choose}
      disconnectCloud={reset}
      repository={repository}
    />
  );
}
