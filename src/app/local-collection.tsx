import { useMemo } from "react";

import { IndexedMarkdownRepository } from "../storage/repository";
import type { CollectionChoice } from "./collection-context";
import { OpenedCollection } from "./opened-collection";

export default function LocalCollection({
  canChooseLocalFolder,
  changeLocalCollection,
  choose,
  openCollectionPicker,
}: {
  canChooseLocalFolder: boolean;
  changeLocalCollection(): void;
  choose(choice: CollectionChoice): void;
  openCollectionPicker(): void;
}) {
  const repository = useMemo(() => new IndexedMarkdownRepository(), []);
  return (
    <OpenedCollection
      canChooseLocalFolder={canChooseLocalFolder}
      changeConnectedCollection={openCollectionPicker}
      changeLocalCollection={changeLocalCollection}
      choice="local"
      choose={choose}
      repository={repository}
    />
  );
}
