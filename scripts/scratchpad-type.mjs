import { createHash } from "node:crypto";

export const scratchpadTypeDocument = `---
kind: mdbase.type
name: tasknotes-scratch
version: 1
description: A working outline managed by TaskNotes.
match:
  where:
    type:
      eq: tasknotes-scratch
schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: true
    required: [type, id, state, dateCreated, dateModified]
    properties:
      type:
        const: tasknotes-scratch
      id:
        type: string
        minLength: 1
      state:
        enum: [active, converted]
      title:
        type: string
      dateCreated:
        type: string
        format: date-time
      dateModified:
        type: string
        format: date-time
      dateConverted:
        type: string
        format: date-time
collection:
  path:
    folder: scratchpads
    template: "{{title}}"
  display:
    name_field: title
  unique:
    - field: id
      scope: type
lifecycle:
  on_create:
    set:
      id:
        uuid: true
      dateCreated:
        now: true
      dateModified:
        now: true
  on_update:
    set:
      dateModified:
        now: true
---
# TaskNotes scratchpad

Scratchpads are Markdown outlines. Checkbox items are draft tasks, plain
bullets are notes, and links point to TaskNotes created from the outline.
`;

export function buildScratchpadTypePack() {
  const source = "types/tasknotes-scratch.md";
  return {
    manifest: {
      kind: "mdbase.type-pack",
      id: "tasknotes.scratch",
      version: "1.0.0",
      name: "TaskNotes scratchpad",
      description: "Typed working outlines managed by TaskNotes.",
      resources: [
        {
          kind: "type",
          mode: "seed",
          source,
          target: "_types/tasknotes-scratch.md",
          digest: `sha256:${createHash("sha256").update(scratchpadTypeDocument).digest("hex")}`,
        },
      ],
    },
    resources: [{ source, document: scratchpadTypeDocument }],
    provides: [],
  };
}
