/** LOCAL TEST scenario: real NextTaskRepository over the actual native data
 * facade. No synthetic Describe, MemoryReplica, UI activation or shared data. */
import type { MdbaseClient, wire } from "@mdbase-dev/sdk";
import { buildTaskNotesMdbaseResources, TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import { NextTaskRepository } from "../src/storage/next-repository";
const TASK = "99999999-9999-4999-8999-999999999999";
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const requireTest: (value: unknown, message: string) => asserts value = (value, message) => {if (!value) throw Error(`owned native TaskNotes: ${message}`);};
/** Drive the actual owned host/log pump, never synthesize a confirmation or
 * retry an operation. Bounded foreground drive preserves unknown outcomes. */
export async function qualifyNativeTaskNotes(options: {
  client: MdbaseClient; accountId: string; mode: "fresh" | "existing";
  offline: boolean; drive(): Promise<void>;
}) {
  const {client, accountId, mode, offline, drive} = options;
  let repository: NextTaskRepository | null = null;
  async function driven<T>(promise: Promise<T>, mustWait = false): Promise<T> {
    let done = false, failure: unknown, result: T | undefined;
    void promise.then(value => {result = value; done = true;}, error => {failure = error; done = true;});
    if (mustWait) {await pause(40); requireTest(!done, "Saved resolved before any log drive");}
    for (let round = 0; round < 100 && !done; round++) {await drive(); await pause(50);}
    if (!done) {
      const observed = submitted.length ? await client.receipt(submitted.at(-1)!, AbortSignal.timeout(5000)) : null;
      throw Error(`owned native TaskNotes: bounded drive exhausted; original receipt ${observed?.state ?? "not submitted"}; ${observed?.problem?.code ?? "no problem"}; preserve operation`);
    }
    if (failure !== undefined) throw failure; return result as T;
  }
  const submitted: string[] = [], originalSubmit = client.submit.bind(client);
  client.submit = async (...args) => {const writes = await originalSubmit(...args); submitted.push(...writes.map(w => w.receipt.mutation)); return writes;};
  try {
    if (mode === "fresh") {
      requireTest(!offline, "new catalog must not be installed offline");
      const generated = buildTaskNotesMdbaseResources({profiles: ["core-lite"]});
      for (const [path, document] of [
        [generated.paths.config, generated.configDocument],
        [generated.paths.taskSchema, generated.taskSchemaDocument],
        [generated.paths.bindingSchema, generated.bindingSchemaDocument],
        [generated.paths.contract, generated.contractDocument],
        [generated.paths.type, generated.typeDocument],
      ]) {
        const write = await client.resources.put(path!, document!, {mustNotExist: true});
        const receipt = await driven(write.confirmed);
        requireTest(receipt.state === "confirmed", "catalog resource lacks confirmed receipt");
      }
    }
    const catalog = await client.describe(AbortSignal.timeout(5000));
    const contract = catalog.contracts.find(c => c.id === "tasknotes.task" && c.version === TASKNOTES_SPEC_VERSION && c.digest === TASKNOTES_CONTRACT_DIGEST);
    requireTest(contract, "real Describe lacks the exact TaskNotes contract/digest");
    requireTest(catalog.types.some(t => t.implements.some(i => i.contract === contract!.id && i.version === contract!.version)), "real catalog lacks an implementing task type");
    repository = new NextTaskRepository(client, "Owned native TaskNotes", accountId);
    await repository.initialize();
    let createdConfirmed = false, editedConfirmed = false;
    if (mode === "fresh") {
      const intent = {id: TASK, authorityRequestId: undefined as string | undefined};
      const created = await driven(repository.create({title: "Native create", body: "Original native task body"}, intent), true);
      requireTest(created.id === TASK && created.title === "Native create", "created task differs from original intent");
      requireTest(intent.authorityRequestId, "create lost its original mutation identity");
      const receipt = await client.receipt(intent.authorityRequestId!, AbortSignal.timeout(5000));
      requireTest(receipt.state === "confirmed", "TaskRepository create returned before confirmed receipt"); createdConfirmed = true;
      const before = submitted.length;
      const edited = await driven(repository.update(TASK, {title: "Native edited", body: "Confirmed native task body"}), true);
      requireTest(edited.id === TASK && edited.title === "Native edited" && edited.body === "Confirmed native task body", "edited task mismatch");
      requireTest(submitted.length === before + 1, "edit was resubmitted or no original mutation recorded");
      const updated: wire.Receipt = await client.receipt(submitted.at(-1)!, AbortSignal.timeout(5000));
      requireTest(updated.state === "confirmed", "TaskRepository edit returned before confirmed receipt"); editedConfirmed = true;
    }
    const restored = await repository.get(TASK);
    requireTest(restored?.id === TASK && restored.title === "Native edited" && restored.body === "Confirmed native task body", "original confirmed task not readable after restart/offline");
    return {summary: {actualTaskRepository: true, nativeTaskCatalog: true, exactContractDigest: true, createdConfirmed, editedConfirmed, sameTaskReadable: true, offline, noSyntheticDescribe: true, noMemoryReplica: true, uiSavedBadgeQualified: false}, dispose: () => repository?.dispose()};
  } catch (error) {repository?.dispose(); throw error;}
  finally {client.submit = originalSubmit;}
}
