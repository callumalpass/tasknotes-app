import { MDBASE_TIMER_FIRED_CONTRACT } from "@mdbase-dev/connect-protocol";
import { loadCanonicalTaskNotesTypePack } from "./canonical-task-pack.mjs";
import { buildScratchpadTypePack } from "./scratchpad-type.mjs";
import { buildScratchImageTypePack } from "./scratch-image-type.mjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export { TASKNOTES_APP_TYPE_PACK_VERSION } from "./canonical-task-pack.mjs";

export async function buildTaskNotesManifest({
  appUrl,
  webOnly,
  firebaseProjectId,
}) {
  // Keep the application identity and callback on the same origin. Local
  // manifests are accepted only by development validation; external local
  // authorization should use a public tunnel and TASKNOTES_APP_URL.
  const identityUrl = appUrl;
  const typePack = await loadCanonicalTaskNotesTypePack();
  // Saved views are records: Bases through obsidian.base (YAML document
  // records) and mdbase views through mdbase.view. The published packs are
  // embedded byte for byte.
  const viewPack = async (file) =>
    JSON.parse(
      await readFile(
        resolve(process.cwd(), "vendor/mdbase-contracts", file),
        "utf8",
      ),
    );
  const basePack = await viewPack("obsidian.base-1.0.0.json");
  const mdbaseViewPack = await viewPack("mdbase.view-1.0.0.json");
  const taskContract = typePack.provides.find(
    (contract) => contract.id === "tasknotes.task",
  );
  if (!taskContract)
    throw new Error("TaskNotes pack provides no task contract.");
  return {
    manifest_version: 1,
    id: "dev.tasknotes.app",
    name: "TaskNotes",
    homepage: `${identityUrl}/`,
    icon: `${identityUrl}/icon.png`,
    redirect_uris: [
      `${identityUrl}/auth/mdbase/callback`,
      ...(!webOnly ? ["dev.tasknotes.app://auth/mdbase/callback"] : []),
    ],
    requirements: {
      people: { version: 1, optional: ["identity", "members"] },
      contracts: [
        taskContract,
        ...basePack.provides,
        ...mdbaseViewPack.provides,
      ],
      capabilities: {
        contract_version: 2,
        required: [
          "collection.read",
          "records.create",
          "records.edit",
          "records.delete",
          "definitions.manage",
          "background.schedule",
        ],
      },
      access: "full_collection",
      files: {
        required: ["list", "read", "add", "replace", "move", "delete"],
        scope: { kind: "collection" },
      },
      configuration: [
        {
          id: "tasknotes-base-sources",
          path: "/x-obsidian/bases/include",
          predicate: "contains",
          value: "TaskNotes/Views/**/*.base",
        },
        // record_extensions is the complete set, so keep Markdown explicitly
        // when adding Bases.
        {
          id: "tasknotes-markdown-records",
          path: "/settings/record_extensions",
          predicate: "contains",
          value: "md",
        },
        {
          id: "tasknotes-base-records",
          path: "/settings/record_extensions",
          predicate: "contains",
          value: "base",
        },
      ],
    },
    provisions: {
      type_packs: [
        typePack,
        buildScratchpadTypePack(),
        buildScratchImageTypePack(),
        basePack,
        mdbaseViewPack,
      ],
      configuration: [
        {
          requirement: "tasknotes-base-sources",
          operation: "set_add",
          path: "/x-obsidian/bases/include",
          value: "TaskNotes/Views/**/*.base",
        },
        {
          requirement: "tasknotes-markdown-records",
          operation: "set_add",
          path: "/settings/record_extensions",
          value: "md",
        },
        {
          requirement: "tasknotes-base-records",
          operation: "set_add",
          path: "/settings/record_extensions",
          value: "base",
        },
      ],
    },
    notifications: {
      criteria: [
        {
          id: "task.reminder",
          event: MDBASE_TIMER_FIRED_CONTRACT,
          presentation: {
            title: "Task reminder",
            body: "Open TaskNotes to view your task.",
            tag: "tasknotes-reminders",
          },
        },
      ],
      ...(firebaseProjectId
        ? {
            native_delivery: {
              mode: "managed_fcm",
              firebase_project_id: firebaseProjectId,
            },
          }
        : {}),
    },
  };
}
