import { useMemo } from "react";

import { IndexedMarkdownRepository } from "../storage/repository";
import type { CollectionChoice } from "./collection-context";
import { OpenedCollection } from "./opened-collection";

export default function LocalCollection({
  canChooseLocalFolder,
  changeLocalCollection,
  choose,
  reset,
}: {
  canChooseLocalFolder: boolean;
  changeLocalCollection(): void;
  choose(choice: CollectionChoice): void;
  reset(): void;
}) {
  const repository = useMemo(() => new IndexedMarkdownRepository(), []);
  return (
    <OpenedCollection
      canChooseLocalFolder={canChooseLocalFolder}
      changeConnectedCollection={reset}
      changeLocalCollection={changeLocalCollection}
      choice="local"
      choose={choose}
      repository={repository}
    />
  );
}
