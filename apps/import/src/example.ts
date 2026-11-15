import YAML from "yaml";
import pack from "../../../vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.21.json";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import type { DestinationType } from "./plan";
import type { SourceData } from "./todoist";

const taskResource = pack.manifest.resources.find(
  (resource) =>
    resource.kind === "type" && resource.target === "_types/task.md",
)!;
const definition = YAML.parse(
  pack.resources
    .find((resource) => resource.source === taskResource.source)!
    .document.split("\n---\n")[0],
);
const implementation = definition.implements.find(
  (candidate: { contract: string; version: string }) =>
    candidate.contract === "tasknotes.task" &&
    candidate.version === TASKNOTES_SPEC_VERSION,
);
export const exampleTarget: DestinationType = {
  name: definition.name,
  schema: definition.schema.value,
  definition,
  fields: implementation.fields,
  binding: implementation.binding,
};
export const exampleSource: SourceData = {
  userId: "example-account",
  projects: [
    { id: "work", name: "Work" },
    { id: "personal", name: "Personal" },
  ],
  sections: [{ id: "next", name: "Next up", project_id: "work" }],
  tasks: [
    {
      id: "brief",
      content: "Write the project brief",
      description:
        "A clear problem statement, a few constraints, and a first step.\n\n- [ ] Gather notes\n- [ ] Share a draft",
      project_id: "work",
      section_id: "next",
      priority: 1,
      labels: ["writing"],
      due: { date: "2026-10-02", is_recurring: false },
      deadline: { date: "2026-10-05" },
      duration: { amount: 45, unit: "minute" },
    },
    {
      id: "review",
      content: "Weekly review",
      description: "Make a little room for the week ahead.",
      project_id: "personal",
      priority: 3,
      labels: ["routine"],
      due: {
        date: "2026-10-04",
        string: "every week",
        lang: "en",
        is_recurring: true,
      },
    },
    {
      id: "plants",
      content: "Water the plants",
      description: "",
      project_id: "personal",
      priority: 4,
      labels: [],
      due: {
        date: "2026-10-03",
        string: "every! 3 days",
        lang: "en",
        is_recurring: true,
      },
    },
  ],
};
