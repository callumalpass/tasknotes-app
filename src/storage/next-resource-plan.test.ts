// @vitest-environment node
import { pinnedCoreBytes, sha256 } from "./next-resource-core.test-helper.mjs";
import { init, loadCatalog } from "mdbase";
import type { MdbaseClient } from "@mdbase-dev/sdk";
import pin from "../../vendor/mdbase-browser.pin.json";
import {
  captureResourceSetupPlan,
  nativeResourceSetupAssessment,
  recheckPreparedResourceSetup,
} from "./next-resource-plan";
import {
  TASKNOTES_DEFAULT_VIEW_SOURCES,
  taskNotesDefaultBaseSources,
} from "../domain/default-view-source";

vi.mock("../cloud/next-model-pack-core", () => ({
  initializeModelPackCore: async () => {
    const bytes = pinnedCoreBytes();
    expect(bytes.length).toBe(pin.wasmBytes);
    expect(sha256(bytes)).toBe(pin.wasmSha256);
    await init({ wasm: bytes });
  },
}));
const signal = () => new AbortController().signal;
const config =
  "spec_version: '0.3.0'\nsettings:\n  record_extensions: [md, txt]\nx-user: keep\n";
const resources = () => ({ "mdbase.yaml": config });
const client = () =>
  ({ listAppBasesViews: vi.fn() }) as unknown as MdbaseClient;
// Actual pinned WASM/publisher-data tests; native discovery remains a protocol
// stand-in. NOT native atomic execution, live grants, runtime pin or LAB proof.
describe("actual resource Core planner with unchanged publisher inputs", () => {
  it("assesses actual staged task configuration and exact five raw sources without creating UUIDs", async () => {
    const uuid = vi.spyOn(crypto, "randomUUID");
    const held = client();
    const factory = vi.fn(taskNotesDefaultBaseSources);
    const assessment = await nativeResourceSetupAssessment(
      resources(),
      held,
      factory,
      signal(),
    );
    expect(uuid).not.toHaveBeenCalled();
    expect(held.listAppBasesViews).not.toHaveBeenCalled(); // CURRENT resolved Base contract absent; occupancy UNKNOWN.
    expect(assessment.packs.map((p) => [p.id, p.version])).toEqual([
      ["tasknotes.task", "0.3.0-rc.18"],
      ["obsidian.base", "1.0.0"],
    ]);
    expect(assessment.sources.map((s) => s.path)).toEqual([
      "TaskNotes/Views/today.base",
      "TaskNotes/Views/upcoming.base",
      "TaskNotes/Views/calendar.base",
      "TaskNotes/Views/projects.base",
      "TaskNotes/Views/archive.base",
    ]);
    const generated = taskNotesDefaultBaseSources(factory.mock.calls[0]![0]);
    expect(assessment.sources).toEqual(
      generated.map(({ path, document }) => ({ path, document })),
    );
    expect(
      assessment.resourceOps.filter((o) => o.path === "mdbase.lock.yaml"),
    ).toHaveLength(1);
    expect(
      assessment.resourceReadback.find((r) => r.path === "mdbase.yaml")!.doc,
    ).toContain("x-user: keep");
    for (const source of assessment.sources) {
      expect(source.document).not.toMatch(/^(kind|type|id):/m);
      expect(source.document).toMatch(/^views:/m);
    }
    const captured = captureResourceSetupPlan(assessment);
    expect(uuid).toHaveBeenCalledTimes(5);
    expect(new Set(captured.sources.map((s) => s.id)).size).toBe(5);
    expect(
      captured.sources.map(({ path, document }) => ({ path, document })),
    ).toEqual(assessment.sources);
  });
  it("uses actual Core defaults and guarded configuration creation for an empty complete resource inventory", async () => {
    const uuid = vi.spyOn(crypto, "randomUUID");
    const held = client();
    const assessment = await nativeResourceSetupAssessment(
      {},
      held,
      taskNotesDefaultBaseSources,
      signal(),
    );
    expect(uuid).not.toHaveBeenCalled();
    expect(held.listAppBasesViews).not.toHaveBeenCalled();
    const configurationOp = assessment.resourceOps.find(
      (op) => op.path === "mdbase.yaml",
    );
    expect(configurationOp).toMatchObject({
      kind: "resource_put",
      path: "mdbase.yaml",
      mustNotExist: true,
    });
    expect(configurationOp).not.toHaveProperty("baseRevision");
    const data = Object.fromEntries(
      assessment.resourceReadback
        .filter((resource) => resource.doc !== null)
        .map((resource) => [resource.path, resource.doc!]),
    );
    expect(data["mdbase.yaml"]).toMatch(/spec_version: ['"]?0\.3\.0['"]?/);
    const catalog = await loadCatalog(data);
    expect(catalog.valid).toBe(true);
    expect(catalog.settings.record_extensions).toEqual(["md", "base"]);
    expect(catalog.settings.types_folder).toBe("_types");
    expect(catalog.settings.contracts_folder).toBe("_contracts");
    expect(assessment.sources.map((source) => source.path)).toEqual(
      TASKNOTES_DEFAULT_VIEW_SOURCES.map((source) => source.path),
    );
    expect(
      assessment.resourceOps.filter((op) => op.path === "mdbase.lock.yaml"),
    ).toHaveLength(1);
    const captured = captureResourceSetupPlan(assessment);
    expect(uuid).toHaveBeenCalledTimes(5);
    await recheckPreparedResourceSetup({}, captured, signal());
    await expect(
      recheckPreparedResourceSetup(
        { "mdbase.yaml": config },
        captured,
        signal(),
      ),
    ).rejects.toMatchObject({ code: "concurrent_modification" });
    expect(uuid).toHaveBeenCalledTimes(5);
  });
  it("rechecks original resource guards/digest without regenerating any sources or UUIDs", async () => {
    const factory = vi.fn(taskNotesDefaultBaseSources);
    const plan = captureResourceSetupPlan(
      await nativeResourceSetupAssessment(
        resources(),
        client(),
        factory,
        signal(),
      ),
    );
    const uuid = vi.spyOn(crypto, "randomUUID");
    await recheckPreparedResourceSetup(resources(), plan, signal());
    expect(uuid).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(1);
    await expect(
      recheckPreparedResourceSetup(
        { ...resources(), "_types/unrelated.md": "changed" },
        plan,
        signal(),
      ),
    ).rejects.toMatchObject({ code: "concurrent_modification" });
    expect(uuid).not.toHaveBeenCalled();
  });
  it("retains actual discovered existing sources without claiming ordinary-file absence", async () => {
    const initial = await nativeResourceSetupAssessment(
      resources(),
      client(),
      taskNotesDefaultBaseSources,
      signal(),
    );
    const data = Object.fromEntries(
      initial.resourceReadback
        .filter((r) => r.doc !== null)
        .map((r) => [r.path, r.doc!]),
    );
    const held = client();
    vi.mocked(held.listAppBasesViews).mockResolvedValue({
      kind: "success",
      continuation: null,
      clock: { instant: 1, tz: "UTC", localDate: "1970-01-01" },
      collectionRevision: "sha256:" + "ab".repeat(32),
      views: [
        {
          record: "44444444-4444-4444-8444-444444444444",
          path: "TaskNotes/Views/today.base",
          sourceRevision: "sha256:" + "cd".repeat(32),
          ordinal: 0,
          name: "Synthetic Today",
          viewType: "tasknotesTaskList",
          implementations: [],
        },
      ],
    });
    const assessment = await nativeResourceSetupAssessment(
      data,
      held,
      taskNotesDefaultBaseSources,
      signal(),
    );
    expect(held.listAppBasesViews).toHaveBeenCalledTimes(1);
    expect(assessment.sources).toHaveLength(4);
    expect(
      assessment.sources.some((s) => s.path === "TaskNotes/Views/today.base"),
    ).toBe(false);
    expect(assessment.resourceOps).toEqual([]);
  });
  it("fails invalid/conflicting config and an altered generator scope without fallback", async () => {
    await expect(
      nativeResourceSetupAssessment(
        { "mdbase.yaml": "settings:\n  record_extensions: bad\n" },
        client(),
        taskNotesDefaultBaseSources,
        signal(),
      ),
    ).rejects.toMatchObject({ code: "collection_setup_conflict" });
    await expect(
      nativeResourceSetupAssessment(resources(), client(), () => [], signal()),
    ).rejects.toThrow("exact five");
  });
});
afterEach(() => vi.restoreAllMocks());
