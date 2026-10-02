import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, it } from "vitest";
import { mdbaseFixture, type TestRecord } from "../src/test/mdbase-fixture";

it("measures Scratchpad history revision reads", async () => {
  const { MdbaseTaskRepository } = (await import(
    process.env.PERF_REPOSITORY_MODULE ?? "../src/storage/mdbase-repository"
  )) as typeof import("../src/storage/mdbase-repository");
  const notes = Array.from({ length: 206 }, (_, index): TestRecord => ({
    path: `scratchpads/${index}.md`,
    revision: `note-r${index}`,
    types: ["tasknotes-scratch"],
    frontmatter: {
      type: "tasknotes-scratch",
      id: `note-${index}`,
      state: index === 0 ? "active" : "converted",
      dateCreated: "2026-07-01T00:00:00Z",
      dateModified: "2026-07-02T00:00:00Z",
    },
    body: "x".repeat(2048),
  }));
  const images = Array.from({ length: 150 }, (_, index): TestRecord => ({
    path: `scratch-images/${index}.md`,
    revision: `image-r${index}`,
    types: ["tasknotes-scratch-image"],
    frontmatter: {
      type: "tasknotes-scratch-image",
      id: `image-${index}`,
      dateCreated: "2026-07-01T00:00:00Z",
      dateModified: "2026-07-02T00:00:00Z",
      file: `images/${index}.png`,
      digest: `sha256:${"a".repeat(64)}`,
      size: 12,
      mediaType: "image/png",
    },
    body: "",
  }));
  const fixture = mdbaseFixture([...notes, ...images]);
  if (process.env.PERF_AUTHORITY === "qualified")
    fixture.authorityCapabilities.add("read-many-documents-v1");
  const serialize = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const query = fixture.query.getMockImplementation()!;
  fixture.query.mockImplementation(async (input) =>
    serialize(await query(input)),
  );
  const read = fixture.read.getMockImplementation()!;
  fixture.read.mockImplementation(async (input) =>
    serialize(await read(input)),
  );
  const readDocuments = fixture.readDocuments.getMockImplementation()!;
  fixture.readDocuments.mockImplementation(async (input) =>
    serialize(await readDocuments(input)),
  );
  const repository = new MdbaseTaskRepository(fixture.connect);
  await repository.initialize({ deferTaskIndex: true });
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
  expect(fixture.create).not.toHaveBeenCalled();
  expect(fixture.update).not.toHaveBeenCalled();
  const result = {
    revision: process.env.PERF_REVISION ?? "working-tree",
    authority: process.env.PERF_AUTHORITY ?? "legacy",
    environment:
      "synthetic serialized authority; one sample, no network or provider query-engine timing",
    notes: 205,
    images: 150,
    bodyBytesPerNote: 2048,
    medianMs: +(performance.now() - start).toFixed(2),
    requests:
      fixture.query.mock.calls.length +
      fixture.read.mock.calls.length +
      fixture.readDocuments.mock.calls.length,
    queries: fixture.query.mock.calls.length,
    pointReads: fixture.read.mock.calls.length,
    documentBatches: fixture.readDocuments.mock.calls.length,
  };
  repository.dispose();
  const destination =
    process.env.PERF_SCRATCH_OUTPUT ??
    "benchmarks/results/scratch-history-latest.json";
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(result, null, 2) + "\n");
});
