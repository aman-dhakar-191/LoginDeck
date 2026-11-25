const BRIDGE = "http://127.0.0.1:17321";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("loginDeckHeartbeat", { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("loginDeckHeartbeat", { periodInMinutes: 0.5 });
});

async function post(path, body) {
  const response = await fetch(BRIDGE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("LoginDeck desktop bridge request failed.");
  return response.json();
}

async function executeInTab(tabId, func, args = []) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args
  });
  return result?.[0]?.result;
}

async function currentUser(tabId) {
  return executeInTab(tabId, async () => {
    const apiOrigin = location.hostname.endsWith(".lightning.force.com")
      ? location.origin.replace(".lightning.force.com", ".my.salesforce.com")
      : location.origin;
    const versionsResponse = await fetch(apiOrigin + "/services/data/", { credentials: "include" });
    if (!versionsResponse.ok) throw new Error("Salesforce session unavailable.");
    const versions = await versionsResponse.json();
    const version = versions.map(item => Number(item.version)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (!version) throw new Error("Salesforce API version unavailable.");
    const response = await fetch(apiOrigin + "/services/data/v" + version.toFixed(1) + "/chatter/users/me", { credentials: "include" });
    const user = await response.json().catch(() => ({}));
    if (!response.ok || !(user.id || user.Id) || !(user.username || user.Username)) {
      throw new Error("Admin identity unavailable.");
    }
    return {
      id: user.id || user.Id,
      name: user.name || user.Name || "",
      username: user.username || user.Username,
      email: user.email || user.Email || ""
    };
  });
}

async function processCommand(tabId, connection, command) {
  try {
    let result;
    if (command.type === "searchUsers") {
      result = await executeInTab(tabId, async term => {
        const escaped = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const apiOrigin = location.hostname.endsWith(".lightning.force.com")
          ? location.origin.replace(".lightning.force.com", ".my.salesforce.com")
          : location.origin;
        const versionsResponse = await fetch(apiOrigin + "/services/data/", { credentials: "include" });
        if (!versionsResponse.ok) throw new Error("Salesforce API unavailable.");
        const versions = await versionsResponse.json();
        const version = versions.map(item => Number(item.version)).filter(Number.isFinite).sort((a, b) => b - a)[0];
        if (!version) throw new Error("Salesforce API version unavailable.");
        const soql = "SELECT Id, Name, Username, Email, IsActive FROM User WHERE Name LIKE '%" + escaped +
          "%' OR Username LIKE '%" + escaped + "%' OR Email LIKE '%" + escaped + "%' ORDER BY Name LIMIT 30";
        const response = await fetch(apiOrigin + "/services/data/v" + version.toFixed(1) + "/query/?q=" + encodeURIComponent(soql), { credentials: "include" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.[0]?.message || payload?.message || "Salesforce user search failed.");
        return payload.records || [];
      }, [command.term]);
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
      const user = await currentUser(connection.tabId);
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
});
