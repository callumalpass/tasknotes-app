/**
 * Claims 2-6: what the contract view gives for awkward but real records,
 * against what the app's current path (raw record + TaskNotes model) builds,
 * and what contract writes accept.
 *
 *   pnpm exec vitest run --config scripts/spikes/contract-view/vitest.config.ts fidelity
 */
import { toPlain } from "@mdbase-dev/sdk";
import { test } from "vitest";
import { nextTaskCatalog } from "../../../src/storage/next-task-catalog";
import {
  nextTaskDocument,
  nextTaskSummary,
} from "../../../src/storage/next-task-records";
import { openReplica, seed, show, type SeedRecord } from "./harness";

const base = {
  status: "open",
  priority: "normal",
  tags: ["task"],
  dateCreated: "2026-01-01T00:00:00.000Z",
};

/** [label, record] pairs: each isolates one normalisation the model performs. */
const CASES: Array<[string, SeedRecord]> = [
  [
    "plain",
    {
      path: "tasks/plain.md",
      frontmatter: { ...base, title: "Plain" },
      body: "Body text",
    },
  ],
  [
    "custom + unknown keys",
    {
      path: "tasks/custom.md",
      frontmatter: {
        ...base,
        title: "Custom",
        effort: 3,
        client_ref: "ACME-1",
      },
    },
  ],
  [
    "archived tag",
    {
      path: "tasks/archived.md",
      frontmatter: { ...base, title: "Archived", tags: ["task", "archived"] },
    },
  ],
  [
    "title in filename",
    { path: "tasks/Buy milk.md", frontmatter: { ...base } },
  ],
  [
    "status/priority by label",
    {
      path: "tasks/label.md",
      frontmatter: {
        ...base,
        title: "Label",
        status: "In progress",
        priority: "High",
      },
    },
  ],
  [
    "status/priority by case",
    {
      path: "tasks/case.md",
      frontmatter: {
        ...base,
        title: "Case",
        status: "DONE",
        priority: "HIGH",
        completedDate: "2026-01-03",
      },
    },
  ],
  [
    "unknown status",
    {
      path: "tasks/unknown.md",
      frontmatter: { ...base, title: "Unknown", status: "waiting" },
    },
  ],
  [
    "messy tags",
    {
      path: "tasks/tags.md",
      frontmatter: {
        ...base,
        title: "Tags",
        tags: ["task", "#home", " work ", "Home"],
      },
    },
  ],
  [
    "blockedBy wikilink strings",
    {
      path: "tasks/blocked.md",
      frontmatter: { ...base, title: "Blocked", blockedBy: ["[[Other task]]"] },
    },
  ],
  [
    "single strings for lists",
    {
      path: "tasks/single.md",
      frontmatter: {
        ...base,
        title: "Single",
        contexts: "@home",
        projects: "[[Project A]]",
      },
    },
  ],
  [
    "numeric strings",
    {
      path: "tasks/numeric.md",
      frontmatter: { ...base, title: "Numeric", timeEstimate: "30" },
    },
  ],
  [
    "legacy aliases",
    {
      path: "tasks/legacy.md",
      frontmatter: {
        status: "done",
        priority: "normal",
        tags: ["task"],
        title: "Legacy",
        date_created: "2025-05-05T00:00:00.000Z",
        completed_date: "2025-05-06",
        time_estimate: 45,
        blocked_by: [{ uid: "[[Other task]]", reltype: "FINISHTOSTART" }],
      },
    },
  ],
  [
    "recurrence_original_date",
    {
      path: "tasks/occurrence.md",
      frontmatter: {
        ...base,
        title: "Occurrence",
        recurrence_original_date: "2026-02-02",
      },
    },
  ],
  [
    "no dateCreated",
    {
      path: "tasks/nodate.md",
      frontmatter: { status: "open", tags: ["task"], title: "No date" },
    },
  ],
  [
    "untyped, tag only",
    {
      path: "tasks/untyped.md",
      typed: false,
      frontmatter: { ...base, title: "Untyped" },
    },
  ],
];

const COMPARE = [
  "title",
  "status",
  "completed",
  "priority",
  "tags",
  "contexts",
  "projects",
  "blockedBy",
  "timeEstimate",
  "createdAt",
  "completedDate",
  "archived",
  "customProperties",
  "body",
] as const;

const plain = (v: unknown) =>
  v instanceof Map || Array.isArray(v) || (v && typeof v === "object")
    ? JSON.parse(show(v))
    : v;

test("contract view versus the app's model, and contract writes", async () => {
  // One configured custom field, as a user would add in Settings.
  const r = await openReplica({
    modelConfig: {
      userFields: [
        { id: "effort", displayName: "Effort", key: "effort", type: "number" },
      ],
    } as never,
  });
  const ids = await seed(
    r.client,
    CASES.map(([, rec]) => rec),
    1,
  );
  // Core's type fills dateCreated on create; remove it afterwards to get a
  // record that really lacks it, as a hand-edited file would.
  const noDate = ids[CASES.findIndex(([label]) => label === "no dateCreated")]!;
  await r.client.update(noDate, { unset: ["dateCreated"] });
  const signal = new AbortController().signal;
  const { providers } = await nextTaskCatalog(r.client, signal);
  const models = new Map(providers.map((p) => [p.typeName, p.model]));

  // Contract pages small enough to pass the budget (see budget.spike.ts).
  const contract = new Map<
    string,
    { fields: Record<string, unknown>; issues: unknown[]; type: string }[]
  >();
  let cursor: string | undefined;
  let pageJson = 0;
  let contractJson = 0;
  do {
    const q = await r.client.queryContract(r.contract, { pageSize: 4, cursor });
    pageJson += show(q.page.records).length;
    contractJson += show(q.records).length;
    for (const rec of q.records)
      contract.set(
        rec.id,
        rec.implementations.map((i) => ({
          type: i.typeName,
          fields: plain(i.fields),
          issues: plain(i.issues),
        })),
      );
    cursor = q.page.cursor;
  } while (cursor);

  const report: Record<string, unknown> = {};
  for (const [k, [label]] of CASES.entries()) {
    const id = ids[k]!;
    const record = await r.client.get(id, {
      body: true,
      effective: true,
    } as never);
    let app: Record<string, unknown> | string;
    try {
      const task = nextTaskDocument(record, models);
      app = task
        ? Object.fromEntries(COMPARE.map((f) => [f, (task as never)[f]]))
        : "not a task to the app";
    } catch (e) {
      app = `app read threw: ${(e as Error).message}`;
    }
    let summary: string;
    try {
      summary = nextTaskSummary(record, models) ? "ok" : "not a task";
    } catch (e) {
      summary = `threw: ${(e as Error).message}`;
    }
    let single: string;
    try {
      const v = await r.client.getContract(id, r.contract);
      single = `ok (${Object.keys(plain(v.fields)).length} fields)`;
    } catch (e) {
      single = `${(e as { code?: string }).code}/${(e as { reason?: string }).reason}`;
    }
    report[label] = {
      stored: plain(
        Object.fromEntries(
          [...record.frontmatter].map(([key, v]) => [key, toPlain(v)]),
        ),
      ),
      types: record.types,
      app,
      appSummary: summary,
      contract: contract.get(id) ?? "absent from queryContract",
      getContract: single,
    };
  }
  console.log(JSON.stringify(report, null, 1));
  console.log(
    show({
      claim5_pageRecordsJsonBytes: pageJson,
      claim5_contractRecordsJsonBytes: contractJson,
    }),
  );

  // Claim 6: contract writes.
  const target = ids[0]!;
  const attempts: Array<[string, () => Promise<unknown>]> = [
    [
      "update patch mapped field",
      () =>
        r.client.update(target, {
          contract: r.contract,
          patch: { priority: "high" },
        }),
    ],
    [
      "update unset mapped field",
      () =>
        r.client.update(target, { contract: r.contract, unset: ["priority"] }),
    ],
    [
      "update patch unmapped field",
      () =>
        r.client.update(target, { contract: r.contract, patch: { effort: 5 } }),
    ],
    [
      "update patch record-name field (recurrence_anchor)",
      () =>
        r.client.update(target, {
          contract: r.contract,
          patch: { recurrence_anchor: "completion" },
        }),
    ],
    [
      "update add to tags",
      () =>
        r.client.update(target, { contract: r.contract, add: { tags: ["x"] } }),
    ],
    [
      "update body",
      () => r.client.update(target, { contract: r.contract, body: "New body" }),
    ],
    [
      "update patch + plain field in one call",
      () =>
        r.client.update(target, {
          contract: r.contract,
          patch: { priority: "low", effort: 1 },
        }),
    ],
    [
      "create with mapped fields",
      () =>
        r.client.create({
          contract: r.contract,
          path: "tasks/c1.md",
          frontmatter: {
            title: "C1",
            status: "open",
            dateCreated: "2026-01-01T00:00:00.000Z",
            tags: ["task"],
          },
        }),
    ],
    [
      "create with custom field",
      () =>
        r.client.create({
          contract: r.contract,
          path: "tasks/c2.md",
          frontmatter: {
            title: "C2",
            status: "open",
            dateCreated: "2026-01-01T00:00:00.000Z",
            effort: 2,
          },
        }),
    ],
    [
      "create with invalid status",
      () =>
        r.client.create({
          contract: r.contract,
          path: "tasks/c3.md",
          frontmatter: {
            title: "C3",
            status: "waiting",
            dateCreated: "2026-01-01T00:00:00.000Z",
          },
        }),
    ],
    [
      "create with body",
      () =>
        r.client.create({
          contract: r.contract,
          path: "tasks/c4.md",
          frontmatter: {
            title: "C4",
            status: "open",
            dateCreated: "2026-01-01T00:00:00.000Z",
          },
          body: "hello",
        }),
    ],
  ];
  const writes: Record<string, string> = {};
  for (const [label, run] of attempts) {
    try {
      const w = (await run()) as {
        receipt?: {
          status?: string;
          records?: Array<{ frontmatter: unknown }>;
        };
      };
      const rec = w.receipt?.records?.[0];
      writes[label] =
        `${w.receipt?.status}: ${rec ? show(rec.frontmatter) : ""}`;
    } catch (e) {
      writes[label] =
        `refused ${(e as { code?: string }).code}/${(e as { reason?: string }).reason}: ${(e as Error).message}`;
    }
  }
  console.log(JSON.stringify(writes, null, 1));
  await r.close();
});
