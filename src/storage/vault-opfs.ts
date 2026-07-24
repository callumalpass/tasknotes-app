import { safePath, type Vault, type VaultEntry } from "./vault-contract";

const ROOT = "TaskNotes";

export class OpfsVault implements Vault {
  readonly kind = "browser" as const;
  private root: FileSystemDirectoryHandle | null = null;

  identifier(): string {
    return "browser-default";
  }

  async initialize(): Promise<void> {
    const storageRoot = await navigator.storage.getDirectory();
    this.root = await storageRoot.getDirectoryHandle(ROOT, { create: true });
    await this.directory("tasks", true);
    await this.directory("_types", true);
    await this.directory("views", true);
  }

  async ensureText(path: string, contents: string): Promise<void> {
    if (await this.exists(path)) return;
    await this.writeText(path, contents);
  }

  async listMarkdownFiles(path: string): Promise<VaultEntry[]> {
    return this.listFiles(path, [".md"]);
  }

  async listCollectionFiles(extensions: string[]): Promise<VaultEntry[]> {
    return this.collectFiles(this.requireRoot(), "", extensions);
  }

  async listFiles(path: string, extensions: string[]): Promise<VaultEntry[]> {
    const rootPath = safePath(path);
    const root = await this.directory(rootPath, false);
    return this.collectFiles(root, rootPath, extensions);
  }

  private async collectFiles(
    root: FileSystemDirectoryHandle,
    rootPath: string,
    extensions: string[],
  ): Promise<VaultEntry[]> {
    const pending: { directory: FileSystemDirectoryHandle; path: string }[] = [
      { directory: root, path: rootPath },
    ];
    const entries: VaultEntry[] = [];
    while (pending.length) {
      const current = pending.shift()!;
      for await (const [name, handle] of current.directory.entries()) {
        const nextPath = current.path ? `${current.path}/${name}` : name;
        if (handle.kind === "directory") {
          if (!EXCLUDED_DIRECTORIES.has(name))
            pending.push({ directory: handle, path: nextPath });
          continue;
        }
        if (
          !extensions.some((extension) =>
            name.toLowerCase().endsWith(extension.toLowerCase()),
          )
        )
          continue;
        const file = await handle.getFile();
        entries.push({
          path: nextPath,
          lastModified: file.lastModified,
          size: file.size,
        });
      }
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  async readText(path: string): Promise<string> {
    const file = await this.file(path, false);
    return (await file.getFile()).text();
  }

  async writeText(path: string, contents: string): Promise<VaultEntry> {
    const relativePath = safePath(path);
    const file = await this.file(relativePath, true);
    const writable = await file.createWritable();
    try {
      await writable.write(contents);
    } finally {
      await writable.close();
    }
    const snapshot = await file.getFile();
    return {
      path: relativePath,
      lastModified: snapshot.lastModified,
      size: snapshot.size,
    };
  }

  async delete(path: string): Promise<void> {
    const segments = safePath(path).split("/");
    const name = segments.pop()!;
    const parent = await this.directory(segments.join("/"), false);
    await parent.removeEntry(name).catch(ignoreMissing);
  }

  async rename(from: string, to: string): Promise<VaultEntry> {
    const source = safePath(from);
    const destination = safePath(to);
    if (await this.exists(destination))
      throw new Error(`A record already exists at ${destination}.`);
    const sourceHandle = await this.file(source, false);
    const destinationParts = destination.split("/");
    const destinationName = destinationParts.pop()!;
    const destinationDirectory = await this.directory(
      destinationParts.join("/"),
      true,
    );
    const movable = sourceHandle as FileSystemFileHandle & {
      move?: (
        directory: FileSystemDirectoryHandle,
        name?: string,
      ) => Promise<void>;
    };
    if (movable.move) {
      await movable.move(destinationDirectory, destinationName);
    } else {
      const contents = await (await sourceHandle.getFile()).text();
      await this.writeText(destination, contents);
      await this.delete(source);
    }
    const moved = await this.file(destination, false);
    const file = await moved.getFile();
    return {
      path: destination,
      lastModified: file.lastModified,
      size: file.size,
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.file(path, false);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError")
        return false;
      throw error;
    }
  }

  location(): string {
    return "Browser storage/TaskNotes";
  }

  private requireRoot(): FileSystemDirectoryHandle {
    if (!this.root) throw new Error("Browser vault has not initialized.");
    return this.root;
  }

  private async directory(
    path: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    let directory = this.requireRoot();
    if (!path) return directory;
    for (const segment of safePath(path).split("/"))
      directory = await directory.getDirectoryHandle(segment, { create });
    return directory;
  }

  private async file(
    path: string,
    create: boolean,
  ): Promise<FileSystemFileHandle> {
    const segments = safePath(path).split("/");
    const name = segments.pop()!;
    const parent = await this.directory(segments.join("/"), create);
    return parent.getFileHandle(name, { create });
  }
}

const EXCLUDED_DIRECTORIES = new Set([".git", ".mdbase", "node_modules"]);

function ignoreMissing(error: unknown): void {
  if (!(error instanceof DOMException) || error.name !== "NotFoundError")
    throw error;
}
