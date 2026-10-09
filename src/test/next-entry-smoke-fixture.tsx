import { useEffect, useRef } from "react";
import {
  connect,
  MdbaseError,
  toPlain,
  toValue,
  type PlainValue,
  type wire,
} from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import {
  buildTaskNotesMdbaseResources,
  TASKNOTES_CONTRACT_DIGEST,
} from "@tasknotes/model/mdbase";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import type { AppBasesDescriptor } from "@mdbase-dev/sdk/app-host";
import type { TaskRepository } from "../application/ports/task-repository";
import { NextTaskRepository } from "../storage/next-repository";
import { NextCollectionGate } from "../app/next-collection-gate";
import type { NextInstallationBuildInput } from "../cloud/next-installation-protocol";

export interface NextSmokeInput {
  records: Array<{
    id?: string;
    path: string;
    frontmatter: Record<string, PlainValue>;
    body: string;
    types?: string[];
  }>;
  typeDefinition?: unknown;
  slowConfirmation?: boolean;
}
export interface NextSmokeControl {
  offline: boolean;
  holdRead: string | null;
  reads: Record<string, number>;
  operations: string[];
  updates: Array<{
    patch: Record<string, PlainValue>;
    unset: string[];
    body?: string;
    ifRevision?: string;
  }>;
  confirm(): void;
  releaseReads(): void;
  records(): Array<{
    id: string;
    path: string;
    frontmatter: Record<string, PlainValue>;
    body: string;
  }>;
}
declare global {
  interface Window {
    __TASKNOTES_NEXT_SMOKE__?: NextSmokeInput;
    __TASKNOTES_NEXT_SMOKE_CONTROL__?: NextSmokeControl;
  }
}
const account = "11111111-1111-4111-8111-111111111111";
const collection = "22222222-2222-4222-8222-222222222222";
const revision = "sha256:" + "ab".repeat(32);
const clock = { instant: 1, tz: "UTC", localDate: "1970-01-01" };
const names = ["Today", "Upcoming", "Calendar", "Projects", "Archive"];
const views: AppBasesDescriptor[] = names.map((name, i) => ({
  record: `33333333-3333-4333-8333-${String(i + 1).padStart(12, "0")}`,
  path: `TaskNotes/Views/${name.toLowerCase()}.base`,
  sourceRevision: revision,
  ordinal: 0,
  name,
  viewType: "tasknotesTaskList",
  implementations: [],
}));

/** Local browser protocol stand-in, not native Core/auth/grant/READ evidence.
 * One original SDK client supplies CRUD and the synthetic Bases/catalog seam.
 * This module is reachable ONLY in the explicit e2e build on a loopback origin.
 */
async function heldFixture(input: NextSmokeInput): Promise<TaskRepository> {
  const replica = new MemoryReplica({
    collection,
    confirmDelayMs: input.slowConfirmation ? null : 0,
  });
  const generated = buildTaskNotesMdbaseResources({ profiles: ["core-lite"] });
  const type = (input.typeDefinition ?? generated.type) as {
    implements: Array<{
      contract: string;
      version: string;
      fields: Record<string, string>;
      binding: PlainValue;
    }>;
  };
  replica.seedResource(
    "_types/task.md",
    serializeMarkdownDocument(type, "Synthetic task type"),
  );
  for (const record of input.records)
    replica.seed({
      ...record,
      types: record.types ?? ["task"],
      frontmatter: Object.fromEntries(
        Object.entries(record.frontmatter).map(([k, v]) => [k, toValue(v)]),
      ),
    });
  const client = await connect({
    connector: replica.connector(),
    app: { name: "tasknotes-next-smoke", version: "fixture" },
    reconnect: false,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const control: NextSmokeControl = {
    offline: false,
    holdRead: null,
    reads: {},
    operations: [],
    updates: [],
    confirm: () => replica.confirmAll(),
    releaseReads: release,
    records: () =>
      replica.allRecords.map((r) => ({
        id: r.id,
        path: r.path,
        frontmatter: Object.fromEntries(
          [...r.frontmatter].map(([k, v]) => [k, toPlain(v)]),
        ),
        body: r.body,
      })),
  };
  window.__TASKNOTES_NEXT_SMOKE_CONTROL__ = control;
  const available = () => {
    if (control.offline)
      throw new MdbaseError({
        code: "unavailable",
        recovery: "retry",
        message: "Synthetic collection unavailable.",
      });
  };
  client.describe = async (signal) => {
    available();
    control.operations.push("describe");
    const resource = await client.resources.get("_types/task.md", signal);
    const definition = parseFrontmatter(resource.text!)
      .frontmatter as unknown as typeof type;
    const impl = definition.implements.find(
      (i) => i.contract === "tasknotes.task",
    )!;
    const result: wire.DescribeResult = {
      specVersion: "0.3.0",
      inclusion: { include: [] },
      issues: [],
      settings: new Map(),
      types: [
        {
          name: "task",
          path: "_types/task.md",
          implements: [
            {
              contract: "tasknotes.task",
              version: TASKNOTES_SPEC_VERSION,
              fields: new Map(Object.entries(impl.fields)),
              binding: toValue(impl.binding),
            },
          ],
        },
      ],
      contracts: [
        {
          id: "tasknotes.task",
          version: TASKNOTES_SPEC_VERSION,
          path: "_contracts/tasknotes.task.md",
          digest: TASKNOTES_CONTRACT_DIGEST,
          contractType: "record",
          implementedBy: ["task"],
        },
      ],
    };
    return result;
  };
  const query = client.query.bind(client);
  client.query = async (...args) => {
    available();
    control.operations.push("query");
    return query(...args);
  };
  const get = client.get.bind(client);
  client.get = async (...args) => {
    available();
    const target = args[0];
    const id =
      typeof target === "string"
        ? target
        : "id" in target
          ? target.id
          : target.path;
    control.reads[id] = (control.reads[id] ?? 0) + 1;
    if (control.holdRead === id) await gate;
    return get(...args);
  };
  const update = client.update.bind(client);
  client.update = async (...args) => {
    control.updates.push({
      patch: Object.fromEntries(
        (args[1].patch instanceof Map
          ? [...args[1].patch]
          : Object.entries(args[1].patch ?? {})
        ).filter(
          (entry): entry is [string, PlainValue] => entry[1] !== undefined,
        ),
      ),
      unset: args[1].unset ?? [],
      ...(args[1].body !== undefined ? { body: args[1].body } : {}),
      ...(args[1].ifRevision ? { ifRevision: args[1].ifRevision } : {}),
    });
    return update(...args);
  };
  const submit = client.submit.bind(client);
  client.submit = async (...args) => {
    available();
    control.operations.push(...args[0].map((op) => op.kind));
    return submit(...args);
  };
  client.listAppBasesViews = async () => {
    available();
    control.operations.push("bases-discovery");
    return {
      kind: "success",
      views,
      clock,
      collectionRevision: revision,
      continuation: null,
    };
  };
  client.readAppBasesViewSource = async (selection) => {
    available();
    const view = views.find(
      (v) =>
        v.record === selection.record &&
        v.ordinal === selection.ordinal &&
        v.sourceRevision === selection.sourceRevision,
    );
    if (!view) throw Error("Unknown synthetic source identity.");
    return {
      kind: "success",
      view,
      clock,
      collectionRevision: revision,
      source: `views:\n  - name: ${view.name}\n    type: tasknotesTaskList\n`,
    };
  };
  client.executeAppBases = async (selection) => {
    available();
    const view = views.find(
      (v) =>
        v.record === selection.record &&
        v.ordinal === selection.ordinal &&
        v.sourceRevision === selection.sourceRevision,
    );
    if (!view) throw Error("Unknown synthetic source identity.");
    const impl = type.implements.find((i) => i.contract === "tasknotes.task")!;
    const records = await query(
      { types: ["task"], limit: 1000 },
      { body: true },
    );
    return {
      kind: "success",
      view,
      columns: ["note.title"],
      unavailableColumns: [],
      clock,
      collectionRevision: revision,
      groups: [],
      rows: records.records.map((r) => ({
        record: r.id,
        path: r.path,
        sourceRevision: r.revision,
        cells: [
          {
            kind: "text" as const,
            value: String(
              toPlain(
                r.frontmatter.get(impl.fields.title ?? "title") ?? null,
              ) ?? "",
            ),
          },
        ],
      })),
    };
  };
  return new NextTaskRepository(client, "Synced SDK fixture", account);
}
const fixtureBuild = async (): Promise<NextInstallationBuildInput> =>
  ({ environment: "lab" }) as NextInstallationBuildInput;
function FixtureInstallation({
  onCollection,
}: {
  onCollection(repository: TaskRepository): Promise<void>;
}) {
  const held = useRef<Promise<TaskRepository> | null>(null);
  useEffect(
    () => () => {
      if (held.current) void held.current.then((repo) => repo.dispose?.());
    },
    [],
  );
  return (
    <main className="opening-screen">
      <h1>Open TaskNotes</h1>
      <p>Local SDK protocol fixture; not native authorization or readiness.</p>
      <button
        onClick={() => {
          held.current ??= heldFixture(window.__TASKNOTES_NEXT_SMOKE__!);
          void held.current.then(onCollection);
        }}
      >
        Open synced fixture collection
      </button>
    </main>
  );
}
export function NextEntrySmokeFixture() {
  if (
    import.meta.env.MODE !== "e2e" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) ||
    !window.__TASKNOTES_NEXT_SMOKE__
  )
    throw Error("Smoke fixtures require the explicit local e2e build.");
  return (
    <NextCollectionGate
      loadBuild={fixtureBuild}
      InstallationScreen={FixtureInstallation}
    />
  );
}
