import { cloneDefaultModelConfig } from "@tasknotes/model/defaults";
import { serializeMarkdownDocument } from "@tasknotes/model/frontmatter";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";

export function buildAppTaskNotesResources() {
  const modelConfig = cloneDefaultModelConfig();
  modelConfig.statuses.push({
    id: "cancelled",
    value: "cancelled",
    label: "Cancelled",
    color: "#808080",
    isCompleted: false,
    isSkipped: true,
    excludeFromCycle: true,
    order: modelConfig.statuses.length,
    autoArchive: false,
    autoArchiveDelay: 5,
  });
  const resources = buildTaskNotesMdbaseResources({
    profiles: ["core-lite", "recurrence", "materialized-occurrences"],
    modelConfig,
  });
  const type = structuredClone(resources.type);
  const implementation = type.implements.find(
    (candidate) =>
      candidate.contract === "tasknotes.task" &&
      candidate.version === "0.3.0-rc.1",
  );
  if (!implementation)
    throw new Error(
      "The generated type does not implement tasknotes.task 0.3.0-rc.1.",
    );
  const extension = implementation.binding;
  const sortOrderField = implementation.fields.sortOrder;
  type.schema.value.properties[sortOrderField] = { type: "string" };
  extension.status = {
    ...extension.status,
    skipped_values: ["cancelled"],
    default_skipped: "cancelled",
  };
  extension.occurrences = {
    ...extension.occurrences,
    default_materialization: modelConfig.occurrences.defaultMaterialization,
    default_next_trigger: modelConfig.occurrences.defaultNextTrigger,
    past_horizon: modelConfig.occurrences.pastHorizon,
    future_horizon: modelConfig.occurrences.futureHorizon,
  };
  const body = `# Task

Task records live under \`${resources.paths.records}/\`.
`;
  return {
    ...resources,
    type,
    typeDocument: serializeMarkdownDocument(type, body),
  };
}
