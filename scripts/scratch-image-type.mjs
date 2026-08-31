import { createHash } from "node:crypto";

export const scratchImageTypeDocument = `---
kind: mdbase.type
name: tasknotes-scratch-image
version: 1
description: An independent image card in the TaskNotes Scratchpad feed.
match:
  where:
    type:
      eq: tasknotes-scratch-image
schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: true
    required: [type, id, dateCreated, dateModified, file, digest, size, mediaType]
    properties:
      type: { const: tasknotes-scratch-image }
      id: { type: string, minLength: 1 }
      dateCreated: { type: string, format: date-time }
      dateModified: { type: string, format: date-time }
      file: { type: string, minLength: 1 }
      digest: { type: string, pattern: '^sha256:[0-9a-f]{64}$' }
      size: { type: integer, minimum: 0 }
      mediaType: { type: string, pattern: '^image/' }
      width: { type: integer, minimum: 1 }
      height: { type: integer, minimum: 1 }
      caption: { type: string }
collection:
  path:
    folder: TaskNotes/Scratchpad/Image Metadata
    template: "{{id}}"
  unique:
    - field: id
      scope: type
---
# TaskNotes Scratchpad image

This metadata record places one independently stored collection image in the
Scratchpad feed. Removing this record does not remove the referenced file.
`;

export function buildScratchImageTypePack() {
  const source = "types/tasknotes-scratch-image.md";
  return {
    manifest: {
      kind: "mdbase.type-pack",
      id: "tasknotes.scratch-image",
      version: "1.1.0",
      name: "TaskNotes Scratchpad image",
      description: "Typed independent image feed records managed by TaskNotes.",
      resources: [
        {
          kind: "type",
          mode: "seed",
          source,
          target: "_types/tasknotes-scratch-image.md",
          digest: `sha256:${createHash("sha256").update(scratchImageTypeDocument).digest("hex")}`,
        },
      ],
    },
    resources: [{ source, document: scratchImageTypeDocument }],
    provides: [],
  };
}
