import { buildTaskNotesStarterResources } from "@tasknotes/model/starter";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { loadCanonicalTaskNotesTypePack } from "./canonical-task-pack.mjs";

// Exercise the same seed bytes as app setup, even between model releases.
export async function buildAppTaskNotesResources() {
  const resources = buildTaskNotesStarterResources();
  const pack = await loadCanonicalTaskNotesTypePack();
  const packDocument = (kind, target) => {
    const resource = pack.manifest.resources.find(
      (entry) => entry.kind === kind && entry.target === target,
    );
    const document = pack.resources.find(
      ({ source }) => source === resource?.source,
    )?.document;
    if (!document) throw new Error(`The TaskNotes pack is missing ${target}.`);
    return document;
  };
  const typeDocument = packDocument("type", "_types/task.md");
  const taskSchemaDocument = packDocument(
    "schema",
    "_schemas/tasknotes/tasknotes-task.schema.json",
  );
  const bindingSchemaDocument = packDocument(
    "schema",
    "_schemas/tasknotes/tasknotes-task-binding.schema.json",
  );
  const contractPath = "_contracts/tasknotes.task/0.3.0-rc.7.md";
  const contractDocument = packDocument("contract", contractPath);
  return {
    ...resources,
    typeDocument,
    type: parseFrontmatter(typeDocument).frontmatter,
    taskSchemaDocument,
    taskSchema: JSON.parse(taskSchemaDocument),
    bindingSchemaDocument,
    contractDocument,
  };
}
