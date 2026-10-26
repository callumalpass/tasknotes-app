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

// Exact package/lock bytes from 2d3dd10 (main after #299), whose lock digest
// is bound by production.json. This fixture does not qualify today's changed
// dependency closure for production publication or rewrite any intake pins.
export async function frozenProductionRoot(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "tn-frozen-production-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = new URL("../../", import.meta.url);
  for (const [file, snapshot] of [
    ["package.json", "production-package.snapshot"],
    ["pnpm-lock.yaml", "production-lock.snapshot"],
  ])
    await writeFile(
      join(root, file),
      await readFile(new URL(snapshot, import.meta.url)),
    );
  await mkdir(join(root, "config/native-publish"), { recursive: true });
  await cp(
    new URL("config/native-publish/production.json", project),
    join(root, "config/native-publish/production.json"),
  );
  const config = JSON.parse(
    await readFile(join(root, "config/native-publish/production.json")),
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
