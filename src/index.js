const { chromium } = require("playwright");

const DEFAULT_URL = "https://login.salesforce.com";
const ALLOWED_BROWSERS = new Set(["chromium", "chrome", "msedge"]);

function readConfig() {
  const browserName = (process.env.BROWSER || "chromium").toLowerCase();
  const startUrl = process.env.SALESFORCE_URL || DEFAULT_URL;
  const sessionCount = Number.parseInt(process.env.SESSION_COUNT || "2", 10);

  if (!ALLOWED_BROWSERS.has(browserName)) {
    throw new Error('BROWSER must be "chromium", "chrome", or "msedge".');
  }
  if (!Number.isInteger(sessionCount) || sessionCount < 1 || sessionCount > 10) {
    throw new Error("SESSION_COUNT must be an integer between 1 and 10.");
  }

  let parsedUrl;
  try { parsedUrl = new URL(startUrl); }
  catch { throw new Error("SALESFORCE_URL must be a valid URL."); }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("SALESFORCE_URL must use HTTPS.");
  }
  return { browserName, startUrl: parsedUrl.toString(), sessionCount };
}

async function main() {
  const { browserName, startUrl, sessionCount } = readConfig();
  const launchOptions = { headless: false };
  if (browserName !== "chromium") launchOptions.channel = browserName;

  const browser = await chromium.launch(launchOptions);
  const contexts = [];
  let shuttingDown = false;

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    await browser.close().catch(() => {});
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    for (let index = 1; index <= sessionCount; index += 1) {
      // Each context gets a separate cookie jar and browser storage.
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();

      page.on("pageerror", error =>
        console.error(`[Session ${index}] Page error: ${error.message}`)
      );

      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
      console.log(`[Session ${index}] Opened ${browserName} at ${startUrl}`);
    }

    console.log("\nLoginDeck is running. Close all browser windows or press Ctrl+C to exit.");
    await new Promise(resolve => browser.on("disconnected", resolve));
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await shutdown();
  }
}

main().catch(error => {
  console.error("LoginDeck startup failed:", error.message);
  process.exitCode = 1;
});
