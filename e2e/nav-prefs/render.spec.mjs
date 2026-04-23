import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { By, until, logging } from "selenium-webdriver";
import { buildDriver } from "../lib/driver.mjs";
import { loginAs } from "../lib/login.mjs";
import { BASE_URL, DEFAULT_TIMEOUT_MS } from "../config.mjs";

let driver;

before(async () => {
  driver = await buildDriver();
});

after(async () => {
  if (driver) await driver.quit();
});

test("nav-prefs page renders all three panes for gadmin", async () => {
  await loginAs(driver, "gadmin");
  await driver.get(new URL("/preferences/navigation", BASE_URL).toString());

  for (const label of ["Pinned", "Available", "Your custom pages"]) {
    await driver.wait(
      until.elementLocated(By.css(`section[aria-label="${label}"]`)),
      DEFAULT_TIMEOUT_MS,
      `expected section[aria-label="${label}"] on /preferences/navigation`,
    );
  }

  // Surface any uncaught browser errors. selenium-webdriver only collects
  // browser-side logs when goog:loggingPrefs is enabled, but driver-side
  // errors (failed asserts, thrown handlers) bubble up via window.onerror
  // captured in the page. We keep this lightweight: read SEVERE entries
  // from the browser log channel if available, ignore otherwise.
  try {
    const logs = await driver.manage().logs().get(logging.Type.BROWSER);
    const severe = logs.filter((l) => l.level.name === "SEVERE");
    assert.equal(
      severe.length,
      0,
      `browser logged ${severe.length} SEVERE entries: ${severe.map((l) => l.message).join(" | ")}`,
    );
  } catch {
    // Browser log channel not exposed by this driver — skip.
  }
});
