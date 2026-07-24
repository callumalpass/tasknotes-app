import { Capacitor } from "@capacitor/core";

import { CapacitorVault } from "./vault-capacitor";
import { readLocalCollectionLocation } from "./local-collection-location";
import { NativeFolderVault } from "./vault-native-folder";
import { OpfsVault } from "./vault-opfs";
import type { Vault } from "./vault-contract";

export type { Vault, VaultEntry } from "./vault-contract";

export function createPlatformVault(): Vault {
  if (!Capacitor.isNativePlatform()) return new OpfsVault();
  const location = readLocalCollectionLocation();
  return location.mode === "external"
    ? new NativeFolderVault(location)
    : new CapacitorVault();
}
