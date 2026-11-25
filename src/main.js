const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

let mainWindow;
let updateCheckStarted = false;
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

function sendUpdateStatus(status, details = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updater:status", { status, ...details });
}

ipcMain.handle("updater:version", async () => app.getVersion());
ipcMain.handle("updater:check", async () => {
  if (!app.isPackaged) return { status: "development" };
  try {
    sendUpdateStatus("checking");
    await autoUpdater.checkForUpdates();
    return { status: "checking" };
  } catch (error) {
    sendUpdateStatus("error", { message: error.message });
    throw error;
  }
});
ipcMain.handle("updater:install", async () => {
  if (!app.isPackaged) throw new Error("Updates are available only in the installed app.");
  autoUpdater.quitAndInstall();
});

async function inspectSessionStatus(session) {
  const active = activeSessions.get(session.id);
  if (!active) {
    return {
      status: session.profileMode === "personal" ? "external" : "closed",
      label: session.profileMode === "personal" ? "Browser profile · status not connected" : "Not open"
    };
  }
  try {
    const state = await active.page.evaluate(async () => {
      const current = location.href;
      if (/\/login|login\.salesforce\.com|test\.salesforce\.com\/\?/.test(current)) {
        return { authenticated: false };
      }
      const versionsResponse = await fetch("/services/data/", { credentials: "include" });
      if (!versionsResponse.ok) return { authenticated: false };
      const versions = await versionsResponse.json();
      const version = versions.map(item => Number(item.version)).filter(Number.isFinite).sort((a, b) => b - a)[0];
      if (!version) return { authenticated: false };
      const response = await fetch("/services/data/v" + version.toFixed(1) + "/chatter/users/me", { credentials: "include" });
      if (!response.ok) return { authenticated: false };
      const user = await response.json();
      return {
        authenticated: true,
        user: {
          id: user.id || user.Id,
          name: user.name || user.Name,
          username: user.username || user.Username,
          email: user.email || user.Email
        }
      };
    });
    if (state.authenticated && state.user?.username) {
      return { status: "authenticated", label: "Signed in as " + (state.user.name || state.user.username), user: state.user };
    }
    return { status: "open", label: "Browser open · sign-in not detected" };
  } catch {
    return { status: "unknown", label: "Checking sign-in…" };
  }
}

ipcMain.handle("sessions:list", async () => {
  const sessions = await readSavedSessions();
  return Promise.all(sessions.map(async session => ({
    ...session,
    connection: await inspectSessionStatus(session)
  })));
});

ipcMain.handle("sessions:save", async (_event, input) => {
  const name = String(input?.name || "").trim().slice(0, 50);
  const url = String(input?.url || "").trim();
  const browser = String(input?.browser || "edge");
  const profileMode = input?.profileMode === "personal" ? "personal" : "isolated";
  if (!name) throw new Error("Give this session a name.");
  if (!validSalesforceUrl(url)) throw new Error("Enter a valid HTTPS Salesforce login or My Domain URL.");
  browserChannel(browser);

  const items = await readSavedSessions();
  const id = input?.id || crypto.randomUUID();
  if (!validId(id)) throw new Error("Invalid session identifier.");
  const record = { id, name, url, browser, profileMode };
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

  // Personal mode launches the selected installed browser without a custom
  // user-data-dir, so Chromium reuses that user's normal profile and sign-in.
  // LoginDeck never reads or copies cookies or saved passwords.
  if (session.profileMode === "personal") {
    if (process.platform !== "win32") {
      throw new Error("Using an existing browser profile is currently supported on Windows only.");
    }
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"]
    ].filter(Boolean);
    const relative = session.browser === "chrome"
      ? ["Google/Chrome/Application/chrome.exe"]
      : ["Microsoft/Edge/Application/msedge.exe"];
    const candidates = roots.flatMap(root => relative.map(item => path.join(root, item)));
    let executable = null;
    for (const candidate of candidates) {
      try { await fs.access(candidate); executable = candidate; break; } catch {}
    }
    if (!executable) {
      throw new Error(`${session.browser === "edge" ? "Microsoft Edge" : "Google Chrome"} was not found. Install it, then try again.`);
    }
    const child = spawn(executable, [session.url], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", error => console.error("Could not open personal browser profile:", error));
    child.unref();
    return { id, status: session.browser === "edge" ? "opened-personal-edge" : "opened-personal-chrome" };
  }

  if (activeSessions.has(id)) {
    const existing = activeSessions.get(id);
    await existing.page.bringToFront().catch(() => {});
    return { id, status: "already-open" };
  }

  const channel = browserChannel(session.browser);
  const profilePath = path.join(profilesDir(), id);
  await fs.mkdir(profilePath, { recursive: true });

  // Isolated mode owns a separate on-disk profile, cookie jar and storage.
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


ipcMain.handle("salesforce:searchUsers", async (_event, { sessionId, term }) => {
  if (!String(sessionId || "").startsWith("bridge:") && !validId(sessionId)) throw new Error("Choose a valid Salesforce admin session.");
  const query = String(term || "").trim().slice(0, 100);
  if (query.length < 2) throw new Error("Enter at least 2 characters.");
  if (String(sessionId).startsWith("bridge:")) {
    const connection = bridgeConnections.get(String(sessionId).slice(7));
    if (!connection || Date.now() - connection.lastSeen > 120000) throw new Error("Browser extension is disconnected. Reconnect it first.");
    return dispatchBridgeCommand(connection, "searchUsers", { term: query });
  }
  const session = (await readSavedSessions()).find(item => item.id === sessionId);
  if (!session) throw new Error("Saved admin session not found.");
  if (session.profileMode === "personal") {
    throw new Error("Connect this Personal browser profile using the LoginDeck extension first.");
  }
  const active = activeSessions.get(sessionId);
  if (!active) throw new Error("Open this admin session first, sign in to Salesforce, then search again.");

  return active.page.evaluate(async (term) => {
    const escaped = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const versionsResponse = await fetch("/services/data/", { credentials: "include" });
    if (!versionsResponse.ok) throw new Error("Salesforce API is unavailable. Check your admin login and API access.");
    const versions = await versionsResponse.json();
    const version = versions.map(item => Number(item.version)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (!version) throw new Error("Could not determine the Salesforce REST API version.");
    const soql = "SELECT Id, Name, Username, Email, IsActive FROM User WHERE Name LIKE '%" + escaped + "%' OR Username LIKE '%" + escaped + "%' OR Email LIKE '%" + escaped + "%' ORDER BY Name LIMIT 30";
    const response = await fetch("/services/data/v" + version.toFixed(1) + "/query/?q=" + encodeURIComponent(soql), { credentials: "include" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.[0]?.message || payload?.message || "Salesforce rejected the user search.");
    return (payload.records || []).map(({ Id, Name, Username, Email, IsActive }) => ({ Id, Name, Username, Email, IsActive }));
  }, query);
});

ipcMain.handle("salesforce:openLoginAs", async (_event, { sessionId, userId }) => {
  if (!String(sessionId || "").startsWith("bridge:") && !validId(sessionId)) throw new Error("Choose a valid Salesforce admin session.");
  if (typeof userId !== "string" || !/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(userId)) {
    throw new Error("Invalid Salesforce user ID.");
  }
  if (String(sessionId).startsWith("bridge:")) {
    const connection = bridgeConnections.get(String(sessionId).slice(7));
    if (!connection || Date.now() - connection.lastSeen > 120000) throw new Error("Browser extension is disconnected. Reconnect it first.");
    return dispatchBridgeCommand(connection, "openLoginAs", { userId });
  }
  const session = (await readSavedSessions()).find(item => item.id === sessionId);
  if (!session || session.profileMode === "personal") {
    throw new Error("Select a connected browser or LoginDeck isolated admin session.");
  }
  const active = activeSessions.get(sessionId);
  if (!active) throw new Error("Open and sign in to the selected admin session first.");
  const currentUrl = new URL(active.page.url());
  if (!validSalesforceUrl(currentUrl.origin)) throw new Error("The selected session is not currently on a Salesforce page.");
  const target = new URL("/lightning/setup/ManageUsers/page", currentUrl.origin);
  target.searchParams.set("address", "/" + userId);
  const page = await active.context.newPage();
  await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  return { status: "opened", url: target.toString() };
});

ipcMain.handle("app:openExternal", async (_event, url) => {
  if (typeof url !== "string" || !url.startsWith("https://")) return;
  await shell.openExternal(url);
});

app.whenReady().then(async () => {
  await createMainWindow();

  if (app.isPackaged && !updateCheckStarted) {
    updateCheckStarted = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking"));
    autoUpdater.on("update-available", info => sendUpdateStatus("available", { version: info.version }));
    autoUpdater.on("update-not-available", info => sendUpdateStatus("up-to-date", { version: info.version }));
    autoUpdater.on("download-progress", progress => sendUpdateStatus("downloading", {
      percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total
    }));
    autoUpdater.on("update-downloaded", info => sendUpdateStatus("downloaded", { version: info.version }));
    autoUpdater.on("error", error => sendUpdateStatus("error", { message: error.message }));
    setTimeout(() => autoUpdater.checkForUpdates().catch(error => {
      sendUpdateStatus("error", { message: error.message });
    }), 4500);
  }
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
