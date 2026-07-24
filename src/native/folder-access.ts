import { registerPlugin } from "@capacitor/core";

export interface NativeFolderSelection {
  id: string;
  name: string;
}

export interface NativeFolderEntry {
  path: string;
  lastModified: number;
  size: number;
}

interface FolderAccessPlugin {
  pickFolder(): Promise<{
    cancelled: boolean;
    selection?: NativeFolderSelection;
  }>;
  currentFolder(): Promise<{ selection?: NativeFolderSelection }>;
  clearFolder(options: { selectionId: string }): Promise<void>;
  ensureDirectory(options: {
    selectionId: string;
    path: string;
  }): Promise<void>;
  listFiles(options: {
    selectionId: string;
    path: string;
    extensions: string[];
    recursive: boolean;
  }): Promise<{ files: NativeFolderEntry[] }>;
  readText(options: {
    selectionId: string;
    path: string;
  }): Promise<{ data: string }>;
  writeText(options: {
    selectionId: string;
    path: string;
    data: string;
  }): Promise<{ entry: NativeFolderEntry }>;
  rename(options: {
    selectionId: string;
    from: string;
    to: string;
  }): Promise<{ entry: NativeFolderEntry }>;
  deleteFile(options: { selectionId: string; path: string }): Promise<void>;
  exists(options: {
    selectionId: string;
    path: string;
  }): Promise<{ exists: boolean }>;
}

export const FolderAccess = registerPlugin<FolderAccessPlugin>("FolderAccess");
