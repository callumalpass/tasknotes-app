import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Historical staging publisher assertions must use their actual frozen input,
// not today's production dependency/lock. No intake pin or original is rewritten.
export async function frozenStagingRoot(t) {
  // macOS /var is an OS symlink; hand the strict intake verifier the real root.
  // Its prohibition on symlinked inputs remains unchanged.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "tn-frozen-staging-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = new URL("../../", import.meta.url);
  for (const [file, snapshot] of [
    ["package.json", "staging-package.snapshot"],
    ["pnpm-lock.yaml", "staging-lock.snapshot"],
  ])
    await writeFile(
      join(root, file),
      await readFile(new URL(snapshot, import.meta.url)),
    );
  await mkdir(join(root, "config"));
  await cp(
    new URL("config/native-publish", project),
    join(root, "config/native-publish"),
    { recursive: true },
  );
  const config = JSON.parse(
    await readFile(join(root, "config/native-publish/staging.json")),
  );
  await mkdir(join(root, "vendor/native-publish"), { recursive: true });
  await cp(
    new URL(`vendor/native-publish/${config.packetDirectory}`, project),
    join(root, "vendor/native-publish", config.packetDirectory),
    { recursive: true },
  );
  for (const archive of Object.values(config.archives))
    await cp(
      new URL(`vendor/${archive.archive}`, project),
      join(root, "vendor", archive.archive),
    );
  return root;
}
