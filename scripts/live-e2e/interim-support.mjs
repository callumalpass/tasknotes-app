import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const interim = Object.freeze({
  source: "d780dc343b7bf65faa0d3119f1cfc22c97943dab",
  sdkSource: "561501d0c627b7808d02e403d65e949bdb78fa88",
  sdkSha256: "8982d7e2442b29584931a965b96d3ddd0a2266fa70890c493a0ee1a7588e3948",
  runtimeSha256:
    "58e9ed23146a956af24b936359fc79c931873eda1c8d9e297f5196f02ddaa265",
  trustModuleSha256:
    "a7db2cc3ba9fd1e78d86093599b608a2e3268408402630d81242450603c98a10",
  cpSourceUnchanged: "70fa373df6c8fa55f0463f16d67b75a6f94686a2",
  url: "http://127.0.0.1:48218/",
  logOrigin: "https://mdbase-next-log-lab-20261005.callumalpass.workers.dev",
});
export const interimProofRoot =
  "/home/calluma/worktrees/mdbase-next/.coord/scratch/release/interim-tasknotes-1702";
export function assertInterim(operation, proof) {
  for (const key of [
    "source",
    "sdkSource",
    "sdkSha256",
    "runtimeSha256",
    "trustModuleSha256",
    "cpSourceUnchanged",
  ]) {
    if (operation[key] !== interim[key])
      throw Error(`Interim identity mismatch: ${key}`);
  }
  if (
    operation.phase !== "complete" ||
    operation.pid !== 3903366 ||
    operation.cpDeployDispatches !== 0 ||
    operation.filesChecked !== 54 ||
    !operation.rootIndexMatches ||
    proof.source !== interim.source ||
    proof.pid !== operation.pid ||
    !proof.rootIndexMatches ||
    !proof.runtimeUnchanged ||
    proof.filesChecked !== 54 ||
    proof.allDistFiles?.length !== 54
  )
    throw Error("Incomplete interim release operation/HTTP proof");
  if (new Set(proof.allDistFiles.map(({ path }) => path)).size !== 54)
    throw Error("Duplicate interim resource");
  for (const resource of proof.allDistFiles) {
    const url = new URL(resource.path, interim.url);
    if (
      url.origin !== new URL(interim.url).origin ||
      url.search ||
      url.hash ||
      resource.path.startsWith("/") ||
      !/^[0-9a-f]{64}$/.test(resource.sha256) ||
      !Number.isSafeInteger(resource.bytes) ||
      resource.bytes < 1
    )
      throw Error("Invalid interim resource witness");
  }
  if (
    !proof.allDistFiles.some(
      ({ path, sha256 }) =>
        path.endsWith(".wasm") && sha256 === interim.runtimeSha256,
    ) ||
    !proof.allDistFiles.some(({ path }) => path === "index.html")
  )
    throw Error("Missing native runtime/index witness");
}
export async function verifyInterimServed() {
  const operation = JSON.parse(
    await readFile(resolve(interimProofRoot, "preview-operation.json"), "utf8"),
  );
  const proof = JSON.parse(
    await readFile(resolve(interimProofRoot, "http-byte-proof.json"), "utf8"),
  );
  assertInterim(operation, proof);
  for (const resource of [
    ...proof.allDistFiles,
    {
      ...proof.allDistFiles.find(({ path }) => path === "index.html"),
      path: "",
    },
  ]) {
    const response = await fetch(new URL(resource.path, interim.url), {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error(`Interim resource HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      bytes.length !== resource.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== resource.sha256
    )
      throw Error("Interim served bytes mismatch");
  }
  return {
    source: interim.source,
    sdkSource: interim.sdkSource,
    runtimeSha256: interim.runtimeSha256,
    filesVerified: 54,
    rootVerified: true,
  };
}
