import { describe, expect, it } from "vitest";

import {
  activeCaptureToken,
  applyCaptureSuggestion,
  captureSuggestionRequest,
  captureSuggestionText,
  captureTriggers,
  linkCapturedProjects,
} from "./capture-autosuggest";
import { defaultTaskCollectionConfiguration } from "./task-configuration";

import type { FieldCompletion } from "./completion";

describe("capture autosuggestions", () => {
  it("finds configured multi-character triggers at the cursor", () => {
    const token = activeCaptureToken("Plan release ##mob later", 18, [
      { propertyId: "tags", trigger: "##", enabled: true },
    ]);

    expect(token).toEqual({
      propertyId: "tags",
      trigger: "##",
      query: "mob",
      start: 13,
      end: 18,
    });
  });

  it("maps stable property ids to configured completion fields", () => {
    const configuration = defaultTaskCollectionConfiguration();
    const token = activeCaptureToken(
      "Work @ho",
      8,
      captureTriggers(configuration),
    );

    expect(token).toBeDefined();
    expect(captureSuggestionRequest(token!, configuration)).toMatchObject({
      field: configuration.fieldMapping.contexts,
      kind: "values",
      query: "ho",
      limit: 8,
    });
  });

  it("replaces the active token and leaves the cursor ready for more text", () => {
    expect(
      applyCaptureSuggestion(
        "Work @ho",
        {
          propertyId: "contexts",
          trigger: "@",
          query: "ho",
          start: 5,
          end: 8,
        },
        "home",
      ),
    ).toEqual({ text: "Work @home ", cursor: 11 });
  });
});

describe("project names in capture", () => {
  const configuration = defaultTaskCollectionConfiguration();
  const operations: FieldCompletion = {
    kind: "value",
    value: "[[Projects/Operations]]",
    label: "Operations",
  };

  it("writes a linked suggestion by name", () => {
    expect(captureSuggestionText(operations)).toBe("Operations");
    expect(
      captureSuggestionText({
        kind: "record",
        value: "[[Projects/Field Work|Field Work]]",
        label: "Field Work",
      }),
    ).toBe("[[Field Work]]");
    expect(
      captureSuggestionText({ kind: "value", value: "home", label: "Home" }),
    ).toBe("home");
  });

  it("links a typed name to the one project it names", async () => {
    const result = await linkCapturedProjects(
      { title: "Stamps", projects: ["operations"] },
      configuration,
      async () => [operations],
    );
    expect(result.projects).toEqual([operations.value]);
  });

  it("prefers a project in use over a note of the same name", async () => {
    const result = await linkCapturedProjects(
      { title: "Stamps", projects: ["Operations"] },
      configuration,
      async () => [
        operations,
        {
          kind: "record",
          value: "[[Archive/Operations]]",
          label: "Operations",
        },
      ],
    );
    expect(result.projects).toEqual([operations.value]);
  });

  it.each([
    [
      "no project has that name",
      [
        {
          ...operations,
          label: "Operations old",
          value: "[[Projects/Operations old]]",
        },
      ],
    ],
    [
      "two records share it",
      [
        {
          kind: "record" as const,
          value: "[[A/Operations]]",
          label: "Operations",
        },
        {
          kind: "record" as const,
          value: "[[B/Operations]]",
          label: "Operations",
        },
      ],
    ],
  ])("keeps the name as typed when %s", async (_, matches) => {
    const result = await linkCapturedProjects(
      { title: "Stamps", projects: ["Operations"] },
      configuration,
      async () => matches,
    );
    expect(result.projects).toEqual(["Operations"]);
  });

  it("keeps the name as typed when the lookup fails", async () => {
    const result = await linkCapturedProjects(
      { title: "Stamps", projects: ["Operations"] },
      configuration,
      () => Promise.reject(new Error("offline")),
    );
    expect(result.projects).toEqual(["Operations"]);
  });
});
