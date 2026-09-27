import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const outbox = `${process.env.GIFS_E2E_DATA_DIR || "data"}/mail-outbox.jsonl`;
function latestCode(email: string): string {
  const entries = readFileSync(outbox, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const found = entries.reverse().find((entry) => entry.email === email);
  if (!found) throw new Error(`Missing code for ${email}`);
  return found.code;
}

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  next: string,
) {
  await expect(page.locator("main")).toBeVisible();
  const session = await page.request.get("/api/session");
  const { csrf } = await session.json();
  const headers = { "X-CSRF-Token": csrf };
  const requestCode = await page.request.post("/api/auth/request-code", {
    data: { email },
    headers,
  });
  expect(requestCode.ok(), await requestCode.text()).toBeTruthy();
  expect(
    (
      await page.request.post("/api/auth/verify", {
        data: { email, code: latestCode(email) },
        headers,
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(next);
}

test("theme follows the device even with an old saved choice", async ({
  page,
}) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { user: null, csrf: "test", signInConfigured: true },
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("gif-urself-theme", "dark"),
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/signin");
  const html = page.locator("html");
  await expect(html).toHaveCSS("color-scheme", "light");
  const lightBackground = await html.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveCSS("color-scheme", "dark");
  const darkBackground = await html.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(darkBackground).not.toBe(lightBackground);
  await page.reload();
  await expect(html).toHaveCSS("color-scheme", "dark");
  await expect(html).toHaveCSS("background-color", darkBackground);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveCSS("color-scheme", "light");
  await expect(html).toHaveCSS("background-color", lightBackground);
});

test("camera errors appear in the preview", async ({ page }) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { user: null, csrf: "test", signInConfigured: true },
    }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new Error("Camera blocked");
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".capture-frame").getByRole("alert")).toContainText(
    "Allow camera access",
  );
  await expect(
    page.getByRole("button", { name: "Try camera again" }),
  ).toBeVisible();
});

test("countdown border gives way to button recording progress", async ({
  page,
}) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { user: null, csrf: "test", signInConfigured: true },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Record GIF" })).toBeEnabled();
  await page.getByRole("button", { name: "Record GIF" }).click();
  const frame = page.locator(".capture-frame");
  await expect(frame.locator(".countdown-border")).toBeVisible();
  const recordingButton = page.getByRole("button", { name: "Recording…" });
  await expect(recordingButton).toBeDisabled({ timeout: 10_000 });
  await expect(frame.locator(".countdown-border")).toHaveCount(0);
  const progress = recordingButton.getByRole("progressbar", {
    name: "Recording progress",
  });
  await expect(progress).toBeVisible();
  await expect
    .poll(async () => Number(await progress.getAttribute("aria-valuenow")))
    .toBeGreaterThan(10);
});

test("signed-in recording saves directly to its GIF page", async ({ page }) => {
  test.setTimeout(60_000);
  const owner = `direct-${Date.now()}@example.com`;
  await page.goto("/signin");
  await signIn(page, owner, "/");
  await expect(page.getByRole("button", { name: "Record GIF" })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Record GIF" }).click();
  const progress = page.getByRole("progressbar", {
    name: "Recording progress",
  });
  await expect(progress).toBeVisible();
  await expect
    .poll(async () => Number(await progress.getAttribute("aria-valuenow")))
    .toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Save GIF" })).toBeVisible({
    timeout: 25_000,
  });
  await page.getByRole("button", { name: "Save GIF" }).click();
  await expect(page).toHaveURL(/\/gifs\/[a-f0-9]+$/);
  await expect(page.getByRole("link", { name: "Download" })).toBeVisible();
});

test("record, save, browse, and delete a GIF", async ({ browser, page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Sign in to see saved GIFs" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Record GIF" })).toBeEnabled({
    timeout: 15_000,
  });
  await page.screenshot({
    path: "test-results/recorder-phone.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Record GIF" }).click();
  await expect(page.getByRole("button", { name: "Save GIF" })).toBeVisible({
    timeout: 25_000,
  });
  await page.getByRole("link", { name: "Download" }).click();
  await page.getByRole("button", { name: "Save GIF" }).click();
  await expect(page).toHaveURL(/\/signin\?/);
  const owner = `owner-${Date.now()}@example.com`;
  await signIn(page, owner, "/?save=1");
  await expect(page).toHaveURL(/\/gifs\/[a-f0-9]+$/);
  const gifUrl = page.url();
  const fileUrl = await page.locator(".gif-preview").getAttribute("src");
  expect(fileUrl).toBeTruthy();
  await page.screenshot({
    path: "test-results/gif-detail-phone.png",
    fullPage: true,
  });
  const friendContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const friend = await friendContext.newPage();
  await friend.goto(new URL("/signin", gifUrl).href);
  const friendEmail = `friend-${Date.now()}@example.com`;
  await signIn(friend, friendEmail, "/gifs");
  await friend.goto(gifUrl);
  await expect(friend.getByRole("alert")).toContainText("GIF unavailable");
  expect(
    (await friend.request.get(new URL(fileUrl!, gifUrl).href)).status(),
  ).toBe(404);
  await friendContext.close();

  await page.getByRole("link", { name: "Saved GIFs" }).click();
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${owner}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.getByRole("button", { name: "Delete account…" }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete account?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Saved GIFs", exact: true }),
  ).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeInViewport();
  await expect(page.locator(".gif-card")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/private-library-phone.png",
    fullPage: true,
  });
  await page.goto(gifUrl);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Delete GIF?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("link", { name: "Download" })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete GIF?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByText("No GIFs yet")).toBeVisible();
  await page.goto("/account");
  await expect(page).toHaveURL(/\/gifs#account$/);
  await expect(page.getByText(`Signed in as ${owner}`)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/gifs");
  await expect(page).toHaveURL(/\/signin\?next=/);
});
