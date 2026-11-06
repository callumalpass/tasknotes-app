import assert from "node:assert/strict";
import test from "node:test";
import { googleApiFailure } from "./google-api-failure.mjs";
test("Google failures retain only fixed public reason enums and HTTP status", async () => {
  for (const [detail, expected] of [
    ["SERVICE_DISABLED", "api-service-disabled"],
    ["ACCESS_TOKEN_SCOPE_INSUFFICIENT", "oauth-scope-insufficient"],
    ["unreviewed-private-reason", "permission-denied"],
  ]) {
    const error = await googleApiFailure(
      Response.json(
        {
          error: {
            message: "private message",
            details: [
              { reason: detail, metadata: { consumer: "private-project" } },
            ],
          },
        },
        { status: 403 },
      ),
    );
    assert.equal(error.reason, expected);
    assert.equal(error.httpStatus, 403);
    assert.equal(error.message, "google-api-observation-unavailable");
    assert.equal(JSON.stringify(error).includes("private"), false);
  }
});
