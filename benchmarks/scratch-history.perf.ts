import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, it, vi } from "vitest";
import { SCRATCHPAD_TYPE } from "../src/domain/scratchpad";
import { SCRATCH_IMAGE_TYPE } from "../src/domain/scratch-image";
import { seedRecord } from "../src/test/next-task-fixture";
import {
  STAND_IN,
  benchmarkReplica,
  emptyWork,
  meteredTaskNotes,
} from "./sdk-stand-in";

it("measures Scratchpad history revision reads", async () => {
  const replica = benchmarkReplica();
  for (let index = 0; index < 206; index++)
    seedRecord(replica, {
      path: `TaskNotes/Scratchpad/${index}.md`,
      types: [SCRATCHPAD_TYPE],
      frontmatter: {
        type: SCRATCHPAD_TYPE,
        id: `note-${index}`,
        state: index === 0 ? "active" : "converted",
        dateCreated: "2026-07-01T00:00:00Z",
        dateModified: "2026-07-02T00:00:00Z",
      },
      body: "x".repeat(2048),
    });
  for (let index = 0; index < 150; index++)
    seedRecord(replica, {
      path: `TaskNotes/Scratchpad/Image Metadata/${index}.md`,
      types: [SCRATCH_IMAGE_TYPE],
      frontmatter: {
        type: SCRATCH_IMAGE_TYPE,
        id: `image-${index}`,
        dateCreated: "2026-07-01T00:00:00Z",
        dateModified: "2026-07-02T00:00:00Z",
        file: `TaskNotes/Scratchpad/Images/${index}.png`,
        digest: `sha256:${"a".repeat(64)}`,
        size: 12,
        mediaType: "image/png",
      },
      body: "",
    });
  const work = emptyWork();
  const { client, repository, close } = await meteredTaskNotes(
    replica,
    () => work,
  );
  const submit = vi.spyOn(client, "submit");
  await repository.initialize({ deferTaskIndex: true });
  Object.assign(work, emptyWork());
  const start = performance.now();
  let page = await repository.listScratchFeed({ limit: 100 });
  const items = [...page.items];
  while (page.nextCursor) {
    page = await repository.listScratchFeed({
      limit: 100,
      cursor: page.nextCursor,
    });
    items.push(...page.items);
  }
  expect(items).toHaveLength(355);
  expect(page.current.id).toBe("note-0");
  // Reading history never writes.
  expect(submit).not.toHaveBeenCalled();
  const result = {
    revision: process.env.PERF_REVISION ?? "working-tree",
    environment: `${STAND_IN}; one sample`,
    notes: 205,
    images: 150,
    bodyBytesPerNote: 2048,
    medianMs: +(performance.now() - start).toFixed(2),
    work,
  };
  close();
  const destination =
    process.env.PERF_SCRATCH_OUTPUT ??
    "benchmarks/results/scratch-history-latest.json";
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(result, null, 2) + "\n");
});
