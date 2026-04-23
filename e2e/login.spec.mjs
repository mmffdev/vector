import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { By, until } from "selenium-webdriver";
import { buildDriver } from "./lib/driver.mjs";
import { loginAs } from "./lib/login.mjs";
import { DEFAULT_TIMEOUT_MS, BASE_URL } from "./config.mjs";

let driver;

before(async () => {
  driver = await buildDriver();
});

after(async () => {
  if (driver) await driver.quit();
});

test("gadmin can log in and see the dashboard", async () => {
  await loginAs(driver, "gadmin");

  const finalUrl = await driver.getCurrentUrl();
  assert.ok(
    finalUrl.startsWith(new URL("/dashboard", BASE_URL).toString()),
    `expected to land on /dashboard, got ${finalUrl}`,
  );

  // Stable text from the dashboard page (app/(user)/dashboard/page.tsx).
  await driver.wait(
    until.elementLocated(By.xpath("//*[contains(text(),'Welcome to Vector')]")),
    DEFAULT_TIMEOUT_MS,
    "expected 'Welcome to Vector' on dashboard",
  );
});
