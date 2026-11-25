import type { MdbaseClient } from "@mdbase-dev/sdk";
import type { AppBasesRequest, AppBasesResult } from "@mdbase-dev/sdk/app-host";

/** Stand-in for the replica's `rowProperties` projection: each row gains its
 * record's catalog types and the requested effective properties, read through
 * the client's current `get` so a test's record stand-ins still apply. */
export async function projectRowsLikeReplica(
  client: Pick<MdbaseClient, "get">,
  request: AppBasesRequest,
  result: AppBasesResult,
): Promise<AppBasesResult> {
  const names = request.rowProperties;
  if (result.kind !== "success" || names === undefined) return result;
  return {
    ...result,
    rows: await Promise.all(
      result.rows.map(async (row) => {
        if (row.types !== undefined && row.properties !== undefined) return row;
        const record = await client.get(row.record, {
          include: { effective: true },
        });
        const values = record.effective ?? record.frontmatter;
        return {
          ...row,
          types: [...record.types],
          properties: Object.fromEntries(
            names.flatMap((name) =>
              Object.hasOwn(values, name) ? [[name, values[name]!]] : [],
            ),
          ),
        };
      }),
    ),
  };
}
