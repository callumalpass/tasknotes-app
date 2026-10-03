import { connectFailure, connectSuccess } from "@mdbase-dev/connect-testing";
import { expect, it } from "vitest";
import {
  mdbaseFixture,
  taskRecord,
  unknownOutcome,
} from "../test/mdbase-fixture";
import { MdbaseTaskRepository } from "./mdbase-repository";

it.each(["create", "update", "delete"] as const)(
  "recovers exact saved-view %s receipts and invalidates cached executions",
  async (operation) => {
    const fixture = mdbaseFixture([taskRecord("one", "One", "r1")]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const view = (await repository.listViews())[0].views[0];
    await repository.executeView(view);
    expect(await repository.cachedViewExecution(view)).not.toBeNull();
    const source = await repository.readViewSource("views/tasks.base");
    const document =
      "views:\n  - name: Exact intent\n    type: tasknotesTaskList\n";
    const invoke = () =>
      operation === "create"
        ? repository.createViewSource({ path: "Views/exact.base", document })
        : operation === "update"
          ? repository.updateViewSource({
              path: source.path,
              document,
              ifRevision: source.revision,
            })
          : repository.deleteViewSource(source.path, source.revision);
    const method =
      operation === "create"
        ? fixture.create
        : operation === "update"
          ? fixture.update
          : fixture.remove;
    const stage = (accepted: { result: unknown }): never => {
      let attempt = 0;
      fixture.stagePendingMutation("fixture-request", async () =>
        ++attempt === 1
          ? connectFailure(unknownOutcome().problem)
          : connectSuccess(accepted.result),
      );
      throw unknownOutcome();
    };
    if (operation === "create") {
      const persist = fixture.create.getMockImplementation()!;
      fixture.create.mockImplementationOnce(async (input) =>
        stage(await persist(input)),
      );
    } else if (operation === "update") {
      const persist = fixture.update.getMockImplementation()!;
      fixture.update.mockImplementationOnce(async (input) =>
        stage(await persist(input)),
      );
    } else {
      const persist = fixture.remove.getMockImplementation()!;
      fixture.remove.mockImplementationOnce(async (input) =>
        stage(await persist(input)),
      );
    }
    await expect(invoke()).rejects.toMatchObject({
      code: "operation_outcome_unknown",
    });
    expect(await repository.cachedViewExecution(view)).not.toBeNull();
    const recovered = await invoke();
    if (operation === "delete") expect(recovered).toBeUndefined();
    else expect(recovered).toMatchObject({ document });
    expect(method).toHaveBeenCalledOnce();
    expect(await repository.cachedViewExecution(view)).toBeNull();
  },
);
