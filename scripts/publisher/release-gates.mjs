// Workflow-owned #1223 admission. Smoke does not qualify Cloud-copy setup or wasm.
export const minimumSdkCommit = "c42d004e3e4985df2cf54829c693f0e864972d2e";
// Enabled only after distinct Cloud-copy upgraded-plugin-type completion/reopen
// and actual wasm-route qualification at app 15d91901 / SDK producer 373c4a4e.
// Retained evidence: mdbase-cloud-ops PR #1576. SDK floor remains mandatory.
export const productionEnabled = true;
export function assertProductionEnabled(target) {
  if (target === "production" && !productionEnabled)
    throw Error(
      "TaskNotes production disabled: #1223 Cloud-copy and wasm staging qualification required",
    );
}
export async function assertSdkFloor(
  pin,
  { fetchImpl = fetch, token = process.env.GITHUB_TOKEN } = {},
) {
  const version = /^0\.1\.0-beta\.(\d+)$/.exec(pin.version ?? "");
  if (
    !version ||
    Number(version[1]) < 158 ||
    !/^[a-f0-9]{40}$/.test(pin.sourceCommit ?? "")
  )
    throw Error("TaskNotes #1223 requires pinned beta.158 or later");
  const response = await fetchImpl(
    `https://api.github.com/repos/mdbase-dev/mdbase-connect/compare/${minimumSdkCommit}...${pin.sourceCommit}?per_page=1`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (
    !response.ok ||
    !["ahead", "identical"].includes((await response.json()).status)
  )
    throw Error("TaskNotes #1223 SDK producer ancestry required");
}
