export interface VaultEntry {
  path: string;
  lastModified: number;
  size: number;
}

export interface Vault {
  readonly kind: "native" | "browser";
  identifier(): string;
  initialize(): Promise<void>;
  ensureText(path: string, contents: string): Promise<void>;
  listCollectionFiles(extensions: string[]): Promise<VaultEntry[]>;
  listFiles(path: string, extensions: string[]): Promise<VaultEntry[]>;
  listMarkdownFiles(path: string): Promise<VaultEntry[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<VaultEntry>;
  rename(from: string, to: string): Promise<VaultEntry>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  location(): string;
}

export function safePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe collection path: ${value}`);
  }
  return normalized;
}

export function isExcludedCollectionComponent(value: string): boolean {
  return value.startsWith(".") || value === "node_modules";
}

export function isExcludedCollectionPath(value: string): boolean {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .some(isExcludedCollectionComponent);
}
