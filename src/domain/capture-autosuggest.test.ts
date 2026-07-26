import { describe, expect, it } from "vitest";

import {
  activeCaptureToken,
  applyCaptureSuggestion,
  captureSuggestionRequest,
  captureTriggers,
} from "./capture-autosuggest";
import { defaultTaskCollectionConfiguration } from "./task-configuration";

describe("capture autosuggestions", () => {
  it("omits triggers disabled by the collection contract", () => {
    const configuration = {
      ...defaultTaskCollectionConfiguration(),
      nlp: {
        triggers: [
          { propertyId: "tags", trigger: "##", enabled: true },
          { propertyId: "priority", trigger: "!", enabled: false },
        ],
      },
    };

    expect(captureTriggers(configuration)).toEqual([
      { propertyId: "tags", trigger: "##", enabled: true },
    ]);
  });

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
