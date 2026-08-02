import { useCallback, useMemo, useState } from "react";

import { IndexedMarkdownRepository } from "../storage/repository";
import type { CollectionChoice } from "./collection-context";
import { OpenedCollection } from "./opened-collection";
import {
  DefinitionReviewDialog,
  type DefinitionReview,
} from "./definition-review-dialog";

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
  const [review, setReview] = useState<
    (DefinitionReview & { resolve(approved: boolean): void }) | null
  >(null);
  const requestReview = useCallback(
    (next: DefinitionReview) =>
      new Promise<boolean>((resolve) => setReview({ ...next, resolve })),
    [],
  );
  const repository = useMemo(
    () =>
      new IndexedMarkdownRepository({
        approveDefinitionAdoption: (request) =>
          requestReview({ kind: "adoption", request }),
        approveManagedTypeUpgrade: (request) =>
          requestReview({ kind: "managed-upgrade", request }),
      }),
    [requestReview],
  );
  const decide = useCallback((approved: boolean) => {
    setReview((current) => {
      current?.resolve(approved);
      return null;
    });
  }, []);
  return (
    <>
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
      {review ? (
        <DefinitionReviewDialog review={review} decide={decide} />
      ) : null}
    </>
  );
}
