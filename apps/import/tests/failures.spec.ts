import { test, expect, type Page } from "@playwright/test";

async function prepareCallback(page: Page) {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/");
  await page.evaluate(() =>
    sessionStorage.setItem(
      "tasknotes-import.todoist-pkce",
      JSON.stringify({
        state: "[test] state",
        verifier: "[test] verifier",
        created: Date.now(),
        clientId: `${location.origin}/oauth/todoist-client.json`,
        redirectUri: `${location.origin}/auth/todoist/callback`,
      }),
    ),
  );
}

test("denied consent consumes its transaction without exchanging or replaying a code", async ({
  page,
}) => {
  await prepareCallback(page);
  const calls: string[] = [];
  await page.route("https://api.todoist.com/**", (route) => {
    calls.push(route.request().url());
    return route.abort();
  });
  await page.goto(
    "/auth/todoist/callback?state=%5Btest%5D%20state&error=access_denied",
  );
  await expect(page.getByRole("alert")).toContainText("declined");
  expect(new URL(page.url()).pathname).toBe("/");
  expect(new URL(page.url()).search).toBe("");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("tasknotes-import.todoist-pkce"),
    ),
  ).toBeNull();
  await page.goto(
    "/auth/todoist/callback?state=%5Btest%5D%20state&code=synthetic-replay",
  );
  await expect(page.getByRole("alert")).toContainText(
    "no matching browser session",
  );
  expect(calls).toEqual([]);
});

test("failed token exchange clears the callback and never loads source data", async ({
  page,
}) => {
  await prepareCallback(page);
  const calls: string[] = [];
  await page.route("https://api.todoist.com/**", (route) => {
    calls.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "[test] private provider response",
    });
  });
  await page.goto(
    "/auth/todoist/callback?state=%5Btest%5D%20state&code=synthetic-code",
  );
  await expect(page.getByRole("alert")).toContainText(
    "sign-in exchange failed (503)",
  );
  await expect(page.locator("body")).not.toContainText(
    "private provider response",
  );
  await expect(
    page.getByRole("button", { name: "Connect Todoist" }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(calls).toEqual(["/oauth/access_token"]);
});

for (const status of [429, 503]) {
  test(`source HTTP ${status} never exposes a partial task list or retries automatically`, async ({
    page,
  }) => {
    await prepareCallback(page);
    const calls: string[] = [];
    await page.route("https://api.todoist.com/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      calls.push(path);
      if (path === "/oauth/access_token")
        return route.fulfill({
          json: { access_token: "synthetic-token", token_type: "Bearer" },
        });
      if (path === "/api/v1/user")
        return route.fulfill({ json: { id: "synthetic-account" } });
      if (path === "/api/v1/tasks")
        return route.fulfill({
          status,
          headers: { "Retry-After": "17" },
          body: "[test] private source response",
        });
      return route.fulfill({ json: { results: [], next_cursor: null } });
    });
    await page.goto(
      "/auth/todoist/callback?state=%5Btest%5D%20state&code=synthetic-code",
    );
    await expect(page.getByRole("alert")).toContainText(
      status === 429 ? "rate limiting" : "request failed (503)",
    );
    await expect(page.locator("body")).not.toContainText(
      "private source response",
    );
    await expect(
      page.getByText("Todoist connected", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Preview \d+ tasks$/ }),
    ).toHaveCount(0);
    expect(calls.filter((path) => path === "/api/v1/tasks")).toHaveLength(1);
    expect(new URL(page.url()).search).toBe("");
    const browserStorage = await page.evaluate(() => [
      ...Object.values(localStorage),
      ...Object.values(sessionStorage),
    ]);
    expect(browserStorage.join()).not.toContain("synthetic-token");
  });
}

test("duplicate task IDs on a later source page stop loading before preview", async ({
  page,
}) => {
  await prepareCallback(page);
  let taskRequests = 0;
  await page.route("https://api.todoist.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/oauth/access_token")
      return route.fulfill({
        json: { access_token: "synthetic-token", token_type: "Bearer" },
      });
    if (url.pathname === "/api/v1/user")
      return route.fulfill({ json: { id: "synthetic-account" } });
    if (url.pathname === "/api/v1/tasks") {
      taskRequests += 1;
      return route.fulfill({
        json: {
          results: [
            {
              id: "duplicate-task",
              content: "[test] must not reach preview",
              project_id: "project",
              priority: 1,
            },
          ],
          next_cursor: url.searchParams.has("cursor") ? null : "second-page",
        },
      });
    }
    return route.fulfill({ json: { results: [], next_cursor: null } });
  });
  await page.goto(
    "/auth/todoist/callback?state=%5Btest%5D%20state&code=synthetic-code",
  );
  await expect(page.getByRole("alert")).toContainText("duplicate task IDs");
  await expect(page.getByLabel("[test] must not reach preview")).toHaveCount(0);
  expect(taskRequests).toBe(2);
});
