const filesystem = vi.hoisted(() => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Documents: "DOCUMENTS" },
  Encoding: { UTF8: "utf8" },
  Filesystem: filesystem,
}));

import { CapacitorVault } from "./vault-capacitor";

beforeEach(() => {
  vi.clearAllMocks();
  filesystem.mkdir.mockResolvedValue(undefined);
  filesystem.stat.mockRejectedValue(new Error("File does not exist"));
  filesystem.writeFile.mockResolvedValue(undefined);
});

it("deduplicates concurrent parent creation before nested writes", async () => {
  filesystem.stat.mockImplementation(({ path }: { path: string }) =>
    path.endsWith(".json")
      ? Promise.resolve({ mtime: 3, size: 12 })
      : Promise.reject(new Error("File does not exist")),
  );
  const vault = new CapacitorVault();

  await Promise.all([
    vault.writeText("_schemas/tasknotes/one.json", "one"),
    vault.writeText("_schemas/tasknotes/two.json", "two"),
  ]);

  expect(filesystem.mkdir).toHaveBeenCalledTimes(1);
  expect(filesystem.mkdir).toHaveBeenCalledWith({
    path: "TaskNotes/_schemas/tasknotes",
    directory: "DOCUMENTS",
    recursive: true,
  });
  expect(filesystem.writeFile).toHaveBeenCalledTimes(2);
  expect(filesystem.writeFile).toHaveBeenCalledWith(
    expect.objectContaining({ recursive: false }),
  );
});

it("creates the collection root before its standard directories", async () => {
  await new CapacitorVault().initialize();

  expect(filesystem.mkdir.mock.calls).toEqual([
    [
      {
        path: "TaskNotes",
        directory: "DOCUMENTS",
        recursive: true,
      },
    ],
    [
      {
        path: "TaskNotes/tasks",
        directory: "DOCUMENTS",
        recursive: true,
      },
    ],
    [
      {
        path: "TaskNotes/_types",
        directory: "DOCUMENTS",
        recursive: true,
      },
    ],
    [
      {
        path: "TaskNotes/views",
        directory: "DOCUMENTS",
        recursive: true,
      },
    ],
  ]);
});
