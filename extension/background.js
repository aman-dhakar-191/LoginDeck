const BRIDGE = "http://127.0.0.1:17321";

async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("LoginDeck could not configure toolbar side-panel behaviour:", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  configureSidePanel();
  chrome.alarms.create("loginDeckHeartbeat", { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  configureSidePanel();
  chrome.alarms.create("loginDeckHeartbeat", { periodInMinutes: 0.5 });
});
configureSidePanel();

async function post(path, body) {
  const response = await fetch(BRIDGE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("LoginDeck desktop bridge request failed.");
  return response.json();
}

// Salesforce REST calls run in the extension service worker, not the Lightning
// page. Host permissions allow this cross-origin request without page CORS.
function salesforceApiOrigin(tabUrl) {
  const url = new URL(tabUrl);
  if (url.protocol !== "https:") throw new Error("Salesforce connection requires HTTPS.");
  if (url.hostname.endsWith(".lightning.force.com")) {
    return url.origin.replace(".lightning.force.com", ".my.salesforce.com");
  }
  if (url.hostname.endsWith(".my.salesforce.com")) return url.origin;
  throw new Error("Open an authenticated Salesforce My Domain or Lightning tab.");
}

async function salesforceRequest(tabUrl, path) {
  const origin = salesforceApiOrigin(tabUrl);
  const response = await fetch(origin + path, {
    method: "GET",
    credentials: "include",
    headers: { "Accept": "application/json" },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(payload) ? payload.map(item => item.message).filter(Boolean).join("; ") : payload.message;
    if (response.status === 401 || response.status === 302) {
      throw new Error("Salesforce session is not authenticated for its My Domain API. Reopen the org and sign in.");
    }
    throw new Error(message || `Salesforce API request failed (HTTP ${response.status}).`);
  }
  return payload;
}

async function salesforceApiVersion(tabUrl) {
  const versions = await salesforceRequest(tabUrl, "/services/data/");
  const version = versions.map(item => Number(item.version)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (!version) throw new Error("Salesforce did not return an available REST API version.");
  return version.toFixed(1);
}

async function getSalesforceUser(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) throw new Error("The connected Salesforce tab is unavailable.");
  const version = await salesforceApiVersion(tab.url);
  const user = await salesforceRequest(tab.url, `/services/data/v${version}/chatter/users/me`);
  const id = user.id || user.Id;
  const username = user.username || user.Username;
  if (!id || !username) throw new Error("Salesforce responded, but did not provide the signed-in user's identity.");
  return {
    id,
    name: user.name || user.Name || "",
    username,
    email: user.email || user.Email || ""
  };
}

async function searchSalesforceUsers(tabId, term) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) throw new Error("The connected Salesforce tab is unavailable.");
  const query = String(term || "").trim();
  if (query.length < 2) throw new Error("Enter at least 2 characters.");
  const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const version = await salesforceApiVersion(tab.url);
  const soql = "SELECT Id, Name, Username, Email, IsActive FROM User WHERE Name LIKE '%" + escaped +
    "%' OR Username LIKE '%" + escaped + "%' OR Email LIKE '%" + escaped + "%' ORDER BY Name LIMIT 30";
  const result = await salesforceRequest(tab.url,
    `/services/data/v${version}/query/?q=${encodeURIComponent(soql)}`);
  return result.records || [];
}

async function processCommand(tabId, connection, command) {
  try {
    let result;
    if (command.type === "searchUsers") {
      result = await searchSalesforceUsers(tabId, command.term);
    } else if (command.type === "openLoginAs") {
      const tab = await chrome.tabs.get(tabId);
      const url = new URL("/lightning/setup/ManageUsers/page", new URL(tab.url).origin);
      url.searchParams.set("address", "/" + command.userId);
      const created = await chrome.tabs.create({ url: url.toString(), active: true });
      result = { tabId: created.id, url: url.toString() };
    } else {
      throw new Error("Unsupported LoginDeck command.");
    }
    await post("/api/result", { ...connection, commandId: command.id, result });
  } catch (error) {
    await post("/api/result", { ...connection, commandId: command.id, error: error.message }).catch(() => {});
  }
}

async function tick() {
  const data = await chrome.storage.local.get("loginDeckConnections");
  const connections = data.loginDeckConnections || [];
  for (const connection of connections) {
    try {
      const tab = await chrome.tabs.get(connection.tabId);
      if (!tab.url || new URL(tab.url).origin !== connection.orgOrigin) {
        throw new Error("Connected Salesforce tab is no longer available.");
      }
      const user = await getSalesforceUser(connection.tabId);
      await post("/api/heartbeat", { ...connection, user });
      const query = BRIDGE + "/api/next?connectionId=" + encodeURIComponent(connection.connectionId) +
        "&token=" + encodeURIComponent(connection.token);
      const response = await fetch(query);
      if (!response.ok) throw new Error("LoginDeck desktop bridge disconnected.");
      const payload = await response.json();
      if (payload.command) await processCommand(connection.tabId, connection, payload.command);
    } catch {
      // The desktop UI marks this connection offline after missed heartbeats.
    }
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "loginDeckHeartbeat") tick();
});
chrome.runtime.onStartup.addListener(() => tick());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "loginDeckWake") {
    tick().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "loginDeckSalesforceApi") {
    (async () => {
      const tabId = Number(message.tabId);
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || !salesforceApiOrigin(tab.url)) throw new Error("Select an authenticated Salesforce org tab.");
      if (message.action === "getCurrentUser") return getSalesforceUser(tabId);
      if (message.action === "searchUsers") return searchSalesforceUsers(tabId, message.term);
      throw new Error("Unsupported Salesforce API action.");
    })().then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
