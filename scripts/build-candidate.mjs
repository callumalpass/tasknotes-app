import { writeFileSync } from "node:fs";
import { checkProductionSdk } from "./production-sdk.mjs";
import {
  buildProductionAssets,
  productionBuildEnvironment,
} from "./build-production.mjs";

/** Pull-request CI only. Builds the production-configured bundle so the web
 * and native projects can be compiled while the production trust input is
 * still absent. The output is never releasable: release and deploy workflows
 * run `pnpm build`, which refuses without the pinned production SDK. At
 * runtime, an SDK without packaged trust refuses to open collections. */
let trust;
try {
  await checkProductionSdk();
  trust = "present";
} catch (error) {
  trust = "absent";
  console.warn(
    `Candidate build: production trust is absent, so this output is NOT releasable.\n${error.message}`,
  );
}
const status = buildProductionAssets(productionBuildEnvironment());
if (status === 0)
  writeFileSync(
    new URL("../dist/tasknotes-candidate.json", import.meta.url),
    `${JSON.stringify({ releasable: false, productionTrust: trust }, null, 2)}\n`,
  );
process.exit(status);
