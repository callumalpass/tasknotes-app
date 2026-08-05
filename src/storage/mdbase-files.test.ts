import { MdbaseFileClient, type MdbaseConnection } from "@mdbase-dev/connect";
import type {
  CollectionFileDescriptor as WireCollectionFileDescriptor,
  FileTransferSession,
  OpenFileUploadRequest,
} from "@mdbase-dev/connect-protocol";
import { describe, expect, it } from "vitest";

import {
  MdbaseCollectionFileStore,
  TASKNOTES_FILE_ACTIONS,
} from "./mdbase-files";

describe("TaskNotes mdbase files", () => {
  it("uploads, lists, streams, moves, replaces, and deletes image bytes through the beta.23 client", async () => {
    const authority = new MemoryFileAuthority();
    const client = new MdbaseFileClient(
      () => ({
        kind: "files",
        protocol_version: 1,
        actions: [...TASKNOTES_FILE_ACTIONS],
        scope: { kind: "collection" },
      }),
      authority.request,
      authority.framed,
    );
    const connection = {
      files: client,
      fileCapability: {
        kind: "files",
        protocol_version: 1,
        actions: [...TASKNOTES_FILE_ACTIONS],
        scope: { kind: "collection" },
      },
    } as unknown as MdbaseConnection;
    const store = new MdbaseCollectionFileStore(connection);
    const original = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);

    expect([...store.authorizedActions()]).toEqual(TASKNOTES_FILE_ACTIONS);
    const uploaded = await store.upload(
      "attachments/tasks/task-1/photo.png",
      original,
      { mediaType: "image/png" },
    );
    expect(uploaded).toMatchObject({
      path: "attachments/tasks/task-1/photo.png",
      size: original.byteLength,
      mediaType: "image/png",
      mediaClass: "image",
    });
    expect(await store.list({ folder: "attachments/tasks/task-1" })).toEqual([
      uploaded,
    ]);
    expect(
      new Uint8Array(await (await store.download(uploaded)).arrayBuffer()),
    ).toEqual(original);
    expect(
      new Uint8Array(
        await new Response(await store.downloadStream(uploaded)).arrayBuffer(),
      ),
    ).toEqual(original);

    const moved = await store.move(
      uploaded,
      "attachments/tasks/task-1/renamed.png",
    );
    expect(moved.path).toBe("attachments/tasks/task-1/renamed.png");

    const replacement = new Uint8Array([137, 80, 78, 71, 9, 8, 7]);
    const replaced = await store.upload(moved.path, replacement, {
      mediaType: "image/png",
      ifRevision: moved.revision,
    });
    expect(replaced.fileId).toBe(moved.fileId);
    expect(
      new Uint8Array(await (await store.download(replaced)).arrayBuffer()),
    ).toEqual(replacement);

    await store.delete(replaced);
    expect(await store.list()).toEqual([]);
  });

  it("combines caller and collection lifecycle cancellation for file work", async () => {
    const lifecycle = new AbortController();
    const caller = new AbortController();
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const connection = {
      files: {
        list: async function* (options: { signal?: AbortSignal }) {
          started();
          await new Promise((_, reject) => {
            options.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          });
          yield* [];
        },
      },
      fileCapability: null,
    } as unknown as MdbaseConnection;
    const store = new MdbaseCollectionFileStore(
      connection,
      () => lifecycle.signal,
    );

    const listing = store.list({ signal: caller.signal });
    await didStart;
    lifecycle.abort(new DOMException("Collection closed.", "AbortError"));

    await expect(listing).rejects.toMatchObject({ name: "AbortError" });
    expect(caller.signal.aborted).toBe(false);
  });
});

interface PendingTransfer {
  direction: "upload" | "download";
  size: number;
  upload?: OpenFileUploadRequest;
  file?: WireCollectionFileDescriptor;
  chunks: Map<number, Uint8Array>;
}

class MemoryFileAuthority {
  private readonly files = new Map<
    string,
    { descriptor: WireCollectionFileDescriptor; bytes: Uint8Array }
  >();
  private readonly transfers = new Map<string, PendingTransfer>();

  readonly framed = {
    uploadChunk: async (
      session: FileTransferSession,
      chunkIndex: number,
      bytes: Uint8Array,
    ) => {
      this.transfers
        .get(session.transfer_id)
        ?.chunks.set(chunkIndex, Uint8Array.from(bytes));
    },
    downloadChunk: async (session: FileTransferSession, chunkIndex: number) => {
      const transfer = this.transfers.get(session.transfer_id)!;
      const bytes = this.files.get(transfer.file!.file_id)!.bytes;
      return bytes.slice(chunkIndex * 3, chunkIndex * 3 + 3);
    },
  };

  readonly request = async <Result>(
    method: "GET" | "POST" | "DELETE",
    path = "",
    input?: unknown,
  ): Promise<Result> => {
    const statusMatch =
      method === "GET" ? path.match(/^transfers\/(.+)$/u) : null;
    if (statusMatch) {
      const transferId = decodeURIComponent(statusMatch[1]!);
      const transfer = this.transfers.get(transferId);
      if (!transfer) throw new Error("Transfer not found.");
      return {
        protocol_version: 1,
        type: "file_transfer_status",
        transfer_id: transferId,
        state: "open",
        received: [],
        received_bytes: 0,
        uploaded_parts: [],
      } as Result;
    }
    if (method === "GET") {
      const folder = new URLSearchParams(path.replace(/^\?/, "")).get("folder");
      const files = [...this.files.values()]
        .map(({ descriptor }) => descriptor)
        .filter((file) => !folder || file.path.startsWith(`${folder}/`));
      return { protocol_version: 1, type: "files_page", files } as Result;
    }
    if (method === "DELETE") {
      this.transfers.delete(path.replace(/^transfers\//, ""));
      return {} as Result;
    }
    if (path === "uploads") {
      const upload = input as OpenFileUploadRequest;
      this.transfers.set(upload.transfer_id, {
        direction: "upload",
        size: upload.size,
        upload,
        chunks: new Map(),
      });
      return transferSession(
        upload.transfer_id,
        "upload",
        upload.size,
      ) as Result;
    }
    if (/^uploads\/[^/]+\/commit$/.test(path)) {
      const transferId = path.split("/")[1]!;
      const transfer = this.transfers.get(transferId)!;
      const upload = transfer.upload!;
      const bytes = joinChunks(transfer.chunks);
      const existing = [...this.files.values()].find(
        ({ descriptor }) => descriptor.path === upload.path,
      );
      const descriptor: WireCollectionFileDescriptor = {
        file_id: existing?.descriptor.file_id ?? crypto.randomUUID(),
        path: upload.path,
        revision: crypto.randomUUID(),
        content_digest: upload.content_digest,
        size: bytes.byteLength,
        ...(upload.media_type ? { media_type: upload.media_type } : {}),
        media_class: upload.media_type?.startsWith("image/")
          ? "image"
          : "other",
        modified_at: new Date().toISOString(),
      };
      this.files.set(descriptor.file_id, { descriptor, bytes });
      return {
        protocol_version: 1,
        type: "file_upload_committed",
        transfer_id: transferId,
        file: descriptor,
      } as Result;
    }
    if (path === "downloads") {
      const request = input as { transfer_id: string; file_id: string };
      const stored = this.files.get(request.file_id)!;
      this.transfers.set(request.transfer_id, {
        direction: "download",
        size: stored.bytes.byteLength,
        file: stored.descriptor,
        chunks: new Map(),
      });
      return transferSession(
        request.transfer_id,
        "download",
        stored.bytes.byteLength,
      ) as Result;
    }
    if (path.endsWith("/move")) {
      const request = input as {
        mutation_id: string;
        file_id: string;
        path: string;
      };
      const stored = this.files.get(request.file_id)!;
      stored.descriptor = {
        ...stored.descriptor,
        path: request.path,
        revision: crypto.randomUUID(),
      };
      return {
        protocol_version: 1,
        type: "file_moved",
        mutation_id: request.mutation_id,
        file: stored.descriptor,
      } as Result;
    }
    if (path.endsWith("/delete")) {
      const request = input as {
        mutation_id: string;
        file_id: string;
        path: string;
      };
      const revision = this.files.get(request.file_id)!.descriptor.revision;
      this.files.delete(request.file_id);
      return {
        protocol_version: 1,
        type: "file_deleted",
        mutation_id: request.mutation_id,
        file_id: request.file_id,
        previous_path: request.path,
        revision,
      } as Result;
    }
    throw new Error(`Unexpected file request: ${method} ${path}`);
  };
}

function transferSession(
  transferId: string,
  direction: "upload" | "download",
  size: number,
): FileTransferSession {
  return {
    protocol_version: 1,
    type: "file_transfer",
    transfer_id: transferId,
    direction,
    protection: "grant_aead_v1",
    strategy: { kind: "framed_chunks", chunk_size: 3 },
    total_size: size,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    received: [],
  };
}

function joinChunks(chunks: Map<number, Uint8Array>): Uint8Array {
  const ordered = [...chunks.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, bytes]) => bytes);
  const output = new Uint8Array(
    ordered.reduce((size, bytes) => size + bytes.byteLength, 0),
  );
  let offset = 0;
  for (const bytes of ordered) {
    output.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return output;
}
