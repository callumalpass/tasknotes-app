import {
  Directory,
  Encoding,
  Filesystem,
  type FileInfo,
} from "@capacitor/filesystem";

import {
  isExcludedCollectionComponent,
  safePath,
  type BinaryVault,
  type VaultEntry,
} from "./vault-contract";
import { isMissingFileError } from "./vault-errors";

const ROOT = "TaskNotes";

export class CapacitorVault implements BinaryVault {
  readonly kind = "native" as const;
  private readonly directoryOperations = new Map<string, Promise<void>>();

  identifier(): string {
    return "native-default";
  }

  async initialize(): Promise<void> {
    await this.ensureRootDirectory();
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
        if (isExcludedCollectionComponent(file.name)) continue;
        const nextPath = directory ? `${directory}/${file.name}` : file.name;
        if (file.type === "directory") {
          pending.push(nextPath);
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
    await this.ensureParentDirectory(relativePath);
    await Filesystem.writeFile({
      path: this.path(relativePath),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      data: contents,
      recursive: false,
    });
    const info = await Filesystem.stat({
      path: this.path(relativePath),
      directory: Directory.Documents,
    });
    return toEntry(relativePath, info);
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const result = await Filesystem.readFile({
      path: this.path(path),
      directory: Directory.Documents,
    });
    if (typeof result.data !== "string")
      return new Uint8Array(await result.data.arrayBuffer());
    return bytesFromBase64(result.data);
  }

  async writeBinary(path: string, contents: Uint8Array): Promise<VaultEntry> {
    const relativePath = safePath(path);
    await this.ensureParentDirectory(relativePath);
    await Filesystem.writeFile({
      path: this.path(relativePath),
      directory: Directory.Documents,
      data: base64FromBytes(contents),
      recursive: false,
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
    } catch (error) {
      if (isMissingFileError(error)) return false;
      throw error;
    }
  }

  location(): string {
    return "Documents/TaskNotes";
  }

  private path(path: string): string {
    return `${ROOT}/${safePath(path)}`;
  }

  private async ensureRootDirectory(): Promise<void> {
    try {
      await Filesystem.stat({
        path: ROOT,
        directory: Directory.Documents,
      });
      return;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    await Filesystem.mkdir({
      path: ROOT,
      directory: Directory.Documents,
      recursive: true,
    });
  }

  private ensureDirectory(path: string): Promise<void> {
    const relativePath = safePath(path);
    const active = this.directoryOperations.get(relativePath);
    if (active) return active;
    const operation = this.createDirectory(relativePath).finally(() => {
      this.directoryOperations.delete(relativePath);
    });
    this.directoryOperations.set(relativePath, operation);
    return operation;
  }

  private async createDirectory(path: string): Promise<void> {
    if (await this.exists(path)) return;
    try {
      await Filesystem.mkdir({
        path: this.path(path),
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (error) {
      if (!(await this.exists(path))) throw error;
    }
  }

  private async ensureParentDirectory(path: string): Promise<void> {
    const separator = path.lastIndexOf("/");
    if (separator > 0) await this.ensureDirectory(path.slice(0, separator));
  }
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toEntry(path: string, info: FileInfo): VaultEntry {
  return {
    path,
    lastModified: info.mtime ?? Date.now(),
    size: info.size,
  };
}

function ignoreMissing(error: unknown): void {
  if (!isMissingFileError(error)) throw error;
}
