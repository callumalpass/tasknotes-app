// Same npm/Sigstore verification as Connect's continuous SDK publisher.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
const repository = "mdbase-dev/mdbase-connect";
async function registryJson(path) {
  const response = await fetch("https://registry.npmjs.org/" + path, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, "npm-evidence-unavailable");
  return response.json();
}
export function provenanceSource(bundle, baseline, name) {
  const statement = JSON.parse(
    Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"),
  );
  assert.equal(statement.predicateType, "https://slsa.dev/provenance/v1");
  const subject = statement.subject;
  assert.equal(subject.length, 1);
  assert.equal(
    subject[0].name,
    `pkg:npm/${name.split("/").map(encodeURIComponent).join("/")}@${baseline.version}`,
  );
  const integrity = Buffer.from(
    baseline.entry.dist.integrity.slice("sha512-".length),
    "base64",
  ).toString("hex");
  assert.equal(subject[0].digest.sha512, integrity);
  const definition = statement.predicate.buildDefinition;
  const workflow = definition.externalParameters.workflow;
  assert.equal(workflow.repository, `https://github.com/${repository}`);
  assert.equal(workflow.path, `.github/workflows/${baseline.workflow}`);
  assert(
    ["refs/heads/main", `refs/tags/v${baseline.version}`].includes(
      workflow.ref,
    ),
  );
  assert.equal(definition.resolvedDependencies.length, 1);
  const source = definition.resolvedDependencies[0];
  assert.equal(
    source.uri,
    `git+https://github.com/${repository}@${workflow.ref}`,
  );
  assert.match(source.digest.gitCommit, /^[a-f0-9]{40}$/);
  return {
    commit: source.digest.gitCommit,
    identity: `https://github.com/${repository}/.github/workflows/${baseline.workflow}@${workflow.ref}`,
  };
}

export async function provenSource(
  name,
  baseline,
  { readRegistry = registryJson, verifyBundle = verifyProvenanceBundle } = {},
) {
  const attestations = await readRegistry(
    `-/npm/v1/attestations/${encodeURIComponent(name)}@${baseline.version}`,
  );
  const proofs = attestations.attestations.filter(
    (item) => item.predicateType === "https://slsa.dev/provenance/v1",
  );
  assert.equal(
    proofs.length,
    1,
    "Exactly one npm provenance attestation is required.",
  );
  const bundle = proofs[0].bundle;
  const source = provenanceSource(bundle, baseline, name);
  await verifyBundle(bundle, source);
  return source;
}

export async function verifyProvenanceBundle(bundle, source, verifier) {
  // Publish jobs install no workspace dependencies, so use the sigstore npm signs with.
  const npm = join(
    execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(),
    "npm/package.json",
  );
  const verify = verifier ?? createRequire(npm)("sigstore").verify;
  // DSSE bundles use verify(bundle, options), not the detached-content overload.
  await verify(bundle, {
    certificateIssuer: "https://token.actions.githubusercontent.com",
    certificateIdentityURI: source.identity,
    tlogThreshold: 1,
    ctLogThreshold: 1,
    timeout: 15_000,
    retry: { retries: 0 },
  });
}
