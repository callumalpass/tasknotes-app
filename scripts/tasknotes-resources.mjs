import { buildTaskNotesStarterResources } from "@tasknotes/model/starter";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { loadCanonicalTaskNotesTypePack } from "./canonical-task-pack.mjs";

// Exercise the same seed bytes as app setup, even between model releases.
export async function buildAppTaskNotesResources() {
  const resources = buildTaskNotesStarterResources();
  const pack = await loadCanonicalTaskNotesTypePack();
  const seed = pack.manifest.resources.find(
    ({ target }) => target === "_types/task.md",
  );
  const typeDocument = pack.resources.find(
    ({ source }) => source === seed?.source,
  )?.document;
  if (!typeDocument) throw new Error("The TaskNotes pack has no task seed.");
  return {
    ...resources,
    typeDocument,
    type: parseFrontmatter(typeDocument).frontmatter,
  };
}
