import { Builder } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import firefox from "selenium-webdriver/firefox.js";
import { SELENIUM_URL, BROWSER } from "../config.mjs";

// Build a remote WebDriver pointed at the Vector-Selenium hub.
// Headed by default so noVNC (http://localhost:7900) shows the action.
export async function buildDriver() {
  const builder = new Builder().usingServer(SELENIUM_URL).forBrowser(BROWSER);

  if (BROWSER === "chrome") {
    const opts = new chrome.Options();
    opts.addArguments("--window-size=1400,900");
    // Inside the Selenium container "localhost" is the container itself.
    // Remap both the frontend (5101) and backend (5100) ports to the Mac
    // host so the browser sees the same origins as a normal local dev
    // session — keeps the backend's CORS allowlist (localhost:5101) happy.
    opts.addArguments(
      "--host-resolver-rules=" +
        "MAP localhost:5101 host.docker.internal:5101," +
        "MAP localhost:5100 host.docker.internal:5100",
    );
    builder.setChromeOptions(opts);
  } else if (BROWSER === "firefox") {
    const opts = new firefox.Options();
    builder.setFirefoxOptions(opts);
  }

  return builder.build();
}
