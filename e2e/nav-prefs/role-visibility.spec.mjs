import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { By, until } from "selenium-webdriver";
import { buildDriver } from "../lib/driver.mjs";
import { loginAs } from "../lib/login.mjs";
import { BASE_URL, DEFAULT_TIMEOUT_MS } from "../config.mjs";

// Role-gated catalogue items per db/schema/009_page_registry.sql:
//   - Workspace Settings → gadmin only
//   - Portfolio Settings → padmin + gadmin
//   - Account Settings   → all roles
//
// Whether they're in Pinned or Available doesn't matter — the label appears
// on the page if and only if the user's catalogue includes the item.
const EXPECT = {
  user:   { present: ["Account Settings"],
            absent:  ["Workspace Settings", "Portfolio Settings"] },
  padmin: { present: ["Account Settings", "Portfolio Settings"],
            absent:  ["Workspace Settings"] },
  gadmin: { present: ["Account Settings", "Portfolio Settings", "Workspace Settings"],
            absent:  [] },
};

let driver;

before(async () => { driver = await buildDriver(); });
after(async () => { if (driver) await driver.quit(); });

async function logoutInPage() {
  // Storage APIs are disabled on data: URLs (Chrome's blank-tab default),
  // so navigate to a real http origin first, then clear cookies + storage.
  await driver.get(new URL("/login", BASE_URL).toString());
  await driver.manage().deleteAllCookies();
  await driver.executeScript("window.localStorage.clear(); window.sessionStorage.clear();");
}

for (const role of /** @type {const} */ (["user", "padmin", "gadmin"])) {
  test(`nav-prefs catalogue visibility: ${role}`, async () => {
    await logoutInPage();
    await loginAs(driver, role, { redirect: "/preferences/navigation" });

    // Wait for the page to mount before scraping text.
    await driver.wait(
      until.elementLocated(By.css('section[aria-label="Available"]')),
      DEFAULT_TIMEOUT_MS,
      `nav-prefs page failed to render for ${role}`,
    );

    const body = await driver.findElement(By.tagName("body")).getText();

    for (const label of EXPECT[role].present) {
      assert.ok(
        body.includes(label),
        `${role}: expected "${label}" on page. body=\n${body}`,
      );
    }
    for (const label of EXPECT[role].absent) {
      assert.ok(
        !body.includes(label),
        `${role}: did NOT expect "${label}" on page. body=\n${body}`,
      );
    }
  });
}
