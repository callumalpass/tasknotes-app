// Type-checks the app the way the staging publisher installs it: the root
// `@mdbase-dev/sdk` dependency aliased to a differently named package, while
// workspace members (apps/import) keep the catalog SDK. TypeScript compares
// SDK classes with private members nominally across differently named copies,
// so code that passes root SDK objects into a workspace member's SDK types
// type-checks in production and fails only in the staging build.
//
// The alias is simulated offline: the production original is repacked under
// the staging package name and installed through the publisher's own
// `prepareInstall`. Nothing is fetched and nothing is published.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const source = resolve(process.argv[2] ?? ".");
const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);

const base = await mkdtemp(join(tmpdir(), "tasknotes-staging-alias-"));
const root = join(base, "candidate");
try {
  // Copy tracked files (including uncommitted edits), never installed or
  // generated trees. Without git metadata (remote builders), copy the source
  // tree minus those directories.
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: source,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split("\0")
      .filter(Boolean);
  } catch {
    tracked = undefined;
  }
  if (tracked) {
    for (const path of tracked) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await cp(join(source, path), join(root, path)).catch((error) => {
        if (error.code !== "ENOENT") throw error; // deleted but not yet staged
      });
    }
  } else {
    const skip = new Set(["node_modules", ".git", "dist", "test-results"]);
    await cp(source, root, {
      recursive: true,
      filter: (path) => !skip.has(path.split(/[\\/]/).at(-1)),
    });
  }

  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const productionPath = pkg.dependencies["@mdbase-dev/sdk"].replace(
    /^file:/,
    "",
  );
  const lock = await readFile(join(root, "pnpm-lock.yaml"));
  const sri = new RegExp(
    `resolution: \\{integrity: (sha512-[A-Za-z0-9+/=]+), tarball: file:${productionPath.replaceAll(".", "\\.")}\\}`,
  ).exec(lock.toString())?.[1];
  if (!sri) throw Error("Production SDK lock entry not found");

  // Repack the production original under the staging package name.
  const unpacked = join(base, "sdk");
  await mkdir(unpacked);
  execFileSync("tar", ["-xzf", join(root, productionPath), "-C", unpacked]);
  const manifestPath = join(unpacked, "package", "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.name = "@mdbase-dev/sdk-staging";
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const staged = join(base, "sdk-staging.tgz");
  execFileSync("tar", ["-czf", staged, "-C", unpacked, "package"]);
  const bytes = await readFile(staged);

  const { prepareInstall } = await import(
    pathToFileURL(join(root, "scripts/publisher/install-inputs.mjs")).href
  );
  await prepareInstall(
    {
      target: "staging",
      sdkTrust: {
        lockSha256: hash(lock),
        production: { path: productionPath, sri },
        archives: {
          sdk: {
            path: "staging-alias-simulation",
            sha256: hash(bytes),
            sri: "sha512-" + hash(bytes, "sha512", "base64"),
          },
        },
      },
    },
    root,
    async () => new Response(bytes),
  );

  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  const run = (args) =>
    execFileSync("pnpm", args, { cwd: root, env, stdio: "inherit" });
  run([
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--ignore-pnpmfile",
  ]);
  run(["exec", "tsc", "-b", "--pretty", "false"]);
  console.log("Staging-alias type-check passed");
} finally {
  await rm(base, { recursive: true, force: true });
}
