import {
  AuthorityAdoptionError,
  AuthorityAdoptionOutcomeUnknownError,
  type BeginAuthorityAdoptionInput,
  type AuthorityAdoptionClient,
  type AuthorityAdoptionSession,
  type AuthorityAdoptionView,
  type PreparedAuthorityAdoption,
} from "@mdbase-dev/connect-sync/adoption";
import type { AuthorityImportSnapshot } from "@mdbase-dev/connect-protocol";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../test/memory-vault";
import { MarkdownCollection } from "./collection";
import {
  transferLocalCollectionToHosted,
  type CollectionTransferCheckpoint,
} from "./collection-transfer";

beforeEach(() => localStorage.clear());

describe("local to hosted collection adoption", () => {
  it("uploads a replacement final snapshot after a late edit and archives the local authority", async () => {
    const source = await localCollection();
    const snapshots: AuthorityImportSnapshot[] = [];
    const client = clientDouble({
      afterFirstUpload: async () => {
        await source.vault.writeText(
          "notes/late.md",
          "---\ntitle: Late\n---\nArrived during staging.\n",
        );
      },
      upload: (snapshot) => snapshots.push(snapshot),
    });

    const result = await transferLocalCollectionToHosted({
      source: source.collection,
      controlUrl: "https://connect.test",
      displayName: "TaskNotes",
      sourceName: "This phone",
      client,
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].records.map((record) => record.path)).toEqual([
      "notes/context.md",
      "tasks/source.md",
    ]);
    expect(snapshots[1].records.map((record) => record.path)).toEqual([
      "notes/context.md",
      "notes/late.md",
      "tasks/source.md",
    ]);
    expect(snapshots[1].resources.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "view",
          path: "views/tasks.base",
        }),
      ]),
    );
    expect(result).toEqual({
      records: 3,
      views: 1,
      destinationCollectionId: snapshots[1].collection_id,
    });
    await expect(
      source.collection.write(
        await source.collection.createTask(
          { title: "Must not diverge" },
          crypto.randomUUID(),
          "2026-07-27T12:00:00.000Z",
        ),
      ),
    ).rejects.toThrow(/Hosted mdbase is now authoritative/);
    localStorage.clear();
    await expect(
      new MarkdownCollection(source.vault).initialize(),
    ).rejects.toThrow(/Hosted mdbase is now authoritative/);
  });

  it("keeps the durable local write fence after an uncertain activation and resumes only the exact snapshot", async () => {
    const source = await localCollection();
    let checkpoint: CollectionTransferCheckpoint | undefined;
    let finalSnapshot: AuthorityImportSnapshot | undefined;
    const interrupted = clientDouble({
      upload: (snapshot) => {
        finalSnapshot = snapshot;
      },
      complete: async () => {
        throw new AuthorityAdoptionOutcomeUnknownError(
          "response lost after activation",
        );
      },
    });

    await expect(
      transferLocalCollectionToHosted({
        source: source.collection,
        controlUrl: "https://connect.test",
        displayName: "TaskNotes",
        sourceName: "This phone",
        client: interrupted,
        onCheckpoint: (value) => {
          checkpoint = value;
        },
      }),
    ).rejects.toMatchObject({ sourceMustRemainFenced: true });
    expect(checkpoint?.snapshot).toEqual({
      sourceRevision: finalSnapshot!.source_revision,
      manifestDigest: finalSnapshot!.manifest_digest,
      sourceHead: finalSnapshot!.source_head,
    });
    await expect(
      source.collection.createViewSource({
        name: "Divergence",
        document: "views: []\n",
      }),
    ).rejects.toThrow(/temporarily read-only/);

    localStorage.clear();
    const resumed = clientDouble({
      exchange: {
        status: "activating",
        adoption: adoptionView(finalSnapshot!, "activating"),
      },
    });
    await expect(
      transferLocalCollectionToHosted({
        source: new MarkdownCollection(source.vault),
        controlUrl: "https://connect.test",
        displayName: "TaskNotes",
        sourceName: "This phone",
        checkpoint,
        client: resumed,
      }),
    ).resolves.toMatchObject({ records: 2, views: 1 });
  });

  it("releases the local fence when final staging fails before activation starts", async () => {
    const source = await localCollection();
    let uploads = 0;
    const client = clientDouble({
      afterFirstUpload: async () => {
        await source.vault.writeText(
          "notes/late.md",
          "---\ntitle: Late\n---\nLate\n",
        );
      },
      upload: () => {
        uploads += 1;
        if (uploads === 2) throw new Error("upload interrupted");
      },
    });
    let checkpoint: CollectionTransferCheckpoint | undefined;
    await expect(
      transferLocalCollectionToHosted({
        source: source.collection,
        controlUrl: "https://connect.test",
        displayName: "TaskNotes",
        sourceName: "This phone",
        client,
        onCheckpoint: (value) => {
          checkpoint = value;
        },
      }),
    ).rejects.toThrow("upload interrupted");
    expect(checkpoint?.snapshot).toBeUndefined();

    await expect(
      source.collection.createViewSource({
        path: "views/after-failure.base",
        document: "views: []\n",
      }),
    ).resolves.toMatchObject({ path: "views/after-failure.base" });
  });

  it("releases a recovered fence when Connect confirms adoption expired before activation", async () => {
    const source = await localCollection();
    let checkpoint: CollectionTransferCheckpoint | undefined;
    await expect(
      transferLocalCollectionToHosted({
        source: source.collection,
        controlUrl: "https://connect.test",
        displayName: "TaskNotes",
        sourceName: "This phone",
        client: clientDouble({
          complete: async () => {
            throw new AuthorityAdoptionOutcomeUnknownError("provider timeout");
          },
        }),
        onCheckpoint: (value) => {
          checkpoint = value;
        },
      }),
    ).rejects.toMatchObject({ sourceMustRemainFenced: true });

    let checkpointCleared = false;
    let cancellations = 0;
    const recovered = new MarkdownCollection(source.vault);
    await expect(
      transferLocalCollectionToHosted({
        source: recovered,
        controlUrl: "https://connect.test",
        displayName: "TaskNotes",
        sourceName: "This phone",
        checkpoint,
        client: clientDouble({
          exchangeError: new AuthorityAdoptionError(
            "authority_adoption_expired",
            "expired",
            409,
          ),
          cancel: () => {
            cancellations += 1;
          },
        }),
        onCheckpointCleared: () => {
          checkpointCleared = true;
        },
      }),
    ).rejects.toThrow(/remains authoritative and writable/);
    expect(checkpointCleared).toBe(true);
    expect(cancellations).toBe(1);
    await expect(
      recovered.createViewSource({
        path: "views/after-expiry.base",
        document: "views: []\n",
      }),
    ).resolves.toMatchObject({ path: "views/after-expiry.base" });
  });

  it("resumes an interrupted approval from the original request instead of creating another adoption", async () => {
    const source = await localCollection();
    let checkpoint: CollectionTransferCheckpoint | undefined;
    await expect(
      transferLocalCollectionToHosted({
        source: source.collection,
        controlUrl: "https://connect.test",
        displayName: "TaskNotes",
        sourceName: "This phone",
        client: clientDouble({
          approvalError: new DOMException("closed", "AbortError"),
        }),
        onCheckpoint: (value) => {
          checkpoint = value;
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(checkpoint?.snapshot).toBeUndefined();

    let verificationCount = 0;
    await expect(
      transferLocalCollectionToHosted({
        source: new MarkdownCollection(source.vault),
        controlUrl: "https://connect.test",
        displayName: "TaskNotes",
        sourceName: "This phone",
        checkpoint,
        client: clientDouble(),
        onVerification: () => {
          verificationCount += 1;
        },
      }),
    ).resolves.toMatchObject({ records: 2 });
    expect(verificationCount).toBe(1);
  });

  it("moves exactly the compatibility view sources configured by the collection", async () => {
    const source = await localCollection();
    const configuration = await source.vault.readText("mdbase.yaml");
    await source.vault.writeText(
      "mdbase.yaml",
      configuration.replace("views/**/*.base", "boards/**/*.base"),
    );
    await source.vault.writeText("boards/mobile.base", "views: []\n");
    let final: AuthorityImportSnapshot | undefined;
    await transferLocalCollectionToHosted({
      source: source.collection,
      controlUrl: "https://connect.test",
      displayName: "TaskNotes",
      sourceName: "This phone",
      client: clientDouble({
        upload: (snapshot) => {
          final = snapshot;
        },
      }),
    });
    expect(
      final?.resources.documents
        ?.filter(({ kind }) => kind === "view")
        .map(({ path }) => path),
    ).toEqual(["boards/mobile.base"]);
  });
});

async function localCollection() {
  const vault = new MemoryVault();
  const collection = new MarkdownCollection(vault);
  await collection.initialize();
  const taskId = crypto.randomUUID();
  const task = await collection.createTask(
    {
      title: "Source task",
      body: "Keep this body.",
    },
    taskId,
    "2026-07-27T10:00:00.000Z",
  );
  task.path = "tasks/source.md";
  await collection.write(task);
  await vault.writeText("notes/context.md", "# Context\n\nLinked note.");
  await vault.writeText(
    "views/tasks.base",
    "views:\n  - type: table\n    name: Tasks\n",
  );
  return { collection, taskId, vault };
}

function clientDouble(
  options: {
    afterFirstUpload?: () => Promise<void>;
    upload?: (snapshot: AuthorityImportSnapshot) => void;
    complete?: () => Promise<never>;
    exchange?:
      | PreparedAuthorityAdoption
      | { status: "activating"; adoption: AuthorityAdoptionView };
    exchangeError?: Error;
    approvalError?: Error;
    cancel?: () => void;
  } = {},
): AuthorityAdoptionClient {
  const adoptionId = crypto.randomUUID();
  let session: AuthorityAdoptionSession;
  let uploads = 0;
  const prepared = (): PreparedAuthorityAdoption => ({
    status: "ready",
    adoption: {
      id: adoptionId,
      collection_id: session.requested.collectionId,
      display_name: "TaskNotes",
      source_name: "This phone",
      retain_mirror: false,
      mirror_name: null,
      state: "prepared",
      authority_epoch: 2,
      final_head: null,
      manifest_digest: null,
      source_revision: null,
      expires_at: session.expiresAt,
    },
    import: {
      import_id: adoptionId,
      manifest_url: `https://provider.test/v1/authority-imports/${adoptionId}/manifest`,
      records_url: `https://provider.test/v1/authority-imports/${adoptionId}/records`,
      files_url: `https://provider.test/v1/authority-imports/${adoptionId}/files`,
      finalize_url: `https://provider.test/v1/authority-imports/${adoptionId}/finalize`,
      access_token: "ati_test_secret_long_enough",
    },
    staged: {
      state: "receiving",
      manifest_digest: null,
      source_revision: null,
      source_head: null,
    },
  });
  return {
    begin: async (input: BeginAuthorityAdoptionInput) => {
      session = {
        controlUrl: input.controlUrl,
        adoptionId,
        credential: "adp_test_secret_long_enough",
        verificationUri: `${input.controlUrl}/adopt/${adoptionId}`,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        requested: {
          collectionId: input.collectionId,
          displayName: input.displayName,
          sourceName: input.sourceName,
          retainMirror: input.retainMirror ?? true,
          ...(input.mirrorName ? { mirrorName: input.mirrorName } : {}),
        },
      };
      return session;
    },
    waitForApproval: async (resumedSession: AuthorityAdoptionSession) => {
      session = resumedSession;
      if (options.approvalError) throw options.approvalError;
      return prepared();
    },
    exchange: async (resumedSession: AuthorityAdoptionSession) => {
      session = resumedSession;
      if (options.exchangeError) throw options.exchangeError;
      return options.exchange ?? prepared();
    },
    cancel: async () => {
      options.cancel?.();
    },
    uploadSnapshot: async (
      _session: AuthorityAdoptionSession,
      _prepared: PreparedAuthorityAdoption,
      snapshot: AuthorityImportSnapshot,
    ) => {
      uploads += 1;
      options.upload?.(snapshot);
      if (uploads === 1) await options.afterFirstUpload?.();
    },
    complete: async (
      _session: AuthorityAdoptionSession,
      snapshot: AuthorityImportSnapshot,
    ) => {
      if (options.complete) return options.complete();
      return {
        status: "completed",
        adoption: adoptionView(snapshot, "completed"),
      };
    },
  } as unknown as AuthorityAdoptionClient;
}

function adoptionView(
  snapshot: AuthorityImportSnapshot,
  state: "activating" | "completed",
): AuthorityAdoptionView {
  return {
    id: "",
    collection_id: snapshot.collection_id,
    display_name: "TaskNotes",
    source_name: "This phone",
    retain_mirror: false,
    mirror_name: null,
    state,
    authority_epoch: 2,
    final_head: snapshot.source_head,
    manifest_digest: snapshot.manifest_digest,
    source_revision: snapshot.source_revision,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}
