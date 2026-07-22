import { Capacitor } from "@capacitor/core";

import { CapacitorVault } from "./vault-capacitor";
import { OpfsVault } from "./vault-opfs";
import type { Vault } from "./vault-contract";

export type { Vault, VaultEntry } from "./vault-contract";

export function createPlatformVault(): Vault {
  return Capacitor.isNativePlatform() ? new CapacitorVault() : new OpfsVault();
}
