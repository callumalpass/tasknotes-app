// @vitest-environment node
import { beforeAll, expect, it } from "vitest";
import {
  pinnedBasesWitnessBytes,
  sha256,
} from "../storage/next-resource-core.test-helper.mjs";
import bases from "../../vendor/mdbase-contracts/obsidian.base-1.0.0.json";
import {
  createViewDocument,
  emptyViewDraft,
  materializeDefaultViewOrder,
  readViewDraft,
  updateViewDocument,
} from "./view-document";
import { obsidianRenderer, type ViewRenderer } from "./view-renderer";
import type { TaskViewSourceDocument } from "./view";

interface WitnessRuntime {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  replay(pointer: number, length: number): bigint;
  dealloc(pointer: number, length: number): void;
}
let runtime: WitnessRuntime;
beforeAll(async () => {
  const bytes = pinnedBasesWitnessBytes();
  expect(sha256(bytes)).toBe(
    "cf38bb15f84966513cea170bbbddd23ce4f35028377ee897da54983d620a44da",
  );
  const module = await WebAssembly.compile(bytes);
  const imports: Record<string, Record<string, () => never>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    imports[entry.module] ??= {};
    imports[entry.module]![entry.name] = () => {
      throw new Error(`Unexpected native witness host call: ${entry.name}`);
    };
  }
  runtime = (await WebAssembly.instantiate(module, imports))
    .exports as unknown as WitnessRuntime;
});

function validate(source: string) {
  const input = new TextEncoder().encode(
    JSON.stringify({
      op: "bases_view",
      source,
      path: "views/defaults.base",
      index: 0,
      resources: bases.resources.map((resource) => ({
        path: bases.manifest.resources.find(
          (entry) => entry.source === resource.source,
        )!.target,
        source: resource.document,
      })),
      records: [],
      property_types: {},
    }) + "\n",
  );
  const pointer = runtime.alloc(input.length);
  new Uint8Array(runtime.memory.buffer, pointer, input.length).set(input);
  const packed = runtime.replay(pointer, input.length);
  const outputPointer = Number(packed >> 32n);
  const outputLength = Number(packed & 0xffffffffn);
  try {
    const result = JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(runtime.memory.buffer, outputPointer, outputLength),
      ),
    );
    expect(result.rejected).toBe(0);
    return result.results[0].value ?? result.results[0];
  } finally {
    runtime.dealloc(outputPointer, outputLength);
  }
}

it("round-trips default fields through the real native Bases admission for every TaskNotes layout", () => {
  for (const renderer of [
    "tasknotes.task-list",
    "tasknotes.kanban",
    "tasknotes.calendar",
    "tasknotes.mini-calendar",
    "tasknotes.planner",
  ] satisfies ViewRenderer[]) {
    const draft = {
      ...emptyViewDraft("obsidian-bases"),
      renderer,
      properties: [],
    };
    const source: TaskViewSourceDocument = {
      recordId: "defaults",
      path: "views/defaults.base",
      format: "obsidian.base",
      revision: "original",
      document: createViewDocument("obsidian.base", draft),
    };
    expect(validate(source.document)).toEqual({ rows: [], groups: [] });
    const updated = updateViewDocument(source, {
      ...readViewDraft(source, "new-view"),
      properties: [],
    });
    expect(validate(updated)).toEqual({ rows: [], groups: [] });
    expect(
      readViewDraft({ ...source, document: updated }, "new-view").properties,
    ).toEqual([]);
    const legacy = {
      ...source,
      document: `views:\n  - name: Defaults\n    type: ${obsidianRenderer(renderer)}\n`,
    };
    expect(validate(legacy.document)).toMatchObject({
      refusal: "view_unsupported_construct",
      detail: "base_display_order_missing",
    });
    const repaired = materializeDefaultViewOrder(legacy, {
      recordId: "defaults",
      path: legacy.path,
      revision: "original",
      ordinal: 0,
      name: "Defaults",
    });
    expect(repaired).not.toBeNull();
    expect(validate(repaired!)).toEqual({ rows: [], groups: [] });
  }
});
