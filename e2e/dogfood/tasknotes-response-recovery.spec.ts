import { expect, test, type Page, type Route } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";

const collectionDir = requiredEnvironment(
  "MDBASE_CONNECT_DOGFOOD_COLLECTION_DIR",
);
const userName =
  process.env.MDBASE_CONNECT_DOGFOOD_USER_NAME ?? "TaskNotes Dogfood";
const userEmail =
  process.env.MDBASE_CONNECT_DOGFOOD_USER_EMAIL ??
  "tasknotes-dogfood@localhost.test";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for the isolated dogfood test.`);
  return value;
}

async function markdownFiles(): Promise<string[]> {
  return (await readdir(collectionDir, { recursive: true }))
    .filter((file) => file.endsWith(".md"))
    .sort();
}

async function authorize(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Open TaskNotes with mdbase." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue to mdbase" }).click();
  await expect(
    page.getByRole("heading", { name: "Open your account" }),
  ).toBeVisible();
  await page.getByLabel("Name").fill(userName);
  await page.getByLabel("Email").fill(userEmail);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "TaskNotes" })).toBeVisible();
  const collection = page.locator('input[type="radio"]').first();
  await expect(collection).toBeAttached();
  if (!(await collection.isChecked())) await collection.check();
  await page.getByRole("button", { name: /allow TaskNotes$/i }).click();

  const capture = page.getByLabel("New task title");
  const applySetup = page.getByRole("button", {
    name: "Apply reviewed setup",
  });
  await expect(capture.or(applySetup)).toBeVisible();
  if (await applySetup.isVisible()) await applySetup.click();
  await expect(capture).toBeVisible();
}

function isCreateOperation(route: Route): boolean {
  const request = route.request();
  if (request.method() !== "POST") return false;
  let body: Record<string, unknown>;
  try {
    body = request.postDataJSON() as Record<string, unknown>;
  } catch {
    return false;
  }
  return (
    body.operation === "create" || request.url().endsWith("/operations/create")
  );
}

test("recovers one exact task after authority responses are lost", async ({
  page,
}) => {
  await authorize(page);
  const collectionConfig = await readFile(
    `${collectionDir}/mdbase.yaml`,
    "utf8",
  );
  expect(collectionConfig).toContain("views/tasknotes/**/*.base");
  const todayView = await readFile(
    `${collectionDir}/views/tasknotes/today.base`,
    "utf8",
  );
  expect(todayView).toContain("formula.taskDay <= today()");
  expect(todayView).not.toContain('taskDay <= today().format("YYYY-MM-DD")');
  const filesBefore = await markdownFiles();
  const title = `TaskNotes durable recovery ${Date.now()}`;

  let injectLoss = true;
  let droppedResponses = 0;
  await page.route("**/*", async (route) => {
    if (!injectLoss || !isCreateOperation(route)) {
      await route.continue();
      return;
    }
    await route.fetch();
    droppedResponses += 1;
    await route.abort("failed");
  });

  const input = page.getByLabel("New task title");
  await input.fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(
    "The task could not finish. Your draft is still here.",
  );
  await expect(input).toHaveValue(title);
  expect(droppedResponses).toBeGreaterThan(0);

  injectLoss = false;
  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  const filesAfter = await markdownFiles();
  const created = filesAfter.filter((file) => !filesBefore.includes(file));
  const matching: string[] = [];
  for (const file of created) {
    const markdown = await readFile(`${collectionDir}/${file}`, "utf8");
    if (markdown.includes(title)) matching.push(file);
  }
  expect(matching).toHaveLength(1);
});
