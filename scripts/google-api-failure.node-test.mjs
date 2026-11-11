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

test("Google quota and rate limits map to one fixed reason without the body", async () => {
  for (const [status, error] of [
    [429, { message: "private message" }],
    [403, { message: "private", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] }],
    [403, { message: "private", errors: [{ reason: "rateLimitExceeded" }] }],
    [
      403,
      { message: "private", errors: [{ reason: "userRateLimitExceeded" }] },
    ],
    [429, { message: "private", errors: [{ reason: "quotaExceeded" }] }],
    [503, { message: "private", details: [{ reason: "RESOURCE_EXHAUSTED" }] }],
  ]) {
    const failure = await googleApiFailure(
      Response.json({ error }, { status }),
    );
    assert.equal(failure.reason, "quota-or-rate-limited");
    assert.equal(failure.httpStatus, status);
    assert.equal(JSON.stringify(failure).includes("private"), false);
  }
  for (const body of [
    { error: { errors: "private" } },
    { error: { errors: [{ reason: "private-reason" }] } },
  ]) {
    const failure = await googleApiFailure(
      Response.json(body, { status: 403 }),
    );
    assert.equal(failure.reason, "permission-denied");
  }
});
