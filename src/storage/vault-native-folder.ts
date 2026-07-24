import { FolderAccess } from "../native/folder-access";
import { safePath, type Vault, type VaultEntry } from "./vault-contract";

import type { LocalCollectionLocation } from "./local-collection-location";

export class NativeFolderVault implements Vault {
  readonly kind = "native" as const;
  private readonly selection: Extract<
    LocalCollectionLocation,
    { mode: "external" }
  >;

  constructor(
    selection: Extract<LocalCollectionLocation, { mode: "external" }>,
  ) {
    this.selection = selection;
  }

  identifier(): string {
    return `native-folder:${this.selection.id}`;
  }

  async initialize(): Promise<void> {
    const current = (await FolderAccess.currentFolder()).selection;
    if (!current || current.id !== this.selection.id)
      throw new Error(
        `TaskNotes no longer has access to “${this.selection.name}”. Choose the folder again.`,
      );
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
    return this.list("", extensions, true);
  }

  async listFiles(path: string, extensions: string[]): Promise<VaultEntry[]> {
    return this.list(safePath(path), extensions, true);
  }

  async readText(path: string): Promise<string> {
    const result = await FolderAccess.readText({
      selectionId: this.selection.id,
      path: safePath(path),
    });
    return result.data;
  }

  async writeText(path: string, contents: string): Promise<VaultEntry> {
    const result = await FolderAccess.writeText({
      selectionId: this.selection.id,
      path: safePath(path),
      data: contents,
    });
    return result.entry;
  }

  async rename(from: string, to: string): Promise<VaultEntry> {
    const result = await FolderAccess.rename({
      selectionId: this.selection.id,
      from: safePath(from),
      to: safePath(to),
    });
    return result.entry;
  }

  async delete(path: string): Promise<void> {
    await FolderAccess.deleteFile({
      selectionId: this.selection.id,
      path: safePath(path),
    });
  }

  async exists(path: string): Promise<boolean> {
    const result = await FolderAccess.exists({
      selectionId: this.selection.id,
      path: safePath(path),
    });
    return result.exists;
  }

  location(): string {
    return `Files/${this.selection.name}`;
  }

  private async ensureDirectory(path: string): Promise<void> {
    await FolderAccess.ensureDirectory({
      selectionId: this.selection.id,
      path: safePath(path),
    });
  }

  private async list(
    path: string,
    extensions: string[],
    recursive: boolean,
  ): Promise<VaultEntry[]> {
    const result = await FolderAccess.listFiles({
      selectionId: this.selection.id,
      path,
      extensions,
      recursive,
    });
    return result.files.sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  }
}
