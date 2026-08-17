import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const connectOrigin = "https://mdbase-connect-candidate-b.onrender.com";
const tasknotesOrigin = "https://candidate-b.tasknotes-app.pages.dev";
const pickleOrigin = "https://candidate-b.pickle-9zb.pages.dev";
const readerOrigin = "https://candidate-b.mdbase-reader-staging.pages.dev";
const editorOrigin = "https://candidate-b.mdbase-editor.pages.dev";
const workoutsOrigin = "https://mdbase-workouts-staging.pages.dev";
const collectionName = "Candidate B Live Missions";

const sessionToken = requiredEnvironment("MDBASE_CANDIDATE_B_SESSION_TOKEN");

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for the Candidate B live mission.`);
  return value;
}

async function installSession(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "__Host-mdbase_session",
      value: sessionToken,
      url: connectOrigin,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

async function openRegisteredApplication(
  page: Page,
  origin: string,
): Promise<void> {
  const registered = page.waitForResponse(
    (response) =>
      response.url() === `${connectOrigin}/v1/apps/register` &&
      response.request().method() === "POST",
  );
  await page.goto(origin);
  expect((await registered).status(), "application registration status").toBe(
    200,
  );
}

async function reviewAndAllowApplication(page: Page): Promise<void> {
  const reviewAccess = page.getByRole("button", { name: "Review access" });
  if (await reviewAccess.isVisible()) await reviewAccess.click();
  const allow = page.getByRole("button", { name: /allow /i });
  await expect(allow).toHaveCount(1);
  await allow.click();
}

async function authorizeTaskNotes(page: Page): Promise<void> {
  await openRegisteredApplication(page, tasknotesOrigin);
  await expect(
    page.getByRole("heading", { name: "Open TaskNotes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue to mdbase" }).click();

  await expect(page).toHaveURL(
    new RegExp(`^${connectOrigin.replaceAll(".", "\\.")}/`),
  );
  await expect(page.getByRole("heading", { name: "TaskNotes" })).toBeVisible();
  const collection = page.getByText(collectionName, { exact: true });
  await expect(collection).toBeVisible();
  const radio = collection.locator(
    "xpath=ancestor::label//input[@type='radio']",
  );
  if (await radio.count()) await radio.check();
  else await collection.click();
  await reviewAndAllowApplication(page);

  await expect(page).toHaveURL(
    new RegExp(`^${tasknotesOrigin.replaceAll(".", "\\.")}/`),
  );
  const capture = page.getByLabel("New task title");
  const applySetup = page.getByRole("button", { name: "Apply reviewed setup" });
  await expect(capture.or(applySetup)).toBeVisible();
  if (await applySetup.isVisible()) await applySetup.click();
  await expect(capture).toBeVisible({ timeout: 60_000 });
}

async function approveApplication(page: Page, appName: string): Promise<void> {
  await expect(page).toHaveURL(
    new RegExp(`^${connectOrigin.replaceAll(".", "\\.")}/`),
  );
  await expect(
    page.getByRole("heading", { name: appName, exact: true }),
  ).toBeVisible();
  const collection = page.getByText(collectionName, { exact: true });
  await expect(collection).toBeVisible();
  const radio = collection.locator(
    "xpath=ancestor::label//input[@type='radio']",
  );
  if (await radio.count()) await radio.check();
  else await collection.click();
  await reviewAndAllowApplication(page);
}

test("TaskNotes completes a live hosted create, reconnect, and exact read", async ({
  context,
  page,
}) => {
  await installSession(context);
  await authorizeTaskNotes(page);

  const title = `Candidate B TaskNotes ${Date.now()}`;
  const capture = page.getByLabel("New task title");
  await capture.fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("mdbase Reader authorizes, applies its exact setup, and runs a live query", async ({
  context,
  page,
}) => {
  await installSession(context);
  await openRegisteredApplication(page, readerOrigin);
  await expect(
    page.getByRole("heading", { name: "Open mdbase Reader" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect another collection" })
    .click();
  await approveApplication(page, "mdbase Reader");

  await expect(page).toHaveURL(
    new RegExp(`^${readerOrigin.replaceAll(".", "\\.")}/`),
  );
  const setup = page.getByRole("button", { name: "Apply reviewed setup" });
  const addSource = page.getByRole("button", { name: "Add source" }).first();
  await expect(setup.or(addSource)).toBeVisible({ timeout: 60_000 });
  if (await setup.isVisible()) await setup.click();
  await expect(addSource).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(collectionName, { exact: true })).toBeVisible();

  const search = page.getByPlaceholder("Search this view");
  await search.fill("Candidate B");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(addSource).toBeVisible({ timeout: 60_000 });
});

test("Pickle authorizes, applies definitions, and reconnects its live inbox", async ({
  context,
  page,
}) => {
  await installSession(context);
  await openRegisteredApplication(page, pickleOrigin);
  await expect(
    page.getByRole("heading", { name: "Open your decision inbox." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue to mdbase" }).click();
  await approveApplication(page, "Pickle");

  await expect(page).toHaveURL(
    new RegExp(`^${pickleOrigin.replaceAll(".", "\\.")}/`),
  );
  const inbox = page.getByRole("heading", { name: "Inbox" });
  const setup = page
    .getByRole("button", { name: "Update this collection" })
    .or(page.getByRole("button", { name: "Review and update definitions" }));
  await expect(inbox.or(setup)).toBeVisible({ timeout: 60_000 });
  if (await setup.isVisible()) await setup.click();
  await expect(inbox).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(inbox).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("mdbase editor creates and reloads an exact hosted Markdown note", async ({
  context,
  page,
}) => {
  await installSession(context);
  await openRegisteredApplication(page, editorOrigin);
  await expect(page.getByRole("heading", { name: /Your notes/ })).toBeVisible();
  await page.getByRole("button", { name: "Choose a collection" }).click();
  await approveApplication(page, "mdbase editor");

  await expect(page).toHaveURL(
    new RegExp(`^${editorOrigin.replaceAll(".", "\\.")}/`),
  );
  await expect(page.getByRole("heading", { name: collectionName })).toBeVisible(
    {
      timeout: 60_000,
    },
  );
  await expect(page.getByLabel("Loading note")).not.toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "New note" }).click();
  const composer = page.getByRole("main", { name: "Create note" });
  await expect(composer).toBeVisible();
  const title = `Candidate B Editor ${Date.now()}`;
  await composer.getByLabel("Title").fill(title);
  await composer
    .getByLabel("Note body")
    .fill("Exact encrypted body with [[Candidate B relationship]].");
  const create = composer.getByRole("button", { name: "Create note" });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(composer).not.toBeVisible();
  const openedTitle = page.getByLabel("Note title");
  await expect(openedTitle).toHaveValue(title, { timeout: 60_000 });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  await page.reload();
  await expect(page.getByLabel("Note title")).toHaveValue(title, {
    timeout: 60_000,
  });
  await expect(page.getByLabel("Note body")).toContainText(
    "Candidate B relationship",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("mdbase Workouts authorizes, writes a quick log, and reconnects", async ({
  context,
  page,
}) => {
  await installSession(context);
  await openRegisteredApplication(page, workoutsOrigin);
  await expect(
    page.getByRole("heading", { name: "Open your training record." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Choose workout collection" }).click();
  await approveApplication(page, "MDBase Workouts");

  await expect(page).toHaveURL(
    new RegExp(`^${workoutsOrigin.replaceAll(".", "\\.")}/`),
  );
  const today = page.getByRole("heading", { name: "Today" });
  const setup = page.getByRole("button", {
    name: "Apply workout definitions",
  });
  await expect(today.or(setup)).toBeVisible({ timeout: 60_000 });
  if (await setup.isVisible()) await setup.click();
  await expect(today).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: /quick log/i }).click();
  await expect(
    page.getByRole("heading", { name: "Quick Log", exact: true }),
  ).toBeVisible();
  await page.getByPlaceholder("Search exercises...").fill("Bench Press");
  await page.getByRole("button", { name: /^Bench Press\b/i }).click();
  const numericInputs = page.locator('input[type="number"]');
  await numericInputs.nth(0).fill("42.5");
  await numericInputs.nth(1).fill("7");
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText("42.5kg × 7").first()).toBeVisible({
    timeout: 60_000,
  });

  await page.reload();
  await expect(today).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("42.5kg × 7").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
});
