import { cloneDefaultModelConfig } from "@tasknotes/model/defaults";
import { serializeMarkdownDocument } from "@tasknotes/model/frontmatter";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";

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
  const taskSchema = structuredClone(resources.taskSchema);
  const implementation = type.implements.find(
    (candidate) =>
      candidate.contract === "tasknotes.task" &&
      candidate.version === TASKNOTES_SPEC_VERSION,
  );
  if (!implementation)
    throw new Error(
      `The generated type does not implement tasknotes.task ${TASKNOTES_SPEC_VERSION}.`,
    );
  const taskDateSchema = {
    anyOf: [
      { type: "string", format: "date" },
      { type: "string", format: "date-time" },
    ],
  };
  type.schema.value.properties[implementation.fields.due] = taskDateSchema;
  type.schema.value.properties[implementation.fields.scheduled] =
    taskDateSchema;
  taskSchema.properties.due = taskDateSchema;
  taskSchema.properties.scheduled = taskDateSchema;
  const extension = implementation.binding;
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
    taskSchema,
    taskSchemaDocument: `${JSON.stringify(taskSchema, null, 2)}\n`,
    typeDocument: serializeMarkdownDocument(type, body),
  };
}
