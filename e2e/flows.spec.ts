import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const outbox = "data/mail-outbox.jsonl";
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
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  await page.getByLabel("Six-digit code").fill(latestCode(email));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Display name")).toBeVisible();
  await page.getByLabel("Display name").fill(email.split("@")[0]);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("record, save, share, join, and revoke access", async ({
  browser,
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.getByText("Camera ready")).toBeVisible({ timeout: 15_000 });
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
  await page.getByLabel("Email address").fill(owner);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  await page.getByLabel("Six-digit code").fill(latestCode(owner));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Display name").fill("Owner");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Save GIF" })).toBeVisible();
  await page.getByRole("button", { name: "anger" }).click();
  await page.getByRole("button", { name: "Save privately" }).click();
  await expect(page).toHaveURL(/\/gifs\/[a-f0-9]+$/);
  await expect(page.getByText("Only you can see this GIF")).toBeVisible();
  const gifUrl = page.url();
  await page.getByRole("link", { name: "Groups", exact: true }).first().click();
  await page.getByRole("link", { name: "Create group" }).first().click();
  await page.getByLabel("Group name").fill("The crew");
  await page.getByRole("button", { name: "Create group" }).click();
  await page.getByRole("link", { name: "Manage group" }).click();
  await page.screenshot({
    path: "test-results/group-manage-phone.png",
    fullPage: true,
  });
  const invite = await page.getByLabel("Invite link").inputValue();
  await page.goto(gifUrl);
  await page.getByRole("link", { name: "Edit tags & sharing" }).click();
  await page
    .locator(".group-choice")
    .filter({ hasText: "The crew" })
    .locator("label")
    .click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Shared with: The crew")).toBeVisible();
  await page.screenshot({
    path: "test-results/gif-detail-phone.png",
    fullPage: true,
  });
  const friendContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const friend = await friendContext.newPage();
  await friend.goto(invite);
  await expect(
    friend.getByRole("heading", { name: "Join The crew" }),
  ).toBeVisible();
  const friendEmail = `friend-${Date.now()}@example.com`;
  await signIn(friend, friendEmail, new URL(invite).pathname);
  await friend.getByRole("button", { name: "Join group" }).click();
  await expect(friend.getByRole("heading", { name: "The crew" })).toBeVisible();
  await friend.getByRole("button", { name: "anger" }).click();
  await expect(friend.locator(".gif-card")).toHaveCount(1);
  await friend.locator(".gif-card").click();
  await expect(friend.getByRole("link", { name: "Download" })).toBeVisible();
  await page.goto(gifUrl);
  await page.getByRole("link", { name: "Edit tags & sharing" }).click();
  await page
    .locator(".group-choice")
    .filter({ hasText: "The crew" })
    .locator("label")
    .click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await friend.reload();
  await expect(friend.getByRole("alert")).toContainText("GIF unavailable");
  await friendContext.close();
});
