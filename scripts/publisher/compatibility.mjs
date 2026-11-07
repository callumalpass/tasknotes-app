// Workflow-owned production contract proof, immediately before any Pages write.
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export async function compatible(
  producer,
  { fetchImpl = fetch, token = process.env.GITHUB_TOKEN } = {},
) {
  if (!/^[a-f0-9]{40}$/.test(producer ?? "")) return false;
  const json = async (url) => {
    const response = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Cache-Control": "no-store",
        ...(token && url.startsWith("https://api.github.com/")
          ? { Authorization: `Bearer ${token}` }
          : {}),
      },
    });
    if (!response.ok) throw Error("production-revisions-unavailable");
    return response.json();
  };
  try {
    const cp = await json("https://connect.mdbase.dev/health"),
      provider = await json("https://sync.mdbase.dev/ready");
    if (
      cp.ok !== true ||
      cp.environment !== "production" ||
      provider.status !== "ready"
    )
      return false;
    for (const revision of [cp.revision, provider.provider?.revision]) {
      if (!/^[a-f0-9]{40}$/.test(revision ?? "")) return false;
      const proof = await json(
        `https://api.github.com/repos/mdbase-dev/mdbase-connect/compare/${producer}...${revision}?per_page=1`,
      );
      if (!["identical", "ahead"].includes(proof.status)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [planPath, reportPath] = process.argv.slice(2);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const producer = plan.sdkTrust.authentication.source;
  const ready = await compatible(producer);
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        source: plan.sha,
        target: plan.target,
        producer,
        compatible: ready,
        reason: ready ? "compatible" : "production-contract-wait",
      },
      null,
      2,
    ),
  );
  await appendFile(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
}
