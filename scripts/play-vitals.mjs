import { writeFile } from "node:fs/promises";
import {
  PLAY_PACKAGE,
  parseServiceAccount,
  exchangeAccessToken,
} from "./publish-google-play.mjs";
const SCOPE = "https://www.googleapis.com/auth/playdeveloperreporting";
const ROOT = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${PLAY_PACKAGE}`;
const SETS = [
  ["crashRateMetricSet", "userPerceivedCrashRate"],
  ["anrRateMetricSet", "userPerceivedAnrRate"],
];
const HOUR = 3_600_000;
function utc(value) {
  if (value?.timeZone?.id !== "UTC" && value?.utcOffset !== "0s") return NaN;
  const parts = [
    value.year,
    value.month,
    value.day,
    value.hours ?? 0,
    value.minutes ?? 0,
    value.seconds ?? 0,
  ];
  if (!parts.every(Number.isInteger)) return NaN;
  const result = Date.UTC(parts[0], parts[1] - 1, ...parts.slice(2));
  const date = new Date(result);
  if (
    date.getUTCMonth() + 1 !== parts[1] ||
    date.getUTCDate() !== parts[2] ||
    date.getUTCHours() !== parts[3]
  )
    return NaN;
  return result;
}
function dateTime(ms) {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    timeZone: { id: "UTC" },
  };
}
export function assessVitalsRows(payload, metric, versionCode, start, end) {
  if (
    payload.nextPageToken ||
    !Array.isArray(payload.rows) ||
    !payload.rows.length
  )
    return "insufficient";
  const seen = new Set();
  let sufficient = true;
  for (const row of payload.rows) {
    const time = utc(row.startTime);
    if (
      row.aggregationPeriod !== "HOURLY" ||
      !Number.isFinite(time) ||
      time < start ||
      time >= end ||
      seen.has(time) ||
      row.dimensions?.length !== 1 ||
      row.dimensions[0].dimension !== "versionCode" ||
      String(row.dimensions[0].int64Value) !== String(versionCode)
    )
      return "insufficient";
    seen.add(time);
    const rate = row.metrics?.find((m) => m.metric === metric)?.decimalValue
      ?.value;
    const users = row.metrics?.find((m) => m.metric === "distinctUsers")
      ?.decimalValue?.value;
    if (
      typeof rate !== "string" ||
      typeof users !== "string" ||
      !Number.isFinite(Number(rate)) ||
      Number(rate) < 0 ||
      !Number.isFinite(Number(users)) ||
      Number(users) < 0
    )
      return "insufficient";
    // Conservative initial policy: any measured user-perceived crash/ANR halts.
    // Zero threshold avoids confusing percent and fraction units.
    if (Number(rate) > 0) return "failed";
    if (Number(users) < 100) sufficient = false;
  }
  return sufficient && seen.size === (end - start) / HOUR
    ? "passed"
    : "insufficient";
}
export async function readPlayVitals(
  credentialBase64,
  { versionCode, since, fetchImpl = fetch, now = Date.now() } = {},
) {
  let httpStatus = null;
  try {
    const token = await exchangeAccessToken(
      parseServiceAccount(credentialBase64),
      {
        fetchImpl,
        scope: SCOPE,
      },
    );
    async function request(url, body) {
      const response = await fetchImpl(url, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      httpStatus = response.status;
      if (!response.ok) throw new Error("vitals-unavailable");
      return response.json();
    }
    const results = [];
    for (const [set, metric] of SETS) {
      const metadata = await request(`${ROOT}/${set}`);
      if (versionCode === undefined) continue; // read-only capability probe
      if (
        !Number.isSafeInteger(Number(versionCode)) ||
        Number(versionCode) <= 0
      )
        throw new Error("version-required");
      const fresh = metadata.freshnessInfo?.freshnesses?.find(
        (f) => f.aggregationPeriod === "HOURLY",
      );
      const end = utc(fresh?.latestEndTime);
      // Exact-version latest six complete hours, all after this rollout stage.
      const start = end - 6 * HOUR;
      if (
        !Number.isFinite(end) ||
        end > now ||
        now - end > 24 * HOUR ||
        start < since ||
        end % HOUR !== 0
      ) {
        results.push("insufficient");
        continue;
      }
      const payload = await request(`${ROOT}/${set}:query`, {
        timelineSpec: {
          aggregationPeriod: "HOURLY",
          startTime: dateTime(start),
          endTime: dateTime(end),
        },
        dimensions: ["versionCode"],
        metrics: [metric, "distinctUsers"],
        filter: `versionCode = ${Number(versionCode)}`,
        userCohort: "OS_PUBLIC",
        pageSize: 100,
      });
      results.push(assessVitalsRows(payload, metric, versionCode, start, end));
    }
    return {
      schema: "tasknotes/play-vitals/1",
      available: true,
      verdict:
        versionCode === undefined
          ? "probe-only"
          : results.includes("failed")
            ? "failed"
            : results.every((r) => r === "passed")
              ? "passed"
              : "insufficient",
      signal: "android-vitals-exact-version",
      observedAt: new Date(now).toISOString(),
    };
  } catch {
    return {
      schema: "tasknotes/play-vitals/1",
      available: false,
      verdict: "unavailable",
      signal: "connect-cp-provider-readiness-only",
      httpStatus,
      observedAt: new Date(now).toISOString(),
    };
  }
}
if (process.argv[1]?.endsWith("/play-vitals.mjs")) {
  const result = await readPlayVitals(
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64,
  );
  await writeFile("play-vitals.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result)); // bounded enum/status only, never payloads
}
