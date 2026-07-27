import type { MdbaseConnection } from "@mdbase/connect";
import type {
  JsonObject,
  SyncCollectionResources,
} from "@mdbase/connect-protocol";
import {
  MemoryAuthority,
  SyncError,
  type SyncTransport,
} from "@mdbase/connect-sync";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { describe, expect, it, vi } from "vitest";

import { todayString } from "../domain/task";
import { CloudTaskRepository } from "./cloud-repository";

function resources(): SyncCollectionResources {
  const generated = buildTaskNotesMdbaseResources({
    profiles: ["core-lite"],
  });
  const type = generated.type as unknown as {
    schema: { value: JsonObject };
    collection?: JsonObject;
    "x-tasknotes": JsonObject;
  };
  const contract = type["x-tasknotes"] as JsonObject;
  return {
    revision: crypto.randomUUID(),
    spec_version: "0.3.0",
    types: [
      {
        name: "task",
        version: 1,
        schema: type.schema.value,
        collection: type.collection,
        extensions: { "x-tasknotes": contract },
      },
    ],
    contracts: [
      {
        id: "tasknotes.task",
        version: 1,
        type_name: "task",
        extension: "x-tasknotes",
        configuration: contract,
      },
    ],
  };
}

function resourcesWithType(
  typeName: string,
  folder: string,
): SyncCollectionResources {
  const value = resources();
  value.types[0] = {
    ...value.types[0],
    name: typeName,
    collection: { path: { folder } },
  };
  value.contracts[0] = { ...value.contracts[0], type_name: typeName };
  return value;
}

function resourcesWithTemplate(): SyncCollectionResources {
  const value = resources();
  value.contracts[0] = {
    ...value.contracts[0],
    configuration: {
      ...value.contracts[0].configuration,
      templating: {
        enabled: true,
        template_path: "Templates/Task.md",
        failure_mode: "error",
        unknown_variable_policy: "preserve",
      },
    },
  };
  value.documents = [
    {
      path: "Templates/Task.md",
      kind: "configuration",
      revision: "template:1",
      document: `---
source: cloud-template
status: done
---
Cloud body for {{title}} on {{date}}`,
    },
  ];
  return value;
}

function resourcesWithArchive(): SyncCollectionResources {
  const value = resources();
  value.contracts[0] = {
    ...value.contracts[0],
    configuration: {
      ...value.contracts[0].configuration,
      archive: {
        move_on_archive: true,
        folder: "TaskNotes/Archive",
      },
    },
  };
  return value;
}

function connect(
  collectionId: string,
  replicaId: string,
  transport: SyncTransport<JsonObject>,
  operations: object = {},
): MdbaseConnection<JsonObject> {
  return {
    sync: () => ({ collectionId, replicaId, transport }),
    ...operations,
  } as unknown as MdbaseConnection<JsonObject>;
}

describe("cloud task repository", () => {
  it("restores cached view definitions and revision-matched results before refresh", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resources(),
    });
    const firstReplica = crypto.randomUUID();
    const reopenedReplica = crypto.randomUUID();
    for (const id of [firstReplica, reopenedReplica])
      authority.registerReplica({
        id,
        name: "Phone",
        mode: "read_write",
        allowedTypes: ["task"],
      });
    const envelope = <T>(result: T) => ({
      valid: true as const,
      result,
      diagnostics: [],
    });
    const providerDocument = {
      id: "work",
      name: "Work",
      source: {
        path: "Views/work.md",
        format: "mdbase.view",
        revision: "view-r1",
        writable: true,
      },
      views: [{ id: "open", name: "Open work" }],
    };
    const operations = {
      listViews: vi.fn(async () =>
        envelope({
          views: [providerDocument],
          meta: { total_count: 1 },
        }),
      ),
      executeView: vi.fn(async () =>
        envelope({
          results: [],
          meta: {
            total_count: 0,
            has_more: false,
            view: { path: "Views/work.md", id: "open" },
            groups: [],
          },
        }),
      ),
    };
    const first = new CloudTaskRepository(
      connect(
        authority.collectionId,
        firstReplica,
        authority.transport(firstReplica),
        operations,
      ),
    );
    await first.initialize();
    const [document] = await first.listViews();
    const execution = await first.executeView(document.views[0]);

    const reopened = new CloudTaskRepository(
      connect(
        authority.collectionId,
        reopenedReplica,
        authority.transport(reopenedReplica),
        {
          listViews: vi.fn(async () => {
            throw new Error("Still refreshing");
          }),
          executeView: vi.fn(async () => {
            throw new Error("Still refreshing");
          }),
        },
      ),
    );
    await reopened.initialize();

    expect((await reopened.cachedViews())[0].views[0].name).toBe("Open work");
    expect(await reopened.cachedViewExecution(document.views[0])).toEqual(
      execution,
    );
    expect((await reopened.collectionInfo()).id).toBe(authority.collectionId);
  });

  it("writes saved-view sources without serial catalogue reloads", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resources(),
    });
    const replicaId = crypto.randomUUID();
    authority.registerReplica({
      id: replicaId,
      name: "Phone",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    const document = {
      path: "Views/focused.md",
      format: "mdbase.view" as const,
      revision: "view-r1",
      document: "---\ntype: view\nname: Focused\n---\n",
    };
    const envelope = <T>(result: T) => ({
      valid: true as const,
      result,
      diagnostics: [],
    });
    const listViews = vi.fn(async () =>
      envelope({ views: [], meta: { total_count: 0 } }),
    );
    const readViewSource = vi.fn(async () => envelope(document));
    const createViewSource = vi.fn(async () => envelope(document));
    const updateViewSource = vi.fn(async () =>
      envelope({ ...document, revision: "view-r2" }),
    );
    const deleteViewSource = vi.fn(async () =>
      envelope({ path: document.path, deleted: true }),
    );
    const repository = new CloudTaskRepository(
      connect(
        authority.collectionId,
        replicaId,
        authority.transport(replicaId),
        {
          listViews,
          readViewSource,
          createViewSource,
          updateViewSource,
          deleteViewSource,
        },
      ),
    );
    await repository.initialize();

    expect(await repository.readViewSource(document.path)).toEqual(document);
    await repository.createViewSource({
      format: "mdbase.view",
      name: "Focused",
      document: document.document,
    });
    const updated = await repository.updateViewSource({
      path: document.path,
      document: document.document,
      ifRevision: document.revision,
    });
    await repository.deleteViewSource(updated.path, updated.revision);

    expect(updateViewSource).toHaveBeenCalledWith(
      expect.objectContaining({ if_revision: "view-r1" }),
    );
    expect(deleteViewSource).toHaveBeenCalledWith({
      path: document.path,
      if_revision: "view-r2",
    });
    expect(listViews).not.toHaveBeenCalled();
  });

  it("keeps local mutations immediate, synchronizes devices, and survives an outage", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resources(),
    });
    const phoneId = crypto.randomUUID();
    const tabletId = crypto.randomUUID();
    authority.registerReplica({
      id: phoneId,
      name: "Phone",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    authority.registerReplica({
      id: tabletId,
      name: "Tablet",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    let online = true;
    const upstream = authority.transport(phoneId);
    const phoneTransport: SyncTransport<JsonObject> = {
      openSession: () => network(() => upstream.openSession()),
      snapshot: (snapshot, page) =>
        network(() => upstream.snapshot(snapshot, page)),
      changes: (after, limit) => network(() => upstream.changes(after, limit)),
      mutate: (mutation) => network(() => upstream.mutate(mutation)),
    };
    const phone = new CloudTaskRepository(
      connect(authority.collectionId, phoneId, phoneTransport),
    );
    const tablet = new CloudTaskRepository(
      connect(authority.collectionId, tabletId, authority.transport(tabletId)),
    );
    await Promise.all([phone.initialize(), tablet.initialize()]);

    const created = await phone.create({
      title: "Plan hosted release",
      tags: ["task", "release"],
      contexts: ["computer"],
      projects: ["mdbase"],
    });
    expect((await phone.get(created.id))?.title).toBe("Plan hosted release");
    await phone.refresh();
    await tablet.refresh();
    expect((await tablet.get(created.id))?.projects).toEqual(["mdbase"]);

    online = false;
    await phone.update(created.id, { title: "Plan cloud release" });
    expect((await phone.get(created.id))?.title).toBe("Plan cloud release");
    await phone.refresh();
    expect(await phone.syncStatus()).toMatchObject({
      state: "offline",
      pending: 1,
    });

    online = true;
    await phone.refresh();
    await tablet.refresh();
    expect((await tablet.get(created.id))?.title).toBe("Plan cloud release");

    function network<T>(operation: () => Promise<T>): Promise<T> {
      return online
        ? operation()
        : Promise.reject(new SyncError("offline", "Network unavailable."));
    }
  });

  it("uses TaskNotes recurring-instance completion semantics", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resources(),
    });
    const replicaId = crypto.randomUUID();
    authority.registerReplica({
      id: replicaId,
      name: "Phone",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    const repository = new CloudTaskRepository(
      connect(
        authority.collectionId,
        replicaId,
        authority.transport(replicaId),
      ),
    );
    await repository.initialize();
    const date = todayString();
    const task = await repository.create({
      title: "Weekly review",
      scheduled: date,
      recurrence: "FREQ=WEEKLY;INTERVAL=1",
    });
    const completed = await repository.toggle(task.id);
    expect(completed.status).toBe("open");
    expect(completed.completeInstances).toContain(date);
    expect(completed.scheduled).not.toBe(date);
  });

  it("keeps time tracking immediate offline and synchronizes it later", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resources(),
    });
    const phoneId = crypto.randomUUID();
    const tabletId = crypto.randomUUID();
    authority.registerReplica({
      id: phoneId,
      name: "Phone",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    authority.registerReplica({
      id: tabletId,
      name: "Tablet",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    let online = true;
    const upstream = authority.transport(phoneId);
    const phoneTransport: SyncTransport<JsonObject> = {
      openSession: () => network(() => upstream.openSession()),
      snapshot: (snapshot, page) =>
        network(() => upstream.snapshot(snapshot, page)),
      changes: (after, limit) => network(() => upstream.changes(after, limit)),
      mutate: (mutation) => network(() => upstream.mutate(mutation)),
    };
    const phone = new CloudTaskRepository(
      connect(authority.collectionId, phoneId, phoneTransport),
    );
    const tablet = new CloudTaskRepository(
      connect(authority.collectionId, tabletId, authority.transport(tabletId)),
    );
    await Promise.all([phone.initialize(), tablet.initialize()]);
    const task = await phone.create({ title: "Offline timing" });
    await phone.refresh();
    await tablet.refresh();

    online = false;
    const started = await phone.startTimeTracking(task.id, "Flight mode");
    expect(started.timeEntries[0].endTime).toBeUndefined();
    await phone.refresh();
    expect(await phone.syncStatus()).toMatchObject({
      state: "offline",
      pending: 1,
    });

    online = true;
    await phone.refresh();
    await tablet.refresh();
    expect((await tablet.get(task.id))?.timeEntries[0]).toMatchObject({
      description: "Flight mode",
    });

    function network<T>(operation: () => Promise<T>): Promise<T> {
      return online
        ? operation()
        : Promise.reject(new SyncError("offline", "Network unavailable."));
    }
  });

  it("serializes same-task cloud mutations without dropping local state", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resources(),
    });
    const replicaId = crypto.randomUUID();
    authority.registerReplica({
      id: replicaId,
      name: "Phone",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    const repository = new CloudTaskRepository(
      connect(
        authority.collectionId,
        replicaId,
        authority.transport(replicaId),
      ),
    );
    await repository.initialize();
    const task = await repository.create({ title: "Original" });

    await Promise.all([
      repository.update(task.id, { title: "Edited while starting" }),
      repository.startTimeTracking(task.id, "Concurrent timer"),
    ]);

    expect(await repository.get(task.id)).toMatchObject({
      title: "Edited while starting",
      timeEntries: [{ description: "Concurrent timer" }],
    });
    await repository.refresh();
    expect(await repository.get(task.id)).toMatchObject({
      title: "Edited while starting",
      timeEntries: [{ description: "Concurrent timer" }],
    });
  });

  it("queues archive state and file movement together while offline", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resourcesWithArchive(),
    });
    const phoneId = crypto.randomUUID();
    const tabletId = crypto.randomUUID();
    authority.registerReplica({
      id: phoneId,
      name: "Phone",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    authority.registerReplica({
      id: tabletId,
      name: "Tablet",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    let online = true;
    const upstream = authority.transport(phoneId);
    const phoneTransport: SyncTransport<JsonObject> = {
      openSession: () => network(() => upstream.openSession()),
      snapshot: (snapshot, page) =>
        network(() => upstream.snapshot(snapshot, page)),
      changes: (after, limit) => network(() => upstream.changes(after, limit)),
      mutate: (mutation) => network(() => upstream.mutate(mutation)),
    };
    const phone = new CloudTaskRepository(
      connect(authority.collectionId, phoneId, phoneTransport),
    );
    const tablet = new CloudTaskRepository(
      connect(authority.collectionId, tabletId, authority.transport(tabletId)),
    );
    await Promise.all([phone.initialize(), tablet.initialize()]);
    const task = await phone.create({ title: "Cloud archive" });
    await phone.refresh();
    await tablet.refresh();
    online = false;

    const archived = await phone.setArchived(task.id, true);
    expect(archived).toMatchObject({
      archived: true,
      path: task.path.replace(/^tasks\//, "TaskNotes/Archive/"),
    });
    expect(await phone.list({ status: "all" })).toEqual([]);
    await phone.refresh();
    expect(await phone.syncStatus()).toMatchObject({ pending: 2 });

    online = true;
    await phone.refresh();
    await tablet.refresh();
    expect(await tablet.get(task.id)).toMatchObject({
      archived: true,
      path: task.path.replace(/^tasks\//, "TaskNotes/Archive/"),
    });

    function network<T>(operation: () => Promise<T>): Promise<T> {
      return online
        ? operation()
        : Promise.reject(new SyncError("offline", "Network unavailable."));
    }
  });

  it("synchronizes materialized occurrence identity and parent state across devices", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resources(),
    });
    const phoneId = crypto.randomUUID();
    const tabletId = crypto.randomUUID();
    for (const [id, name] of [
      [phoneId, "Phone"],
      [tabletId, "Tablet"],
    ] as const)
      authority.registerReplica({
        id,
        name,
        mode: "read_write",
        allowedTypes: ["task"],
      });
    const phone = new CloudTaskRepository(
      connect(authority.collectionId, phoneId, authority.transport(phoneId)),
    );
    const tablet = new CloudTaskRepository(
      connect(authority.collectionId, tabletId, authority.transport(tabletId)),
    );
    await Promise.all([phone.initialize(), tablet.initialize()]);
    const parent = await phone.create({
      title: "Cloud daily review",
      scheduled: "2026-08-05",
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
    });
    await phone.refresh();
    await tablet.refresh();

    const occurrence = await phone.materializeOccurrence(
      parent.id,
      "2026-08-05",
    );
    await phone.refresh();
    await tablet.refresh();
    expect(await tablet.get(occurrence.task.id)).toMatchObject({
      occurrenceDate: "2026-08-05",
      recurrenceParent: `[[${parent.path.replace(/\.md$/, "")}]]`,
    });

    await tablet.toggle(occurrence.task.id);
    await tablet.refresh();
    await phone.refresh();
    expect(await phone.get(occurrence.task.id)).toMatchObject({
      completed: true,
    });
    expect((await phone.get(parent.id))?.completeInstances).toContain(
      "2026-08-05",
    );
  });

  it("publishes a finite rolling window in the same cloud refresh", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resources(),
    });
    const phoneId = crypto.randomUUID();
    const tabletId = crypto.randomUUID();
    for (const [id, name] of [
      [phoneId, "Phone"],
      [tabletId, "Tablet"],
    ] as const)
      authority.registerReplica({
        id,
        name,
        mode: "read_write",
        allowedTypes: ["task"],
      });
    const phone = new CloudTaskRepository(
      connect(authority.collectionId, phoneId, authority.transport(phoneId)),
    );
    const tablet = new CloudTaskRepository(
      connect(authority.collectionId, tabletId, authority.transport(tabletId)),
    );
    await Promise.all([phone.initialize(), tablet.initialize()]);
    const today = todayString();
    await phone.create({
      title: "Cloud rolling window",
      scheduled: today,
      recurrence: `FREQ=DAILY;INTERVAL=1;DTSTART=${today.replaceAll("-", "")}`,
      occurrenceMaterialization: "rolling",
      occurrencePastHorizon: "P0D",
      occurrenceFutureHorizon: "P2D",
    });

    await phone.refresh();
    await tablet.refresh();
    expect(
      (await tablet.list({ status: "all", limit: 100 })).filter(
        (task) => task.recurrenceParent && task.occurrenceDate,
      ),
    ).toHaveLength(3);
    expect(await phone.syncStatus()).toMatchObject({ pending: 0 });
  });

  it("uses the contract's type name and records folder", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resourcesWithType("todo", "records/tasks"),
    });
    const replicaId = crypto.randomUUID();
    authority.registerReplica({
      id: replicaId,
      name: "Phone",
      mode: "read_write",
      allowedTypes: ["todo"],
    });
    const repository = new CloudTaskRepository(
      connect(
        authority.collectionId,
        replicaId,
        authority.transport(replicaId),
      ),
    );
    await repository.initialize();
    const task = await repository.create({ title: "Portable contract" });
    expect(task.path).toMatch(/^records\/tasks\//);
    expect(task.frontmatter.type).toBe("todo");
    await repository.refresh();
    expect(await repository.get(task.id)).toMatchObject({
      title: "Portable contract",
    });
  });

  it("reloads canonical resources after the authority changes them", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resources(),
    });
    const replicaId = crypto.randomUUID();
    authority.registerReplica({
      id: replicaId,
      name: "Phone",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    const repository = new CloudTaskRepository(
      connect(
        authority.collectionId,
        replicaId,
        authority.transport(replicaId),
      ),
    );
    await repository.initialize();

    (authority as unknown as { resources: SyncCollectionResources }).resources =
      resourcesWithType("todo", "canonical/cloud");
    authority.updateReplicaScope(replicaId, ["todo"]);
    await repository.refresh();

    const created = await repository.create({ title: "New cloud contract" });
    expect(created.frontmatter.type).toBe("todo");
    expect(created.path).toMatch(/^canonical\/cloud\//);
  });

  it("creates from a raw template resource while offline", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resourcesWithTemplate(),
    });
    const replicaId = crypto.randomUUID();
    authority.registerReplica({
      id: replicaId,
      name: "Phone",
      mode: "read_write",
      allowedTypes: ["task"],
    });
    let online = true;
    const upstream = authority.transport(replicaId);
    const transport: SyncTransport<JsonObject> = {
      openSession: () => network(() => upstream.openSession()),
      snapshot: (snapshot, page) =>
        network(() => upstream.snapshot(snapshot, page)),
      changes: (after, limit) => network(() => upstream.changes(after, limit)),
      mutate: (mutation) => network(() => upstream.mutate(mutation)),
    };
    const repository = new CloudTaskRepository(
      connect(authority.collectionId, replicaId, transport),
    );
    await repository.initialize();
    online = false;

    const task = await repository.create({
      title: "Offline template",
      status: "open",
    });
    expect(task.status).toBe("open");
    expect(task.frontmatter.source).toBe("cloud-template");
    expect(task.body).toMatch(
      /^Cloud body for Offline template on \d{4}-\d{2}-\d{2}$/,
    );

    function network<T>(operation: () => Promise<T>): Promise<T> {
      return online
        ? operation()
        : Promise.reject(new SyncError("offline", "Network unavailable."));
    }
  });

  it("surfaces conflicts and can keep the local edit", async () => {
    const authority = new MemoryAuthority<JsonObject>({
      resources: resources(),
    });
    const phoneId = crypto.randomUUID();
    const laptopId = crypto.randomUUID();
    for (const [id, name] of [
      [phoneId, "Phone"],
      [laptopId, "Laptop"],
    ] as const)
      authority.registerReplica({
        id,
        name,
        mode: "read_write",
        allowedTypes: ["task"],
      });
    let phoneOnline = true;
    const upstream = authority.transport(phoneId);
    const phoneTransport: SyncTransport<JsonObject> = {
      openSession: () => network(() => upstream.openSession()),
      snapshot: (snapshot, page) =>
        network(() => upstream.snapshot(snapshot, page)),
      changes: (after, limit) => network(() => upstream.changes(after, limit)),
      mutate: (mutation) => network(() => upstream.mutate(mutation)),
    };
    const phone = new CloudTaskRepository(
      connect(authority.collectionId, phoneId, phoneTransport),
    );
    const laptop = new CloudTaskRepository(
      connect(authority.collectionId, laptopId, authority.transport(laptopId)),
    );
    await Promise.all([phone.initialize(), laptop.initialize()]);
    const task = await phone.create({ title: "Original" });
    await phone.refresh();
    await laptop.refresh();

    phoneOnline = false;
    await phone.update(task.id, { title: "Phone edit" });
    await laptop.update(task.id, { title: "Laptop edit" });
    await laptop.refresh();
    phoneOnline = true;
    await phone.refresh();

    expect(await phone.syncStatus()).toMatchObject({
      state: "issues",
      issues: 1,
    });
    const [issue] = await phone.syncIssues();
    expect(issue).toMatchObject({ title: "Phone edit", canKeepLocal: true });
    await phone.resolveSyncIssue(issue.id, "local");
    await phone.refresh();
    await laptop.refresh();
    expect((await laptop.get(task.id))?.title).toBe("Phone edit");

    function network<T>(operation: () => Promise<T>): Promise<T> {
      return phoneOnline
        ? operation()
        : Promise.reject(new SyncError("offline", "Network unavailable."));
    }
  });
});
