import { describe, expect, it } from "vitest";
import {
  connectSuccess,
  MdbaseCollectionClient,
} from "@mdbase-dev/connect/advanced";

describe("packaged legacy query compatibility", () => {
  it("uses string selections accepted by beta.126 and restores named metadata", async () => {
    let calls = 0;
    const client = new MdbaseCollectionClient(
      {
        async operation<Result>(_operation: string, raw: unknown) {
          calls++;
          const input = raw as {
            select: unknown[];
            projections: Record<string, { expr: string }>;
          };
          // beta.126 QueryRequest.select is Option<Vec<String>>, not maps.
          expect(input.select.every((field) => typeof field === "string")).toBe(
            true,
          );
          const alias = (input.select[0] as string).replace("projection.", "");
          expect(input.projections[alias].expr).toBe("record.title");
          return {
            valid: true,
            diagnostics: [],
            result: {
              output: "metadata",
              results: [
                {
                  path: "one.md",
                  types: ["task"],
                  revision: "opaque:1",
                  values: { [alias]: "Example" },
                },
              ],
              meta: { has_more: false },
            },
          } as Result;
        },
      },
      1000,
      async () => connectSuccess(true),
    );
    expect(
      await client.query({
        output: "metadata",
        select: [{ name: "title", expression: "record.title" }],
      }),
    ).toMatchObject({
      ok: true,
      value: { results: [{ values: { title: "Example" } }] },
    });
    expect(calls).toBe(1);
  });
});
