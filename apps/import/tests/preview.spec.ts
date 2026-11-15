import { test, expect } from "@playwright/test";

test("example previews real TaskNotes Markdown and blocks unsupported recurrence without network access", async ({
  page,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") {
      external.push(url.href);
      return route.abort();
    }
    // Exercise the same restrictive script policy as Pages, including no unsafe-eval.
    return route.fetch().then(async (response) =>
      route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-security-policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'",
        },
      }),
    );
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Import from Todoist" }),
  ).toBeVisible();
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.locator('.progress [aria-current="step"]')).toContainText(
    "Tasks",
  );
  await expect(
    page.getByRole("heading", { name: "Collection", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".privacy")).not.toHaveAttribute("open", "");
  expect(
    (await page.locator("body").innerText()).split(/\s+/).length,
  ).toBeLessThan(70);
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  for (const [i, value] of ["high", "normal", "low", "none"].entries())
    await page.getByLabel(`API priority ${i + 1}`).selectOption(value);
  await page.getByRole("button", { name: "Preview 3 tasks" }).click();
  await expect(page.getByLabel("Markdown preview")).toContainText(
    "scheduled: 2026-10-02",
  );
  await expect(page.getByLabel("Markdown preview")).toContainText(
    "due: 2026-10-05",
  );
  await expect(page.locator('.progress [aria-current="step"]')).toContainText(
    "Review",
  );
  await expect(page.locator(".file-details")).not.toHaveAttribute("open", "");
  await expect(page.locator(".import-notes")).not.toHaveAttribute("open", "");
  await page.getByText("Import notes", { exact: false }).click();
  await expect(
    page.getByText("Section is preserved in the task body.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Water the plants Needs review" })
    .click();
  await expect(
    page.getByText("Recurrence requires manual conversion:", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import 3 tasks", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Water the plants").uncheck();
  await page.getByRole("button", { name: "Preview 2 tasks" }).click();
  await page.getByRole("checkbox", { name: "I’ve reviewed" }).check();
  await expect(
    page.getByRole("button", { name: "Import 2 tasks", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Importing is disabled in example mode."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("TaskNotes styling supports dark mode and narrow enlarged text", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(
    page.getByRole("heading", { name: "Import from Todoist" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
  ).toBe("dark");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).fontFamily),
  ).toContain("Atkinson Hyperlegible");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("OAuth callback and metadata are available as static routes", async ({
  request,
}) => {
  const metadata = await request.get("/oauth/todoist-client.json");
  expect(metadata.ok()).toBe(true);
  expect(await metadata.json()).toMatchObject({
    token_endpoint_auth_method: "none",
    scope: "data:read",
  });
  const manifest = await (
    await request.get("/.well-known/mdbase-app.json")
  ).json();
  expect(manifest.provisions.type_packs).toHaveLength(1);
  expect(manifest.provisions.type_packs[0].manifest.version).toBe(
    "0.3.0-rc.21",
  );
  expect(manifest.requirements.contracts).toContainEqual({
    id: "tasknotes.task",
    version: "0.3.0-rc.6",
    digest:
      "sha256:c400ead6e218b715d86ad31125bb3d4b2e276817da6ba8065449fd0947b24d67",
  });
  expect(manifest.requirements.capabilities).toEqual({
    contract_version: 2,
    required: ["collection.read", "records.create", "definitions.manage"],
    optional: [],
  });
  expect(manifest.installation_origins.production["app-runtime"]).toEqual([
    new URL(manifest.homepage).origin,
  ]);
  for (const path of ["/auth/todoist/callback", "/auth/mdbase/callback"])
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(200);
});

test("synthetic OAuth callback loads Todoist data using the browser fetch binding", async ({
  page,
}) => {
  const calls: string[] = [];
  await page.route("https://api.todoist.com/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    const value =
      path === "/oauth/access_token"
        ? {
            access_token: "synthetic-test-token",
            token_type: "Bearer",
            scope: "data:read",
          }
        : path === "/api/v1/user"
          ? { id: "synthetic-account" }
          : path === "/api/v1/tasks"
            ? {
                results: [
                  {
                    id: "task-one",
                    content: "Synthetic source task",
                    project_id: "project",
                    priority: 1,
                  },
                ],
                next_cursor: null,
              }
            : { results: [], next_cursor: null };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
  await page.goto("/");
  await page.evaluate(() =>
    sessionStorage.setItem(
      "tasknotes-import.todoist-pkce",
      JSON.stringify({
        state: "synthetic-state",
        verifier: "synthetic-verifier",
        created: Date.now(),
        clientId: `${location.origin}/oauth/todoist-client.json`,
        redirectUri: `${location.origin}/auth/todoist/callback`,
      }),
    ),
  );
  await page.goto(
    "/auth/todoist/callback?state=synthetic-state&code=synthetic-code",
  );
  await expect(
    page.getByText("Todoist connected", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Synthetic source task")).toBeChecked();
  expect(new URL(page.url()).search).toBe("");
  expect(calls).toContain("/api/v1/user");
  await page.getByRole("button", { name: "Clear loaded Todoist data" }).click();
  await expect(
    page.getByRole("button", { name: "Connect Todoist" }),
  ).toBeVisible();
});
