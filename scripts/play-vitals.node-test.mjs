import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { assessVitalsRows, readPlayVitals } from "./play-vitals.mjs";
const HOUR = 3_600_000,
  end = Date.UTC(2026, 10, 7, 12),
  start = end - 6 * HOUR;
const dt = (ms) => {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    timeZone: { id: "UTC" },
  };
};
function payload(metric = "userPerceivedCrashRate") {
  return {
    rows: Array.from({ length: 6 }, (_, i) => ({
      aggregationPeriod: "HOURLY",
      startTime: dt(start + i * HOUR),
      dimensions: [{ dimension: "versionCode", int64Value: "123" }],
      metrics: [
        { metric, decimalValue: { value: "0" } },
        { metric: "distinctUsers", decimalValue: { value: "100" } },
      ],
    })),
  };
}
test("exact version, six complete hours, zero crashes and sufficient sample required", () => {
  assert.equal(
    assessVitalsRows(payload(), "userPerceivedCrashRate", 123, start, end),
    "passed",
  );
  for (const mutate of [
    (p) => p.rows.pop(),
    (p) => (p.rows[0].dimensions[0].int64Value = "999"),
    (p) => (p.rows[0].metrics[1].decimalValue.value = "10"),
    (p) => (p.rows[0].metrics[0].decimalValue.value = "NaN"),
    (p) => (p.nextPageToken = "more"),
    (p) => (p.rows[0].startTime = dt(start - HOUR)),
  ]) {
    const p = payload();
    mutate(p);
    assert.equal(
      assessVitalsRows(p, "userPerceivedCrashRate", 123, start, end),
      "insufficient",
    );
  }
  const p = payload();
  p.rows[0].metrics[1].decimalValue.value = "10";
  p.rows[5].metrics[0].decimalValue.value = "0.001";
  assert.equal(
    assessVitalsRows(p, "userPerceivedCrashRate", 123, start, end),
    "failed",
  );
});
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credential = Buffer.from(
  JSON.stringify({
    type: "service_account",
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  }),
).toString("base64");
test("Reporting uses its own OAuth scope and exact-version queries; no raw data retained", async () => {
  const requests = [];
  const result = await readPlayVitals(credential, {
    versionCode: 123,
    since: start - HOUR,
    now: end + HOUR,
    fetchImpl: async (url, options) => {
      requests.push(url);
      if (url.includes("oauth2")) {
        const assertion = options.body.get("assertion"),
          claim = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url"));
        assert.equal(
          claim.scope,
          "https://www.googleapis.com/auth/playdeveloperreporting",
        );
        return Response.json({ access_token: "test" });
      }
      if (options.method === "GET")
        return Response.json({
          freshnessInfo: {
            freshnesses: [
              { aggregationPeriod: "HOURLY", latestEndTime: dt(end) },
            ],
          },
        });
      const body = JSON.parse(options.body);
      assert.equal(body.filter, "versionCode = 123");
      assert.deepEqual(body.dimensions, ["versionCode"]);
      return Response.json(payload(body.metrics[0]));
    },
  });
  assert.equal(result.verdict, "passed");
  assert.equal(requests.length, 5);
  assert.equal("rows" in result, false);
});
test("disabled API/permission uses named infrastructure fallback, not a passing Vitals verdict", async () => {
  const result = await readPlayVitals(credential, {
    fetchImpl: async (url) =>
      url.includes("oauth2")
        ? Response.json({ access_token: "test" })
        : Response.json({ private: "do not log" }, { status: 403 }),
  });
  assert.equal(result.available, false);
  assert.equal(result.httpStatus, 403);
  assert.equal(result.signal, "connect-cp-provider-readiness-only");
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("an observed crash still fails if the later ANR API read is denied", async () => {
  const result = await readPlayVitals(credential, {
    versionCode: 123,
    since: start - HOUR,
    now: end + HOUR,
    fetchImpl: async (url, options) => {
      if (url.includes("oauth2"))
        return Response.json({ access_token: "test" });
      if (url.includes("anrRateMetricSet"))
        return Response.json(
          { error: { message: "private" } },
          { status: 403 },
        );
      if (options.method === "GET")
        return Response.json({
          freshnessInfo: {
            freshnesses: [
              { aggregationPeriod: "HOURLY", latestEndTime: dt(end) },
            ],
          },
        });
      const p = payload();
      p.rows[0].metrics[0].decimalValue.value = "0.1";
      return Response.json(p);
    },
  });
  assert.equal(result.available, false);
  assert.equal(result.verdict, "failed");
  assert.equal(result.signal, "android-vitals-exact-version");
});
