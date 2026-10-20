// Separate INSTALLER-output policy, never an original npm member or SDK code.
// Source checked: pnpm10.7.0 @zkochan/cmd-shim generateShShim() in pnpm.cjs.
// Do not execute this shell script. Compare EVERY byte to the fixed template.
import { dirname, join, resolve, relative } from "node:path";
export function expectedYamlShim(
  packageRoot,
  projectRoot,
  externalYamlRoot = null,
) {
  const paths = externalYamlRoot
    ? [
        join(externalYamlRoot, "node_modules"),
        dirname(externalYamlRoot),
        resolve(projectRoot, "node_modules/.pnpm/node_modules"),
      ]
    : [
        join(packageRoot, "node_modules/yaml/node_modules"),
        join(packageRoot, "node_modules"),
        join(dirname(packageRoot), "node_modules"),
        dirname(dirname(packageRoot)),
        resolve(projectRoot, "node_modules/.pnpm/node_modules"),
      ];
  const target = externalYamlRoot
    ? relative(
        join(packageRoot, "node_modules/.bin"),
        join(externalYamlRoot, "bin.mjs"),
      )
    : "../yaml/bin.mjs";
  if (paths.some((path) => !/^\/[A-Za-z0-9_@+./~-]+$/.test(path)))
    throw new Error("Unqualified pnpm generated-shim path.");
  const nodePath = paths.join(":");
  return `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")

case \`uname\` in
    *CYGWIN*) basedir=\`cygpath -w "$basedir"\`;;
esac

if [ -z "$NODE_PATH" ]; then
  export NODE_PATH="${nodePath}"
else
  export NODE_PATH="${nodePath}:$NODE_PATH"
fi
if [ -x "$basedir/node" ]; then
  exec "$basedir/node"  "$basedir/${target}" "$@"
else
  exec node  "$basedir/${target}" "$@"
fi
`;
}
export function assertGeneratedYamlShim({
  bytes,
  packageRoot,
  projectRoot,
  members,
  packageManager,
  externalYamlRoot = null,
}) {
  const yaml = members.get("node_modules/yaml/package.json");
  const entry = members.get("node_modules/yaml/bin.mjs");
  if (
    packageManager !== "pnpm@10.7.0" ||
    !yaml ||
    !entry ||
    JSON.parse(yaml.toString()).name !== "yaml" ||
    JSON.parse(yaml.toString()).bin !== "./bin.mjs" ||
    !entry.toString().startsWith("#!/usr/bin/env node")
  )
    throw new Error("No qualified original YAML binary for generated shim.");
  if (
    externalYamlRoot &&
    externalYamlRoot !==
      resolve(
        projectRoot,
        `node_modules/.pnpm/yaml@${JSON.parse(yaml.toString()).version}/node_modules/yaml`,
      )
  )
    throw new Error("Unqualified external YAML shim target.");
  if (
    !bytes.equals(
      Buffer.from(expectedYamlShim(packageRoot, projectRoot, externalYamlRoot)),
    )
  )
    throw new Error("pnpm generated YAML shim byte mismatch.");
}
