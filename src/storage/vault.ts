import { Capacitor } from "@capacitor/core";

import { CapacitorVault } from "./vault-capacitor";
import { readLocalCollectionLocation } from "./local-collection-location";
import { NativeFolderVault } from "./vault-native-folder";
import { OpfsVault } from "./vault-opfs";
import type { Vault } from "./vault-contract";
import type { LocalCollectionLocation } from "./local-collection-location";

export type { Vault, VaultEntry } from "./vault-contract";

export function createLocalVault(
  selectedLocation?: LocalCollectionLocation,
): Vault {
  if (!Capacitor.isNativePlatform()) {
    // Browser-local collections are an E2E fixture, never a product runtime.
    if (import.meta.env.MODE === "e2e") return new OpfsVault();
    throw new Error(
      "Device-local collections are available only in the Android and iOS apps.",
    );
  }
  const location = selectedLocation ?? readLocalCollectionLocation();
  return location.mode === "external"
    ? new NativeFolderVault(location)
    : new CapacitorVault();
}
