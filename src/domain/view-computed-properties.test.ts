import { describe, expect, it } from "vitest";

import { validateComputedProperties } from "./view-computed-properties";

describe("view computed properties", () => {
  it("validates Obsidian formula syntax and dependency cycles", () => {
    expect(
      validateComputedProperties("obsidian-bases", [
        {
          name: "score",
          expression: 'if(priority == "high", 2, 1)',
          scope: "source",
        },
        {
          name: "label",
          expression: 'formula.score.toString() + " points"',
          scope: "source",
        },
      ]),
    ).toBe("");
    expect(
      validateComputedProperties("obsidian-bases", [
        {
          name: "first",
          expression: "formula.second",
          scope: "source",
        },
        {
          name: "second",
          expression: "formula.first",
          scope: "source",
        },
      ]),
    ).toContain("dependency cycle");
  });

  it("protects canonical shared projections from view-only dependencies", () => {
    expect(
      validateComputedProperties("mdbase-cel", [
        {
          name: "shared",
          expression: "projection.local",
          scope: "source",
        },
        {
          name: "local",
          expression: "priority",
          scope: "view",
        },
      ]),
    ).toContain("cannot depend on the view-only property");
  });

  it("reports incomplete, duplicate, and unknown definitions", () => {
    expect(
      validateComputedProperties("mdbase-cel", [
        { name: "", expression: "priority", scope: "view" },
      ]),
    ).toContain("name");
    expect(
      validateComputedProperties("mdbase-cel", [
        { name: "score", expression: "", scope: "view" },
      ]),
    ).toContain("needs an expression");
    expect(
      validateComputedProperties("mdbase-cel", [
        { name: "score", expression: "priority", scope: "view" },
        { name: "score", expression: "due", scope: "source" },
      ]),
    ).toContain("defined more than once");
    expect(
      validateComputedProperties("mdbase-cel", [
        {
          name: "score",
          expression: 'projection["missing"] + 1',
          scope: "view",
        },
      ]),
    ).toContain("unknown computed property");
  });
});
