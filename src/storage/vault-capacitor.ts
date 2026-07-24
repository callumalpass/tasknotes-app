import {
  Directory,
  Encoding,
  Filesystem,
  type FileInfo,
} from "@capacitor/filesystem";

import { safePath, type Vault, type VaultEntry } from "./vault-contract";

const ROOT = "TaskNotes";

export class CapacitorVault implements Vault {
  readonly kind = "native" as const;

  identifier(): string {
    return "native-default";
  }

  async initialize(): Promise<void> {
    await this.ensureDirectory("tasks");
    await this.ensureDirectory("_types");
    await this.ensureDirectory("views");
  }

  async ensureText(path: string, contents: string): Promise<void> {
    if (await this.exists(path)) return;
    await this.writeText(path, contents);
  }

  async listMarkdownFiles(path: string): Promise<VaultEntry[]> {
    return this.listFiles(path, [".md"]);
  }

  async listCollectionFiles(extensions: string[]): Promise<VaultEntry[]> {
    return this.collectFiles("", extensions);
  }

  async listFiles(path: string, extensions: string[]): Promise<VaultEntry[]> {
    return this.collectFiles(safePath(path), extensions);
  }

  private async collectFiles(
    root: string,
    extensions: string[],
  ): Promise<VaultEntry[]> {
    const pending = [root];
    const entries: VaultEntry[] = [];
    while (pending.length) {
      const directory = pending.shift()!;
      const result = await Filesystem.readdir({
        path: directory ? `${ROOT}/${directory}` : ROOT,
        directory: Directory.Documents,
      });
      for (const file of result.files) {
        const nextPath = directory ? `${directory}/${file.name}` : file.name;
        if (file.type === "directory") {
          if (!EXCLUDED_DIRECTORIES.has(file.name)) pending.push(nextPath);
          continue;
        }
        if (
          !extensions.some((extension) =>
            file.name.toLowerCase().endsWith(extension.toLowerCase()),
          )
        )
          continue;
        entries.push(toEntry(nextPath, file));
      }
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  async readText(path: string): Promise<string> {
    const result = await Filesystem.readFile({
      path: this.path(path),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    if (typeof result.data !== "string") return await result.data.text();
    return result.data;
  }

  async writeText(path: string, contents: string): Promise<VaultEntry> {
    const relativePath = safePath(path);
    await Filesystem.writeFile({
      path: this.path(relativePath),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      data: contents,
      recursive: true,
    });
    const info = await Filesystem.stat({
      path: this.path(relativePath),
      directory: Directory.Documents,
    });
    return toEntry(relativePath, info);
  }

  async delete(path: string): Promise<void> {
    await Filesystem.deleteFile({
      path: this.path(path),
      directory: Directory.Documents,
    }).catch(ignoreMissing);
  }

  async rename(from: string, to: string): Promise<VaultEntry> {
    const source = safePath(from);
    const destination = safePath(to);
    if (await this.exists(destination))
      throw new Error(`A record already exists at ${destination}.`);
    const parent = destination.slice(0, destination.lastIndexOf("/"));
    if (parent) await this.ensureDirectory(parent);
    await Filesystem.rename({
      from: this.path(source),
      to: this.path(destination),
      directory: Directory.Documents,
    });
    const info = await Filesystem.stat({
      path: this.path(destination),
      directory: Directory.Documents,
    });
    return toEntry(destination, info);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Filesystem.stat({
        path: this.path(path),
        directory: Directory.Documents,
      });
      return true;
    } catch {
      return false;
    }
  }

  location(): string {
    return "Documents/TaskNotes";
  }

  private path(path: string): string {
    return `${ROOT}/${safePath(path)}`;
  }

  private async ensureDirectory(path: string): Promise<void> {
    if (await this.exists(path)) return;
    await Filesystem.mkdir({
      path: this.path(path),
      directory: Directory.Documents,
      recursive: true,
    });
  }
}

const EXCLUDED_DIRECTORIES = new Set([".git", ".mdbase", "node_modules"]);

function toEntry(path: string, info: FileInfo): VaultEntry {
  return {
    path,
    lastModified: info.mtime ?? Date.now(),
    size: info.size,
  };
}

function ignoreMissing(error: unknown): void {
  const message = String(error).toLowerCase();
  if (!message.includes("not exist") && !message.includes("not found"))
    throw error;
}
