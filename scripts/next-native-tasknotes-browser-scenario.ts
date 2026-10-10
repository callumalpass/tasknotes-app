/** LOCAL TEST scenario: real NextTaskRepository over the actual native data
 * facade. No synthetic Describe, MemoryReplica, UI activation or shared data. */
import type { MdbaseClient, wire } from "@mdbase-dev/sdk";
import {
  buildTaskNotesMdbaseResources,
  TASKNOTES_CONTRACT_DIGEST,
} from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import { NextTaskRepository } from "../src/storage/next-repository";
import { qualifyNativeTaskNotesLocalCallers } from "./next-native-tasknotes-local-callers";
const TASK = "99999999-9999-4999-8999-999999999999";
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const requireTest: (value: unknown, message: string) => asserts value = (
  value,
  message,
) => {
  if (!value) throw Error(`owned native TaskNotes: ${message}`);
};
/** Drive the actual owned host/log pump, never synthesize a confirmation or
 * retry an operation. Bounded foreground drive preserves unknown outcomes. */
export async function qualifyNativeTaskNotes(options: {
  client: MdbaseClient;
  accountId: string;
  mode: "fresh" | "existing";
  offline: boolean;
  uiProbe?: boolean;
  drive(): Promise<void>;
}) {
  const { client, accountId, mode, offline, drive } = options;
  let repository: NextTaskRepository | null = null,
    uiDispose: (() => void) | undefined;
  async function driven<T>(
    promise: Promise<T>,
    localCapture = false,
  ): Promise<T> {
    let done = false,
      failure: unknown,
      result: T | undefined;
    void promise.then(
      (value) => {
        result = value;
        done = true;
      },
      (error) => {
        failure = error;
        done = true;
      },
    );
    // Record capture must finish WITHOUT any authority/log drive. Resources
    // and the later original-receipt confirmation retain the real log pump.
    for (let round = 0; round < 100 && !done; round++) {
      if (!localCapture) await drive();
      await pause(50);
    }
    if (!done) {
      const observed = submitted.length
        ? await client.receipt(submitted.at(-1)!, AbortSignal.timeout(5000))
        : null;
      throw Error(
        `owned native TaskNotes: bounded drive exhausted; original receipt ${observed?.state ?? "not submitted"}; ${observed?.problem?.code ?? "no problem"}; preserve operation`,
      );
    }
    if (failure !== undefined) throw failure;
    return result as T;
  }
  const submitted: string[] = [],
    originalSubmit = client.submit.bind(client);
  client.submit = async (...args) => {
    const writes = await originalSubmit(...args);
    submitted.push(...writes.map((w) => w.receipt.mutation));
    return writes;
  };
  try {
    if (mode === "fresh") {
      requireTest(!offline, "new catalog must not be installed offline");
      // Native rc.5 schemas are resources beneath the configured type folder;
      // use the real generator's supported placement option, not rewritten docs.
      const generated = buildTaskNotesMdbaseResources({
        profiles: ["core-lite"],
        schemasFolder: "_types/tasknotes",
        stableId: true,
      });
      for (const [path, document] of [
        [generated.paths.config, generated.configDocument],
        [generated.paths.taskSchema, generated.taskSchemaDocument],
        [generated.paths.bindingSchema, generated.bindingSchemaDocument],
        [generated.paths.contract, generated.contractDocument],
        [generated.paths.type, generated.typeDocument],
      ]) {
        const write = await client.resources.put(path!, document!, {
          mustNotExist: true,
        });
        const receipt = await driven(write.confirmed);
        requireTest(
          receipt.state === "confirmed",
          "catalog resource lacks confirmed receipt",
        );
      }
    }
    const catalog = await client.describe(AbortSignal.timeout(5000));
    const contract = catalog.contracts.find(
      (c) =>
        c.id === "tasknotes.task" &&
        c.version === TASKNOTES_SPEC_VERSION &&
        c.digest === TASKNOTES_CONTRACT_DIGEST,
    );
    requireTest(
      contract,
      "real Describe lacks the exact TaskNotes contract/digest",
    );
    requireTest(
      catalog.types.some((t) =>
        t.implements.some(
          (i) => i.contract === contract!.id && i.version === contract!.version,
        ),
      ),
      "real catalog lacks an implementing task type",
    );
    repository = new NextTaskRepository(
      client,
      "Owned native TaskNotes",
      accountId,
      { clientOwnership: "borrowed" },
    );
    await repository.initialize();
    let localCallers:
      | Awaited<ReturnType<typeof qualifyNativeTaskNotesLocalCallers>>
      | undefined;
    let createdConfirmed = false,
      editedConfirmed = false,
      localCaptureQualified = false,
      pendingMetadataRestored = false,
      portableId: string | null = null;
    if (mode === "fresh") {
      const beforeCreate = submitted.length;
      const intent = {
        id: TASK,
        authorityRequestId: undefined as string | undefined,
      };
      const created = await driven(
        repository.create(
          { title: "Native create", body: "Original native task body" },
          intent,
        ),
        true,
      );
      // TASK is the original native record ID; the real catalog's on_create
      // lifecycle assigns the portable frontmatter ID. Preserve both identities.
      const originalRecord = await client.get(
        TASK,
        { body: true, effective: true },
        AbortSignal.timeout(5000),
      );
      requireTest(
        originalRecord.id === TASK &&
          originalRecord.path === created.path &&
          created.id &&
          created.title === "Native create" &&
          created.body === "Original native task body",
        "created task differs from original native record/intent",
      );
      portableId = created.id;
      // The repository clears its recovery request ID only after confirmation.
      // Retain the one original SDK submission, not a new retry identifier.
      requireTest(
        submitted.length === beforeCreate + 1,
        "create was resubmitted or no original SDK mutation recorded",
      );
      const createMutation = submitted[beforeCreate]!;
      requireTest(
        createMutation,
        "create lost its original SDK mutation identity",
      );
      const receipt = await client.receipt(
        createMutation,
        AbortSignal.timeout(5000),
      );
      requireTest(
        receipt.state === "pending" &&
          originalRecord.state.state === "pending" &&
          Number.isSafeInteger(originalRecord.state.confirmedSeq) &&
          originalRecord.state.confirmedSeq >= 0 &&
          !originalRecord.state.hold &&
          !originalRecord.state.unresolved &&
          intent.authorityRequestId === createMutation &&
          repository.writeState({ kind: "task", id: created.id }) === "pending",
        "create did not return a genuine pending native READ/original MID",
      );
      const createAck = await driven(
        client.awaitReceipt(createMutation, 5000, AbortSignal.timeout(5000)),
      );
      requireTest(
        createAck.mutation === createMutation &&
          createAck.state === "confirmed" &&
          submitted.length === beforeCreate + 1,
        "original create did not confirm without replacement submission",
      );
      createdConfirmed = true;
      const before = submitted.length;
      const edited = await driven(
        repository.update(created.id, {
          title: "Native edited",
          body: "Confirmed native task body",
        }),
        true,
      );
      requireTest(
        edited.id === portableId &&
          edited.title === "Native edited" &&
          edited.body === "Confirmed native task body",
        "edited task mismatch",
      );
      requireTest(
        submitted.length === before + 1,
        "edit was resubmitted or no original mutation recorded",
      );
      const updated: wire.Receipt = await client.receipt(
        submitted.at(-1)!,
        AbortSignal.timeout(5000),
      );
      requireTest(
        updated.state === "pending" &&
          repository.writeState({ kind: "task", id: portableId }) === "pending",
        "edit did not return before original authority confirmation",
      );
      const editedRecord = await client.get(
        TASK,
        { body: true, document: true, effective: true },
        AbortSignal.timeout(5000),
      );
      requireTest(
        editedRecord.id === TASK &&
          editedRecord.path === originalRecord.path &&
          editedRecord.state.state === "pending" &&
          Number.isSafeInteger(editedRecord.state.confirmedSeq) &&
          editedRecord.state.confirmedSeq >= 0 &&
          !editedRecord.state.hold &&
          !editedRecord.state.unresolved &&
          editedRecord.body === edited.body,
        "edited pending native document/identity/path differs from capture",
      );
      // A second repository over this SAME borrowed native client qualifies
      // pending metadata restoration, not a process/session/power-loss restart.
      const reopened = new NextTaskRepository(
        client,
        "Owned native TaskNotes restored metadata",
        accountId,
        { clientOwnership: "borrowed" },
      );
      try {
        await reopened.initialize();
        const task = await reopened.get(portableId);
        const pending = await client.pendingWrites(AbortSignal.timeout(5000));
        requireTest(
          task?.id === portableId &&
            task.path === edited.path &&
            task.title === edited.title &&
            task.body === edited.body &&
            reopened.writeState({ kind: "task", id: portableId }) ===
              "pending" &&
            pending.some(
              (write) => write.receipt.mutation === updated.mutation,
            ) &&
            submitted.length === before + 1,
          "new repository lost original pending metadata/MID or submitted again",
        );
        const editAck = await driven(
          client.awaitReceipt(
            updated.mutation,
            5000,
            AbortSignal.timeout(5000),
          ),
        );
        requireTest(
          editAck.mutation === updated.mutation &&
            editAck.state === "confirmed" &&
            submitted.length === before + 1,
          "original edit did not confirm without replacement submission",
        );
        await reopened.reconcileWrites();
        const confirmed = await reopened.get(portableId);
        requireTest(
          confirmed?.id === portableId &&
            confirmed.path === edited.path &&
            confirmed.title === edited.title &&
            confirmed.body === edited.body &&
            reopened.writeState({ kind: "task", id: portableId }) === undefined,
          "original ACK did not clear restored metadata/current native READ",
        );
        pendingMetadataRestored = true;
      } finally {
        reopened.dispose();
      }
      editedConfirmed = true;
      localCaptureQualified = true;
      localCallers = await qualifyNativeTaskNotesLocalCallers({
        repository,
        client,
        taskId: portableId,
        submitted,
        capture: (promise) => driven(promise, true),
        confirm: async (mutation) => {
          const receipt = await driven(
            client.awaitReceipt(mutation, 5000, AbortSignal.timeout(5000)),
          );
          requireTest(
            receipt.mutation === mutation && receipt.state === "confirmed",
            "caller original MID did not confirm",
          );
        },
      });
    }
    const originalRecord = await client.get(
      TASK,
      { body: true, effective: true },
      AbortSignal.timeout(5000),
    );
    requireTest(
      originalRecord.id === TASK,
      "original native record identity changed",
    );
    if (portableId === null) {
      const tasks = await repository.list();
      const original = tasks.filter(
        (task) => task.path === originalRecord.path,
      );
      requireTest(
        original.length === 1,
        "original native task path is missing/ambiguous",
      );
      portableId = original[0]!.id;
    }
    const restored = await repository.get(portableId);
    const expectedTitle =
      options.uiProbe && mode !== "fresh" ? "Native UI saved" : "Native edited";
    requireTest(
      restored?.id === portableId &&
        restored.path === originalRecord.path &&
        restored.title === expectedTitle &&
        restored.body === "Confirmed native task body",
      "original confirmed task not readable after restart/offline",
    );
    const ui = options.uiProbe
      ? await (
          await import("./next-native-tasknotes-ui-scenario")
        ).qualifyNativeTaskNotesUi({
          repository,
          client,
          taskId: portableId,
          fresh: mode === "fresh",
          submitted,
          drive,
        })
      : undefined;
    uiDispose = ui?.dispose;
    return {
      summary: {
        actualTaskRepository: true,
        nativeTaskCatalog: true,
        exactContractDigest: true,
        nativeRecordId: originalRecord.id,
        portableTaskId: restored.id,
        createdConfirmed,
        editedConfirmed,
        localCaptureQualified,
        pendingMetadataRestored,
        pendingRestorationUsesSameBorrowedClient: true,
        sameTaskReadable: true,
        offline,
        noSyntheticDescribe: true,
        noMemoryReplica: true,
        ...localCallers,
        ...ui?.summary,
        uiSavedBadgeQualified: Boolean(ui?.summary.uiSavedBadgeQualified),
      },
      dispose: () => {
        uiDispose?.();
        repository?.dispose();
      },
    };
  } catch (error) {
    uiDispose?.();
    repository?.dispose();
    throw error;
  } finally {
    client.submit = originalSubmit;
  }
}
