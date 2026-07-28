import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { describe, expect, it } from "vitest";

import { upgradeManagedTaskType } from "./collection-migration";

describe("managed TaskNotes type upgrades", () => {
  it("adds the portable materialized-occurrence contract idempotently", () => {
    const original = parseFrontmatter(
      buildTaskNotesMdbaseResources({ profiles: ["core-lite"] }).typeDocument,
    ).frontmatter;
    original.description = "A TaskNotes-compatible task.";
    const schema = original.schema as {
      value: { properties: Record<string, unknown> };
    };
    schema.value.properties.mobileRevision = { type: "integer" };
    const implementation = (
      original.implements as Array<Record<string, unknown>>
    ).find(
      (candidate) =>
        candidate.contract === "tasknotes.task" &&
        candidate.version === "0.3.0-rc.1",
    )!;
    const extension = implementation.binding as Record<string, unknown>;
    extension.profiles = ["core-lite"];
    delete extension.occurrences;
    extension.status = {
      ...(extension.status as Record<string, unknown>),
      values: ["none", "open", "in-progress", "done"],
      skipped_values: [],
    };
    (schema.value.properties.status as Record<string, unknown>).enum = [
      "none",
      "open",
      "in-progress",
      "done",
    ];
    const upgraded = upgradeManagedTaskType(original);
    expect(upgraded.changed).toBe(true);
    const upgradedImplementation = (
      upgraded.frontmatter.implements as Array<Record<string, unknown>>
    ).find(
      (candidate) =>
        candidate.contract === "tasknotes.task" &&
        candidate.version === "0.3.0-rc.1",
    )!;
    const upgradedExtension = upgradedImplementation.binding as Record<
      string,
      unknown
    >;
    expect(upgradedExtension).toMatchObject({
      profiles: expect.arrayContaining([
        "core-lite",
        "recurrence",
        "materialized-occurrences",
      ]),
      status: {
        values: ["none", "open", "in-progress", "done", "cancelled"],
        skipped_values: ["cancelled"],
        default_skipped: "cancelled",
      },
      occurrences: {
        identity_roles: ["recurrenceParent", "occurrenceDate"],
        default_materialization: "manual",
        default_next_trigger: "completion",
        past_horizon: "P0D",
        future_horizon: "P14D",
      },
    });
    const status = (
      (
        (upgraded.frontmatter.schema as Record<string, unknown>)
          .value as Record<string, unknown>
      ).properties as Record<string, Record<string, unknown>>
    ).status;
    expect(status.enum).toContain("cancelled");
    expect(upgradeManagedTaskType(upgraded.frontmatter).changed).toBe(false);
  });
});
