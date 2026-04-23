import { By, until } from "selenium-webdriver";
import { BASE_URL, DEFAULT_TIMEOUT_MS } from "../config.mjs";
import { accountFor } from "./accounts.mjs";

// Log in as the named role and wait for the post-login destination.
//
// Pass `?redirect=/dashboard` so the test lands on a known page regardless of
// the user's start-page preference.
export async function loginAs(driver, role, { redirect = "/dashboard" } = {}) {
  const { email, password } = accountFor(role);

  const url = new URL("/login", BASE_URL);
  if (redirect) url.searchParams.set("redirect", redirect);
  await driver.get(url.toString());

  const emailInput = await driver.wait(
    until.elementLocated(By.css('input[type="email"]')),
    DEFAULT_TIMEOUT_MS,
  );
  await emailInput.sendKeys(email);

  const pwInput = await driver.findElement(By.css('input[type="password"]'));
  await pwInput.sendKeys(password);

  // Diagnostic: confirm what actually landed in the inputs (some chars get
  // mangled by keyboard-layout differences in containerised browsers).
  const sentEmail = await emailInput.getAttribute("value");
  const sentPw = await pwInput.getAttribute("value");
  if (sentEmail !== email || sentPw !== password) {
    throw new Error(
      `input mismatch: emailWanted="${email}" got="${sentEmail}" / ` +
      `pwLen=${password.length} gotLen=${sentPw.length}`,
    );
  }

  const submit = await driver.findElement(By.css('button[type="submit"]'));
  await submit.click();

  // Wait for the URL to leave /login. On failure, dump the visible error
  // message so we don't have to guess (bad creds vs. network vs. backend).
  try {
    await driver.wait(
      async () => !(await driver.getCurrentUrl()).includes("/login"),
      DEFAULT_TIMEOUT_MS,
      "login did not redirect away from /login",
    );
  } catch (e) {
    let errText = "(no error slot found)";
    try {
      const slot = await driver.findElement(By.css('[role="alert"]'));
      errText = (await slot.getText()).trim() || "(error slot empty)";
    } catch {
      // ignore
    }
    const url = await driver.getCurrentUrl();
    e.message += ` — currentUrl=${url} pageError="${errText}"`;
    throw e;
  }
}
