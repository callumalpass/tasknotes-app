import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { describe, expect, it } from "vitest";

import { upgradeManagedTaskType } from "./collection-migration";

describe("managed TaskNotes type upgrades", () => {
  it("adds the portable materialized-occurrence contract idempotently", () => {
    const original = parseFrontmatter(
      buildTaskNotesMdbaseResources({ profiles: ["core-lite"] }).typeDocument,
    ).frontmatter;
    const upgraded = upgradeManagedTaskType(original);
    expect(upgraded.changed).toBe(true);
    const extension = upgraded.frontmatter["x-tasknotes"] as Record<
      string,
      unknown
    >;
    expect(extension).toMatchObject({
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
