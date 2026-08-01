import {
  AuthorityAdoptionClient,
  AuthorityAdoptionError,
  AuthorityAdoptionOutcomeUnknownError,
  buildPortableAuthoritySnapshot,
  type AuthorityAdoptionSession,
  type AuthorityAdoptionVerification,
  type PreparedAuthorityAdoption,
} from "@mdbase-dev/connect-sync/adoption";
import type { AuthorityImportSnapshot } from "@mdbase-dev/connect-protocol";

import type { MarkdownCollection } from "./collection";

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
    total: initial.records.length + initial.resources.documents!.length,
  });
  await client.uploadSnapshot(session, prepared, initial);
  onProgress?.({
    phase: "uploading",
    completed: initial.records.length + initial.resources.documents!.length,
    total: initial.records.length + initial.resources.documents!.length,
  });

  onProgress?.({ phase: "fencing", completed: 0, total: 1 });
  const fence = await source.acquireAuthorityAdoptionFence(session.adoptionId);
  const final = await capture(source);
  let activationAttempted = false;
  try {
    await source.persistAuthorityAdoptionSnapshot(session.adoptionId, final);
    onCheckpoint?.({
      session,
      snapshot: {
        sourceRevision: final.source_revision,
        manifestDigest: final.manifest_digest,
        sourceHead: final.source_head,
      },
    });
    if (!sameSnapshot(initial, final)) {
      prepared = await requirePrepared(client, session);
      await client.uploadSnapshot(session, prepared, final);
    }
    onProgress?.({ phase: "fencing", completed: 1, total: 1 });
    onProgress?.({ phase: "activating", completed: 0, total: 1 });
    activationAttempted = true;
    await client.complete(session, final);
    await fence.markHosted();
    onProgress?.({ phase: "activating", completed: 1, total: 1 });
    return resultFor(final);
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

async function capture(
  source: MarkdownCollection,
): Promise<AuthorityImportSnapshot> {
  const snapshot = await source.authoritySnapshot();
  return buildPortableAuthoritySnapshot({
    collectionId: snapshot.collectionId,
    specVersion: snapshot.specVersion,
    resources: snapshot.resources,
    records: snapshot.records,
  });
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
