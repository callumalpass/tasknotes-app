const filesystem = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
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
  filesystem.deleteFile.mockResolvedValue(undefined);
  filesystem.rename.mockResolvedValue(undefined);
  filesystem.stat.mockRejectedValue(new Error("File does not exist"));
  filesystem.writeFile.mockResolvedValue(undefined);
});

it("stages binary writes and refuses to replace an existing destination", async () => {
  filesystem.stat.mockImplementation(({ path }: { path: string }) => {
    if (path.endsWith("Attachments/photo.png"))
      return Promise.resolve({ mtime: 1, size: 3 });
    if (path.includes(".tasknotes-write-"))
      return Promise.resolve({ mtime: 2, size: 3 });
    return Promise.resolve({ mtime: 1, size: 0 });
  });
  const vault = new CapacitorVault();

  await expect(
    vault.writeBinary("Attachments/photo.png", Uint8Array.of(1, 2, 3)),
  ).rejects.toThrow("already exists");

  expect(filesystem.writeFile).toHaveBeenCalledOnce();
  expect(filesystem.writeFile).toHaveBeenCalledWith(
    expect.objectContaining({
      path: expect.stringMatching(
        /^TaskNotes\/Attachments\/photo\.png\.tasknotes-write-[0-9a-f-]+\.tmp$/,
      ),
      data: "AQID",
    }),
  );
  expect(filesystem.rename).not.toHaveBeenCalled();
  expect(filesystem.deleteFile).toHaveBeenCalledWith(
    expect.objectContaining({
      path: expect.stringContaining("photo.png.tasknotes-write-"),
    }),
  );
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
