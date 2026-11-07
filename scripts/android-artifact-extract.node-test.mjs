import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

for (const mode of [
  "valid",
  "host",
  "traversal",
  "extra",
  "duplicate",
  "symlink",
  "directory",
  "missing",
]) {
  test(`signed Android ZIP extraction: ${mode}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "tn-android-zip-test-"));
    try {
      const archive = join(root, "build.zip");
      const output = join(root, "output");
      await mkdir(output);
      execFileSync(
        "python3",
        [
          "-c",
          `
import zipfile,sys,stat
archive,mode=sys.argv[1:]
with zipfile.ZipFile(archive,'w') as z:
 if mode == 'host':
  z.writestr('app-release-androidTest.apk',b'host')
 else:
  if mode != 'missing': z.writestr('apk/release/app-release.apk',b'apk')
  z.writestr('bundle/release/app-release.aab',b'aab')
  if mode=='traversal': z.writestr('../escape',b'unsafe')
  if mode=='extra': z.writestr('run.sh',b'exit 0')
  if mode=='duplicate': z.writestr('apk/release/app-release.apk',b'other')
  if mode in ('symlink','directory'):
   z.infolist()[0].external_attr=((stat.S_IFLNK if mode=='symlink' else stat.S_IFDIR)|0o777)<<16
`,
          archive,
          mode,
        ],
        { stdio: "ignore" },
      );
      const run = () =>
        execFileSync(
          "python3",
          [
            "scripts/android-artifact-extract.py",
            archive,
            output,
            mode === "host" ? "host" : "build",
          ],
          { stdio: "ignore" },
        );
      if (mode === "valid" || mode === "host") {
        run();
        assert.equal(
          await readFile(
            join(output, mode === "host" ? "test-host.apk" : "application.apk"),
            "utf8",
          ),
          mode === "host" ? "host" : "apk",
        );
      } else {
        assert.throws(run);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
