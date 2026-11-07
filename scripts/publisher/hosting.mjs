import { readFile } from "node:fs/promises";
import { verifyHosting } from "./hosting-policy.mjs";
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
try {
  const [planPath, inventoryPath, deploymentPath] = process.argv.slice(2),
    plan = await json(planPath),
    inventory = await json(inventoryPath),
    deployment = await json(deploymentPath);
  if (
    deployment.sourceSha !== plan.sha ||
    deployment.pagesBranch !== plan.pagesBranch
  )
    throw Error("Deployment binding");
  const immutable = await verifyHosting({
    origin: deployment.url,
    inventory,
    deployment,
  });
  let alias,
    attempts = 0;
  const deadline = Date.now() + 300000;
  if (immutable.ok)
    do {
      attempts++;
      alias = await verifyHosting({
        origin: plan.origin,
        inventory,
        deployment,
      });
      if (alias.ok || Date.now() + 15000 >= deadline) break;
      await new Promise((r) => setTimeout(r, 15000));
    } while (Date.now() < deadline);
  const result = {
    ...(alias ?? immutable),
    ok: immutable.ok && alias?.ok === true,
    origins: [
      { origin: deployment.url, ...immutable },
      ...(alias ? [{ origin: plan.origin, ...alias }] : []),
    ],
    aliasAttempts: attempts,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch {
  console.log(
    JSON.stringify({ ok: false, reason: "hosting-verification-failed" }),
  );
  process.exitCode = 1;
}
