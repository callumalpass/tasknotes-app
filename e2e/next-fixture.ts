import type { Page } from "./local-test";
import type { NextSmokeInput } from "../src/test/next-entry-smoke-fixture";

/** Reuses the ONE original held SDK-client fixture through the real entry gate.
 * Synthetic catalog/protocol data is not native/LAB authorization evidence.
 */
export async function openFixture(
  page: Page,
  input: NextSmokeInput = { records: [] },
  route = "./",
) {
  await page.addInitScript((value) => {
    window.__TASKNOTES_NEXT_SMOKE__ = value;
  }, input);
  await page.goto(route);
  await page
    .getByRole("button", { name: "Open synced fixture collection" })
    .click();
}
