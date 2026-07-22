import type { MdbaseConnect } from "@mdbase/connect";
import type {
  JsonObject,
  SyncCollectionResources,
} from "@mdbase/connect-protocol";
import {
  MemoryHostedAuthority,
  SyncError,
  type SyncTransport,
} from "@mdbase/connect-sync";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { describe, expect, it } from "vitest";

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

function connect(
  collectionId: string,
  replicaId: string,
  transport: SyncTransport<JsonObject>,
): MdbaseConnect<JsonObject> {
  return {
    hostedSync: () => ({ collectionId, replicaId, transport }),
  } as unknown as MdbaseConnect<JsonObject>;
}

describe("cloud task repository", () => {
  it("keeps local mutations immediate, synchronizes devices, and survives an outage", async () => {
    const authority = new MemoryHostedAuthority<JsonObject>({
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
    const authority = new MemoryHostedAuthority<JsonObject>({
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
    const authority = new MemoryHostedAuthority<JsonObject>({
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
    const authority = new MemoryHostedAuthority<JsonObject>({
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

  it("uses the contract's type name and records folder", async () => {
    const authority = new MemoryHostedAuthority<JsonObject>({
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

  it("surfaces conflicts and can keep the local edit", async () => {
    const authority = new MemoryHostedAuthority<JsonObject>({
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
