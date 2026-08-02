const folderAccess = vi.hoisted(() => ({
  currentFolder: vi.fn(),
  deleteFile: vi.fn(),
  ensureDirectory: vi.fn(),
  exists: vi.fn(),
  listFiles: vi.fn(),
  readBinary: vi.fn(),
  readText: vi.fn(),
  rename: vi.fn(),
  writeBinary: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("../native/folder-access", () => ({
  FolderAccess: folderAccess,
}));

import { NativeFolderVault } from "./vault-native-folder";

const selection = {
  mode: "external" as const,
  id: "folder-123",
  name: "Work vault",
};

beforeEach(() => {
  vi.clearAllMocks();
  folderAccess.currentFolder.mockResolvedValue({
    selection: { id: selection.id, name: selection.name },
  });
  folderAccess.ensureDirectory.mockResolvedValue(undefined);
});

it("opens the retained folder and installs collection directories", async () => {
  const vault = new NativeFolderVault(selection);
  await vault.initialize();

  expect(vault.identifier()).toBe("native-folder:folder-123");
  expect(vault.location()).toBe("Files/Work vault");
  expect(folderAccess.ensureDirectory.mock.calls).toEqual([
    [{ selectionId: selection.id, path: "tasks" }],
    [{ selectionId: selection.id, path: "_types" }],
    [{ selectionId: selection.id, path: "views" }],
  ]);
});

it("refuses to open when retained access no longer matches", async () => {
  folderAccess.currentFolder.mockResolvedValue({});
  const vault = new NativeFolderVault(selection);

  await expect(vault.initialize()).rejects.toThrow("Choose the folder again");
  expect(folderAccess.ensureDirectory).not.toHaveBeenCalled();
});

it("passes only relative paths and the collection id to native storage", async () => {
  folderAccess.listFiles.mockResolvedValue({
    files: [
      { path: "tasks/one.md", lastModified: 2, size: 12 },
      { path: "tasks/two.md", lastModified: 1, size: 9 },
    ],
  });
  folderAccess.readText.mockResolvedValue({ data: "# One" });
  folderAccess.exists.mockResolvedValue({ exists: true });
  const vault = new NativeFolderVault(selection);

  await expect(vault.listMarkdownFiles("tasks")).resolves.toEqual([
    { path: "tasks/one.md", lastModified: 2, size: 12 },
    { path: "tasks/two.md", lastModified: 1, size: 9 },
  ]);
  await expect(vault.readText("tasks/one.md")).resolves.toBe("# One");
  await expect(vault.exists("tasks/one.md")).resolves.toBe(true);
  expect(folderAccess.listFiles).toHaveBeenCalledWith({
    selectionId: selection.id,
    path: "tasks",
    extensions: [".md"],
    recursive: true,
  });
});

it("filters every path containing an excluded component", async () => {
  folderAccess.listFiles.mockResolvedValue({
    files: [
      { path: "visible.md", lastModified: 1, size: 1 },
      { path: ".hidden.md", lastModified: 1, size: 1 },
      { path: ".clump/commands/hidden.md", lastModified: 1, size: 1 },
      { path: "notes/.private/hidden.md", lastModified: 1, size: 1 },
      { path: "node_modules/package/readme.md", lastModified: 1, size: 1 },
    ],
  });
  const vault = new NativeFolderVault(selection);

  await expect(vault.listCollectionFiles([".md"])).resolves.toEqual([
    { path: "visible.md", lastModified: 1, size: 1 },
  ]);
});

it("round-trips binary bytes through the retained-folder bridge", async () => {
  folderAccess.readBinary.mockResolvedValue({ data: "AP8MYw==" });
  folderAccess.writeBinary.mockResolvedValue({
    entry: { path: "Attachments/photo.jpg", lastModified: 3, size: 4 },
  });
  const vault = new NativeFolderVault(selection);

  await expect(vault.readBinary("Attachments/photo.jpg")).resolves.toEqual(
    Uint8Array.of(0, 255, 12, 99),
  );
  await expect(
    vault.writeBinary("Attachments/photo.jpg", Uint8Array.of(0, 255, 12, 99)),
  ).resolves.toEqual({
    path: "Attachments/photo.jpg",
    lastModified: 3,
    size: 4,
  });
  expect(folderAccess.writeBinary).toHaveBeenCalledWith({
    selectionId: selection.id,
    path: "Attachments/photo.jpg",
    data: "AP8MYw==",
  });
});
