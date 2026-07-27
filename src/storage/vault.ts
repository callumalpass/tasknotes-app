import { Capacitor } from "@capacitor/core";

import { CapacitorVault } from "./vault-capacitor";
import { readLocalCollectionLocation } from "./local-collection-location";
import { NativeFolderVault } from "./vault-native-folder";
import { OpfsVault } from "./vault-opfs";
import type { Vault } from "./vault-contract";
import type { LocalCollectionLocation } from "./local-collection-location";

export type { Vault, VaultEntry } from "./vault-contract";

export function createPlatformVault(
  selectedLocation?: LocalCollectionLocation,
): Vault {
  if (!Capacitor.isNativePlatform()) return new OpfsVault();
  const location = selectedLocation ?? readLocalCollectionLocation();
  return location.mode === "external"
    ? new NativeFolderVault(location)
    : new CapacitorVault();
}
