// Temporary adapter for kit 096d80bf's symlink-sensitive bin entry guard.
// Keep all behavior in the shared kit; remove this when its fixed tarball lands.
const { main } = await import(
  new URL("./cli.mjs", import.meta.resolve("@mdbase-dev/i18n/config"))
);
await main(process.argv[2], process.argv.slice(3));
