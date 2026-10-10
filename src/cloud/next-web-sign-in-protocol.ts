import type {
  AppWebCollectionHandoff,
  AppWebSignInSnapshot,
} from "@mdbase-dev/sdk/app-host";
import type { NextInstallationBuildInput } from "./next-installation-protocol";

/** Command replies, session snapshots, portal events and data handoffs are
 * separate messages. A push must never resolve an unrelated command. */
export type NextWebSignInCommand =
  | { kind: "open"; build: NextInstallationBuildInput; requestedCreateCollections?: boolean }
  | { kind: "start" | "authorize" | "renew-expired" | "clear-selection" | "close" }
  | { kind: "select"; collectionId: string }
  | { kind: "set-foreground"; active: boolean };
export interface NextWebSignInRequest {
  schema: "tasknotes-web-sign-in-request/1";
  id: number;
  command: NextWebSignInCommand;
}
export type NextWebSignInMessage =
  | { schema: "tasknotes-web-sign-in-reply/1"; id: number; ok: true; snapshot: AppWebSignInSnapshot | null }
  | { schema: "tasknotes-web-sign-in-reply/1"; id: number; ok: false; reason: string }
  | { schema: "tasknotes-web-sign-in-snapshot/1"; snapshot: AppWebSignInSnapshot }
  | { schema: "tasknotes-web-sign-in-portal/1"; action: "navigate"; uri: string }
  | { schema: "tasknotes-web-sign-in-portal/1"; action: "close" }
  | { schema: "tasknotes-web-sign-in-handoff/1"; handoff: AppWebCollectionHandoff };

export function isNextWebSignInRequest(value: unknown): value is NextWebSignInRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (Object.keys(request).sort().join() !== "command,id,schema" ||
    request.schema !== "tasknotes-web-sign-in-request/1" ||
    !Number.isInteger(request.id) || (request.id as number) < 1 || (request.id as number) > 0xffffffff)
    return false;
  const command = request.command as Record<string, unknown>;
  if (!command || typeof command !== "object" || Array.isArray(command)) return false;
  const keys = Object.keys(command).sort().join();
  switch (command.kind) {
    case "open":
      return (keys === "build,kind" || keys === "build,kind,requestedCreateCollections") &&
        !!command.build && typeof command.build === "object" && !Array.isArray(command.build) &&
        (command.requestedCreateCollections === undefined || typeof command.requestedCreateCollections === "boolean");
    case "select":
      return keys === "collectionId,kind" && typeof command.collectionId === "string" &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(command.collectionId) &&
        command.collectionId !== "00000000-0000-0000-0000-000000000000";
    case "set-foreground":
      return keys === "active,kind" && typeof command.active === "boolean";
    case "start": case "authorize": case "renew-expired": case "clear-selection": case "close":
      return keys === "kind";
    default:
      return false;
  }
}
