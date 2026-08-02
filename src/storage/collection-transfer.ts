import {
  AuthorityAdoptionClient,
  AuthorityAdoptionError,
  AuthorityAdoptionOutcomeUnknownError,
  buildPortableAuthoritySnapshot,
  type AuthorityAdoptionSession,
  type AuthorityImportFileSource,
  type AuthorityAdoptionVerification,
  type PreparedAuthorityAdoption,
} from "@mdbase-dev/connect-sync/adoption";
import type {
  AuthorityImportSnapshot,
  CollectionFileDescriptor,
} from "@mdbase-dev/connect-protocol";

import type { MarkdownCollection } from "./collection";
import { isBinaryVault } from "./vault-contract";

export type CollectionTransferPhase =
  | "reading"
  | "approving"
  | "uploading"
  | "fencing"
  | "activating"
  | "authorizing";

export interface CollectionTransferProgress {
  phase: CollectionTransferPhase;
  completed: number;
  total: number;
}

export interface CollectionTransferResult {
  records: number;
  views: number;
  destinationCollectionId: string;
}

export interface CollectionTransferCheckpoint {
  session: AuthorityAdoptionSession;
  snapshot?: {
    sourceRevision: string;
    manifestDigest: string;
    sourceHead: number;
  };
}

export async function transferLocalCollectionToHosted({
  source,
  controlUrl,
  displayName,
  sourceName,
  checkpoint,
  onCheckpoint,
  onCheckpointCleared,
  onVerification,
  onProgress,
  client = new AuthorityAdoptionClient(),
}: {
  source: MarkdownCollection;
  controlUrl: string;
  displayName: string;
  sourceName: string;
  checkpoint?: CollectionTransferCheckpoint;
  onCheckpoint?(checkpoint: CollectionTransferCheckpoint): void;
  onCheckpointCleared?(): void;
  onVerification?(
    verification: AuthorityAdoptionVerification,
  ): void | Promise<void>;
  onProgress?(progress: CollectionTransferProgress): void;
  client?: AuthorityAdoptionClient;
}): Promise<CollectionTransferResult> {
  onProgress?.({ phase: "reading", completed: 0, total: 1 });
  await source.initialize({
    ...(checkpoint
      ? { authorityAdoptionId: checkpoint.session.adoptionId }
      : {}),
  });
  const collectionId = await source.ensureCollectionIdentity();
  let session = checkpoint?.session;
  if (session && session.requested.collectionId !== collectionId)
    throw new Error(
      "The saved adoption belongs to a different local collection.",
    );
  const initial = await capture(source);
  onProgress?.({ phase: "reading", completed: 1, total: 1 });

  let prepared: PreparedAuthorityAdoption;
  if (!session) {
    onProgress?.({ phase: "approving", completed: 0, total: 1 });
    session = await client.begin({
      controlUrl,
      collectionId,
      displayName,
      sourceName,
      retainMirror: false,
    });
    onCheckpoint?.({ session });
    await onVerification?.(publicSession(session));
    prepared = await client.waitForApproval(session, {
      onStatus: () =>
        onProgress?.({ phase: "approving", completed: 0, total: 1 }),
    });
    onProgress?.({ phase: "approving", completed: 1, total: 1 });
  } else if (!checkpoint?.snapshot) {
    onProgress?.({ phase: "approving", completed: 0, total: 1 });
    await onVerification?.(publicSession(session));
    prepared = await client.waitForApproval(session, {
      onStatus: () =>
        onProgress?.({ phase: "approving", completed: 0, total: 1 }),
    });
    onProgress?.({ phase: "approving", completed: 1, total: 1 });
  } else {
    let resumed;
    try {
      resumed = await client.exchange(session);
    } catch (reason) {
      if (!isSafelyInactive(reason)) throw reason;
      const fence = await source.acquireAuthorityAdoptionFence(
        session.adoptionId,
      );
      await client.cancel(session).catch(() => undefined);
      await fence.release();
      onCheckpointCleared?.();
      throw new Error(
        "This adoption expired or was cancelled before activation. The local collection remains authoritative and writable; start a new adoption to try again.",
        { cause: reason },
      );
    }
    if (resumed.status === "completed") {
      const fence = await source.acquireAuthorityAdoptionFence(
        session.adoptionId,
      );
      const final = await source.readAuthorityAdoptionSnapshot(
        session.adoptionId,
      );
      assertSnapshotIdentity(resumed.adoption, final);
      await fence.markHosted();
      return resultFor(final);
    }
    if (resumed.status === "activating") {
      const fence = await source.acquireAuthorityAdoptionFence(
        session.adoptionId,
      );
      const final = await source.readAuthorityAdoptionSnapshot(
        session.adoptionId,
      );
      assertSnapshotIdentity(resumed.adoption, final);
      onProgress?.({ phase: "activating", completed: 0, total: 1 });
      try {
        await client.complete(session, final);
        await fence.markHosted();
        onProgress?.({ phase: "activating", completed: 1, total: 1 });
        return resultFor(final);
      } catch (reason) {
        throw retainFenceError(reason);
      }
    }
    prepared = resumed;
  }

  onProgress?.({
    phase: "uploading",
    completed: 0,
    total: snapshotItemCount(initial.snapshot),
  });
  await client.uploadSnapshot(session, prepared, initial.snapshot, {
    fileSource: initial.fileSource,
  });
  onProgress?.({
    phase: "uploading",
    completed: snapshotItemCount(initial.snapshot),
    total: snapshotItemCount(initial.snapshot),
  });

  onProgress?.({ phase: "fencing", completed: 0, total: 1 });
  const fence = await source.acquireAuthorityAdoptionFence(session.adoptionId);
  const final = await capture(source);
  let activationAttempted = false;
  try {
    await source.persistAuthorityAdoptionSnapshot(
      session.adoptionId,
      final.snapshot,
    );
    onCheckpoint?.({
      session,
      snapshot: {
        sourceRevision: final.snapshot.source_revision,
        manifestDigest: final.snapshot.manifest_digest,
        sourceHead: final.snapshot.source_head,
      },
    });
    if (!sameSnapshot(initial.snapshot, final.snapshot)) {
      prepared = await requirePrepared(client, session);
      await client.uploadSnapshot(session, prepared, final.snapshot, {
        fileSource: final.fileSource,
      });
    }
    onProgress?.({ phase: "fencing", completed: 1, total: 1 });
    onProgress?.({ phase: "activating", completed: 0, total: 1 });
    activationAttempted = true;
    await client.complete(session, final.snapshot);
    await fence.markHosted();
    onProgress?.({ phase: "activating", completed: 1, total: 1 });
    return resultFor(final.snapshot);
  } catch (reason) {
    if (!activationAttempted) {
      await fence.release();
      onCheckpoint?.({ session });
    }
    throw activationAttempted ? retainFenceError(reason) : reason;
  }
}

async function requirePrepared(
  client: AuthorityAdoptionClient,
  session: AuthorityAdoptionSession,
): Promise<PreparedAuthorityAdoption> {
  const resumed = await client.exchange(session);
  if (resumed.status !== "ready")
    throw new AuthorityAdoptionOutcomeUnknownError(
      "Hosted authority activation changed state while the final snapshot was staged.",
    );
  return resumed;
}

async function capture(source: MarkdownCollection): Promise<{
  snapshot: AuthorityImportSnapshot;
  fileSource: (
    file: CollectionFileDescriptor,
  ) => Promise<AuthorityImportFileSource>;
}> {
  const snapshot = await source.authoritySnapshot();
  if (snapshot.files.length && !isBinaryVault(source.vault))
    throw new Error("This local collection cannot read its attachment bytes.");
  return {
    snapshot: buildPortableAuthoritySnapshot({
      collectionId: snapshot.collectionId,
      specVersion: snapshot.specVersion,
      resources: snapshot.resources,
      records: snapshot.records,
      files: snapshot.files,
    }),
    fileSource: async (file) => {
      if (!isBinaryVault(source.vault))
        throw new Error("This local collection cannot read attachment bytes.");
      return source.vault.readBinary(file.path);
    },
  };
}

function snapshotItemCount(snapshot: AuthorityImportSnapshot): number {
  return (
    snapshot.records.length +
    (snapshot.resources.documents?.length ?? 0) +
    snapshot.files.length
  );
}

function sameSnapshot(
  left: AuthorityImportSnapshot,
  right: AuthorityImportSnapshot,
): boolean {
  return (
    left.source_revision === right.source_revision &&
    left.manifest_digest === right.manifest_digest &&
    left.source_head === right.source_head
  );
}

function assertSnapshotIdentity(
  adoption: {
    source_revision: string | null;
    manifest_digest: string | null;
    final_head: number | null;
  },
  snapshot: AuthorityImportSnapshot,
): void {
  if (
    adoption.source_revision === snapshot.source_revision &&
    adoption.manifest_digest === snapshot.manifest_digest &&
    adoption.final_head === snapshot.source_head
  )
    return;
  throw new AuthorityAdoptionOutcomeUnknownError(
    "The local collection changed after hosted activation began. Keep it read-only and resolve the hosted adoption before editing either copy.",
  );
}

function resultFor(
  snapshot: AuthorityImportSnapshot,
): CollectionTransferResult {
  return {
    records: snapshot.records.length,
    views:
      snapshot.resources.documents?.filter(({ kind }) => kind === "view")
        .length ?? 0,
    destinationCollectionId: snapshot.collection_id,
  };
}

function retainFenceError(
  reason: unknown,
): AuthorityAdoptionOutcomeUnknownError {
  return reason instanceof AuthorityAdoptionOutcomeUnknownError
    ? reason
    : new AuthorityAdoptionOutcomeUnknownError(
        "Hosted activation did not return a safe final outcome. The local collection remains read-only until this adoption is resumed.",
        { cause: reason },
      );
}

function isSafelyInactive(reason: unknown): boolean {
  return (
    reason instanceof AuthorityAdoptionError &&
    ["authority_adoption_expired", "authority_adoption_cancelled"].includes(
      reason.code,
    )
  );
}

function publicSession(
  session: AuthorityAdoptionSession,
): AuthorityAdoptionVerification {
  return {
    controlUrl: session.controlUrl,
    adoptionId: session.adoptionId,
    verificationUri: session.verificationUri,
    expiresAt: session.expiresAt,
    requested: session.requested,
  };
}
