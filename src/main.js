const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

let mainWindow;
const activeSessions = new Map();
const sessionsFile = () => path.join(app.getPath("userData"), "sessions.json");
const profilesDir = () => path.join(app.getPath("userData"), "browser-profiles");

async function readSavedSessions() {
  try {
    const value = JSON.parse(await fs.readFile(sessionsFile(), "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function saveSessions(items) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(sessionsFile(), JSON.stringify(items, null, 2), "utf8");
}

function validSalesforceUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:" && (
    url.hostname === "login.salesforce.com" ||
    url.hostname === "test.salesforce.com" ||
    url.hostname.endsWith(".my.salesforce.com") ||
    url.hostname.endsWith(".lightning.force.com")
  );
}

function browserChannel(browser) {
  if (browser === "chrome") return "chrome";
  if (browser === "edge") return "msedge";
  throw new Error("Choose Google Chrome or Microsoft Edge.");
}

function validId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    title: "LoginDeck",
    backgroundColor: "#0b1020",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  await mainWindow.loadFile(path.join(__dirname, "index.html"));
}

ipcMain.handle("sessions:list", async () => readSavedSessions());

ipcMain.handle("sessions:save", async (_event, input) => {
  const name = String(input?.name || "").trim().slice(0, 50);
  const url = String(input?.url || "").trim();
  const browser = String(input?.browser || "edge");
  if (!name) throw new Error("Give this session a name.");
  if (!validSalesforceUrl(url)) throw new Error("Enter a valid HTTPS Salesforce login or My Domain URL.");
  browserChannel(browser);

  const items = await readSavedSessions();
  const id = input?.id || crypto.randomUUID();
  if (!validId(id)) throw new Error("Invalid session identifier.");
  const record = { id, name, url, browser };
  const existing = items.findIndex(item => item.id === id);
  if (existing >= 0) items[existing] = record;
  else items.push(record);
  await saveSessions(items);
  return record;
});

ipcMain.handle("sessions:delete", async (_event, id) => {
  if (!validId(id)) throw new Error("Invalid session identifier.");
  const active = activeSessions.get(id);
  if (active) {
    await active.context.close().catch(() => {});
    activeSessions.delete(id);
  }
  const items = (await readSavedSessions()).filter(item => item.id !== id);
  await saveSessions(items);
  await fs.rm(path.join(profilesDir(), id), { recursive: true, force: true });
  return items;
});

ipcMain.handle("sessions:launch", async (_event, id) => {
  if (!validId(id)) throw new Error("Invalid session identifier.");
  const items = await readSavedSessions();
  const session = items.find(item => item.id === id);
  if (!session) throw new Error("Session configuration not found.");
  if (activeSessions.has(id)) {
    const existing = activeSessions.get(id);
    await existing.page.bringToFront().catch(() => {});
    return { id, status: "already-open" };
  }

  const channel = browserChannel(session.browser);
  const profilePath = path.join(profilesDir(), id);
  await fs.mkdir(profilePath, { recursive: true });

  // Each persistent context gets a dedicated on-disk profile, cookie jar and storage.
  let context;
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      channel,
      headless: false,
      viewport: null,
      args: ["--new-window"]
    });
  } catch (error) {
    if (/executable|not found|could not find/i.test(error.message)) {
      throw new Error(`${session.browser === "edge" ? "Microsoft Edge" : "Google Chrome"} was not found. Install it, then try again.`);
    }
    throw error;
  }

  const page = context.pages()[0] || await context.newPage();
  activeSessions.set(id, { context, page });
  context.on("close", () => activeSessions.delete(id));
  await page.goto(session.url, { waitUntil: "domcontentloaded" });
  return { id, status: "launched" };
});

ipcMain.handle("app:openExternal", async (_event, url) => {
  if (typeof url !== "string" || !url.startsWith("https://")) return;
  await shell.openExternal(url);
});

app.whenReady().then(async () => {
  await createMainWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (activeSessions.size === 0) return;
  event.preventDefault();
  const contexts = [...activeSessions.values()].map(item => item.context);
  activeSessions.clear();
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  app.exit(0);
});
