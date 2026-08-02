import {
  safePath,
  type Vault,
  type VaultEntry,
} from "../storage/vault-contract";

interface StoredFile {
  contents: Uint8Array;
  lastModified: number;
}

export class MemoryVault implements Vault {
  readonly kind = "browser" as const;
  readonly files = new Map<string, StoredFile>();
  private clock = 1;

  identifier(): string {
    return "memory";
  }

  async initialize(): Promise<void> {}

  async ensureText(path: string, contents: string): Promise<void> {
    if (!(await this.exists(path))) await this.writeText(path, contents);
  }

  async listMarkdownFiles(path: string): Promise<VaultEntry[]> {
    return this.listFiles(path, [".md"]);
  }

  async listCollectionFiles(extensions: string[]): Promise<VaultEntry[]> {
    return this.entries(extensions);
  }

  async listFiles(path: string, extensions: string[]): Promise<VaultEntry[]> {
    const prefix = `${safePath(path)}/`;
    return this.entries(extensions).filter(({ path: name }) =>
      name.startsWith(prefix),
    );
  }

  private entries(extensions: string[]): VaultEntry[] {
    return [...this.files.entries()]
      .filter(([name]) =>
        extensions.some((extension) =>
          name.toLowerCase().endsWith(extension.toLowerCase()),
        ),
      )
      .map(([name, file]) => ({
        path: name,
        lastModified: file.lastModified,
        size: file.contents.byteLength,
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async readText(path: string): Promise<string> {
    const file = this.files.get(safePath(path));
    if (!file) throw new DOMException("File not found", "NotFoundError");
    return new TextDecoder().decode(file.contents);
  }

  async writeText(path: string, contents: string): Promise<VaultEntry> {
    const safe = safePath(path);
    const file = {
      contents: new TextEncoder().encode(contents),
      lastModified: this.clock++,
    };
    this.files.set(safe, file);
    return {
      path: safe,
      lastModified: file.lastModified,
      size: file.contents.byteLength,
    };
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const file = this.files.get(safePath(path));
    if (!file) throw new DOMException("File not found", "NotFoundError");
    return file.contents.slice();
  }

  async writeBinary(path: string, contents: Uint8Array): Promise<VaultEntry> {
    const safe = safePath(path);
    const file = { contents: contents.slice(), lastModified: this.clock++ };
    this.files.set(safe, file);
    return {
      path: safe,
      lastModified: file.lastModified,
      size: file.contents.byteLength,
    };
  }

  async delete(path: string): Promise<void> {
    this.files.delete(safePath(path));
  }

  async rename(from: string, to: string): Promise<VaultEntry> {
    const source = safePath(from);
    const destination = safePath(to);
    const file = this.files.get(source);
    if (!file) throw new DOMException("File not found", "NotFoundError");
    if (this.files.has(destination))
      throw new Error(`A record already exists at ${destination}.`);
    const moved = { ...file, lastModified: this.clock++ };
    this.files.set(destination, moved);
    this.files.delete(source);
    return {
      path: destination,
      lastModified: moved.lastModified,
      size: moved.contents.byteLength,
    };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(safePath(path));
  }

  location(): string {
    return "memory://TaskNotes";
  }
}
