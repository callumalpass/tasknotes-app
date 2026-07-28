import { useMemo } from "react";

import { IndexedMarkdownRepository } from "../storage/repository";
import type { CollectionChoice } from "./collection-context";
import { OpenedCollection } from "./opened-collection";

export default function LocalCollection({
  authorizeAnotherCloudCollection,
  canChooseLocalFolder,
  changeLocalCollection,
  choose,
  openCollectionPicker,
  reauthorizeCurrentCloudCollection,
}: {
  authorizeAnotherCloudCollection(): void;
  canChooseLocalFolder: boolean;
  changeLocalCollection(): void;
  choose(choice: CollectionChoice): void;
  openCollectionPicker(): void;
  reauthorizeCurrentCloudCollection(): void;
}) {
  const repository = useMemo(() => new IndexedMarkdownRepository(), []);
  return (
    <OpenedCollection
      authorizeAnotherCloudCollection={authorizeAnotherCloudCollection}
      canChooseLocalFolder={canChooseLocalFolder}
      changeConnectedCollection={openCollectionPicker}
      changeLocalCollection={changeLocalCollection}
      choice="local"
      choose={choose}
      reauthorizeCurrentCloudCollection={reauthorizeCurrentCloudCollection}
      repository={repository}
    />
  );
}
