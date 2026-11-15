import { mkdir, copyFile } from "node:fs/promises";
// Pages serves callback.html at /callback without a trailing-slash redirect.
// Directory index files would redirect OAuth callbacks to /callback/ and break
// exact redirect-URI/state validation (and can lose query strings).
for (const provider of ["todoist", "mdbase"]) {
  await mkdir(`dist/auth/${provider}`, { recursive: true });
  await copyFile("dist/index.html", `dist/auth/${provider}/callback.html`);
}
