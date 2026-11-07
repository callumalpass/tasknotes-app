import { expect, test, type Page } from "./local-test";

async function openAttachments(page: Page) {
  await page.goto("?demo=24");
  await page
    .getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    })
    .click();
  return page.getByRole("region", { name: "Attachments", exact: true });
}

for (const file of [
  { name: "notes.txt", mimeType: "text/plain", content: "Task notes" },
  {
    name: "unsafe.html",
    mimeType: "text/html",
    content:
      "<script>window.opener.localStorage.setItem('attachment-executed', 'yes')</script>",
  },
  {
    name: "unsafe.svg",
    mimeType: "image/svg+xml",
    content: "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>",
  },
]) {
  test(`${file.name} downloads byte-for-byte without inline content or navigation`, async ({
    page,
  }) => {
    const section = await openAttachments(page);
    const picker = section.getByLabel("Attach file", { exact: true });
    await expect(picker).not.toHaveAttribute("accept");
    await picker.setInputFiles({
      name: file.name,
      mimeType: file.mimeType,
      buffer: Buffer.from(file.content),
    });
    const row = section.getByRole("listitem").filter({ hasText: file.name });
    await expect(row).toBeVisible();
    await expect(row.locator("img, iframe, object, embed")).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: "Insert", exact: true }),
    ).toHaveCount(0);
    const downloadPromise = page.waitForEvent("download");
    await row
      .getByRole("button", { name: `Download ${file.name}`, exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(file.name);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe(file.content);
    expect(page.context().pages()).toHaveLength(1);
    expect(
      await page.evaluate(() => localStorage.getItem("attachment-executed")),
    ).toBeNull();
    await expect(page).toHaveURL(/\/task\/demo-planning-session/);
  });
}

test("file rows fit 390px, handle empty files, and surface the model's extensionless-name restriction", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const section = await openAttachments(page);
  const picker = section.getByLabel("Attach file", { exact: true });
  for (const file of [
    { name: "empty.txt", mimeType: "text/plain", content: "" },
    {
      name: `${"long-report-".repeat(10)}.pdf`,
      mimeType: "application/pdf",
      content: "%PDF-1.7",
    },
  ]) {
    await picker.setInputFiles({
      name: file.name,
      mimeType: file.mimeType,
      buffer: Buffer.from(file.content),
    });
    await expect(section.getByRole("listitem")).toHaveCount(
      file.name === "empty.txt" ? 1 : 2,
    );
  }
  await expect(section.getByText("0 B", { exact: true })).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  for (const row of await section.getByRole("listitem").all()) {
    const bounds = await row.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    for (const action of await row.getByRole("button").all()) {
      const actionBounds = await action.boundingBox();
      expect(actionBounds!.height).toBeGreaterThanOrEqual(44);
      expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(390);
    }
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  const filename = section.locator(".attachment-identity strong").last();
  expect(
    await filename.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/tasknotes-file-attachments-390.png",
    fullPage: true,
  });
  const emptyRow = section.getByRole("listitem").filter({ hasText: /^empty/ });
  await emptyRow
    .getByRole("button", { name: "Detach empty.txt", exact: true })
    .click();
  await expect(emptyRow).toHaveCount(0);
  await picker.setInputFiles({
    name: "README",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("No extension"),
  });
  await expect(section.getByRole("alert")).toContainText(
    "Invalid attachment path",
  );
  await expect(section.getByRole("listitem")).toHaveCount(1);
});

test("raster attachments keep their thumbnail and inline Notes insertion", async ({
  page,
}) => {
  const section = await openAttachments(page);
  await section.getByLabel("Attach file", { exact: true }).setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const row = section.getByRole("listitem");
  await expect(row.locator("img")).toBeVisible();
  await row.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(page.locator(".markdown-preview img")).toBeVisible();
});
