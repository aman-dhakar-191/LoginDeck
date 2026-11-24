const { chromium } = require("playwright");

const DEFAULT_SALESFORCE_URL = "https://login.salesforce.com";

function getConfig() {
  const startUrl = process.env.SALESFORCE_URL || DEFAULT_SALESFORCE_URL;
  const sessionCount = Number.parseInt(process.env.SESSION_COUNT || "2", 10);

  if (!Number.isInteger(sessionCount) || sessionCount < 1 || sessionCount > 10) {
    throw new Error("SESSION_COUNT must be an integer between 1 and 10.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(startUrl);
  } catch {
    throw new Error("SALESFORCE_URL must be a valid URL.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("SALESFORCE_URL must use HTTPS.");
  }

  return { startUrl: parsedUrl.toString(), sessionCount };
}

async function main() {
  const { startUrl, sessionCount } = getConfig();
  const browser = await chromium.launch({
    headless: false,
    args: ["--new-window"],
  });

  const contexts = [];
  let closing = false;

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await browser.close().catch(() => {});
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    for (let index = 1; index <= sessionCount; index += 1) {
      // A new BrowserContext is a separate browser session with its own cookies/storage.
      const context = await browser.newContext();
      contexts.push(context);

      const page = await context.newPage();
      page.on("pageerror", (error) => {
        console.error(`[Session ${index}] Page error:`, error.message);
      });

      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
      console.log(`[Session ${index}] Opened isolated window: ${startUrl}`);
    }

    console.log("\nLoginDeck is running. Close all windows or press Ctrl+C to exit.");
    await new Promise((resolve) => {
      browser.on("disconnected", resolve);
    });
  } finally {
    for (const context of contexts) {
      await context.close().catch(() => {});
    }
    await shutdown();
  }
}

main().catch((error) => {
  console.error("LoginDeck failed to start:", error.message);
  process.exitCode = 1;
});
