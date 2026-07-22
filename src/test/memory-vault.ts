import {
  safePath,
  type Vault,
  type VaultEntry,
} from "../storage/vault-contract";

interface StoredFile {
  contents: string;
  lastModified: number;
}

export class MemoryVault implements Vault {
  readonly kind = "browser" as const;
  readonly files = new Map<string, StoredFile>();
  private clock = 1;

  async initialize(): Promise<void> {}

  async ensureText(path: string, contents: string): Promise<void> {
    if (!(await this.exists(path))) await this.writeText(path, contents);
  }

  async listMarkdownFiles(path: string): Promise<VaultEntry[]> {
    return this.listFiles(path, [".md"]);
  }

  async listFiles(path: string, extensions: string[]): Promise<VaultEntry[]> {
    const prefix = `${safePath(path)}/`;
    return [...this.files.entries()]
      .filter(
        ([name]) =>
          name.startsWith(prefix) &&
          extensions.some((extension) =>
            name.toLowerCase().endsWith(extension.toLowerCase()),
          ),
      )
      .map(([name, file]) => ({
        path: name,
        lastModified: file.lastModified,
        size: new TextEncoder().encode(file.contents).byteLength,
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async readText(path: string): Promise<string> {
    const file = this.files.get(safePath(path));
    if (!file) throw new DOMException("File not found", "NotFoundError");
    return file.contents;
  }

  async writeText(path: string, contents: string): Promise<VaultEntry> {
    const safe = safePath(path);
    const file = { contents, lastModified: this.clock++ };
    this.files.set(safe, file);
    return {
      path: safe,
      lastModified: file.lastModified,
      size: new TextEncoder().encode(contents).byteLength,
    };
  }

  async delete(path: string): Promise<void> {
    this.files.delete(safePath(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(safePath(path));
  }

  location(): string {
    return "memory://TaskNotes";
  }
}
