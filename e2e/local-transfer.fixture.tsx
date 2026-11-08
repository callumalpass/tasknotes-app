import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppI18nProvider } from "../src/i18n/app-provider";
import { LocalTaskRepository } from "../src/storage/local-task-repository";
import { SnapshotTaskRepository } from "../src/storage/snapshot-task-repository";
import { TaskNotesTaskModel } from "../src/domain/tasknotes-model";
import type { TaskImportPort } from "../src/application/ports/task-import";
import { LocalTransferDialog } from "../src/app/local-transfer";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/azeret-mono/500.css";
import "../src/styles.css";
import "../src/people.css";
import "../src/accessibility.css";

if (import.meta.env.MODE !== "e2e") throw new Error("e2e fixture only");
const local = new LocalTaskRepository(`local-transfer-${crypto.randomUUID()}`);
await local.initialize();
await local.create({ title: "Before connecting", body: "Keep these Notes" });
const destination = new SnapshotTaskRepository();
const configuration = await destination.taskConfiguration();
if (new URL(location.href).searchParams.has("required")) {
  configuration.userFields = [
    {
      id: "client",
      key: "client",
      displayName: "Client",
      type: "text",
      required: true,
    },
  ];
}
const model = new TaskNotesTaskModel(configuration);
const imports: TaskImportPort = {
  targets: async () =>
    ["task", "work"].map((typeName) => ({
      typeName,
      configuration,
      fingerprint: "interaction-fixture",
    })),
  prepareTask: async (task, target, id) => {
    const imported = model.importTask(task, id);
    return {
      key: task.id,
      id,
      type: target.typeName,
      path: imported.path,
      frontmatter: imported.frontmatter,
      body: imported.body,
    };
  },
  // The test controls only destination confirmation. The dialog, ledger, local
  // persistence, browser locks and overlay stack are the production code.
  write: async () => {
    const response = await fetch("/e2e/local-transfer-write", {
      method: "POST",
    });
    if (!response.ok) throw new Error("connection interrupted");
  },
};
Object.assign(destination, { imports });

export function LocalTransferFixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Review local tasks</button>
      {open ? (
        <LocalTransferDialog
          local={local}
          destination={destination}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppI18nProvider>
      <LocalTransferFixture />
    </AppI18nProvider>
  </StrictMode>,
);
