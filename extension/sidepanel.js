const searchInput = document.getElementById("search");
const searchButton = document.getElementById("search-button");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const orgLabel = document.getElementById("org-label");
const pairingInput = document.getElementById("pairing-code");
const connectButton = document.getElementById("connect-button");
const connectionStatus = document.getElementById("connection-status");
const disconnectButton = document.getElementById("disconnect-button");
const BRIDGE = "http://127.0.0.1:17321";
let activeTab = null;
let connected = null;
let busy = false;
let pollTimer = null;
let heartbeatTimer = null;

function setStatus(message, error = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}
function setConnectionStatus(message, error = false) {
  connectionStatus.textContent = message;
  connectionStatus.classList.toggle("error", error);
  connectionStatus.classList.toggle("connected", !error && message.startsWith("Connected"));
  disconnectButton.hidden = !connected;
}
async function getSalesforceTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) throw new Error("Select a Salesforce tab first.");
  const url = new URL(tab.url);
  const supported = url.protocol === "https:" &&
    (url.hostname.endsWith(".my.salesforce.com") || url.hostname.endsWith(".lightning.force.com"));
  if (!supported) throw new Error("Open an authenticated Salesforce My Domain or Lightning org tab.");
  return { tab, url };
}
async function salesforceApi(action, tabId, term) {
  const response = await chrome.runtime.sendMessage({
    type: "loginDeckSalesforceApi", action, tabId, term
  });
  if (!response?.ok) throw new Error(response?.error || "Salesforce request failed in the extension service worker.");
  return response.data;
}
async function api(path, body) {
  const response = await fetch(BRIDGE + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not reach LoginDeck desktop. Is it running?");
  return data;
}
async function connectOrg() {
  connectButton.disabled = true;
  try {
    const { tab, url } = await getSalesforceTab();
    activeTab = tab;
    orgLabel.textContent = url.hostname;
    const user = await salesforceApi("getCurrentUser", tab.id);
    const browser = /Edg\//.test(navigator.userAgent) ? "edge" : "chrome";
    const result = await api("/api/connect", {
      code: pairingInput.value.trim(), browser, profileName: "Current browser profile",
      tabId: tab.id, orgUrl: url.origin, orgName: url.hostname,
      environment: /sandbox/i.test(url.hostname) ? "Sandbox" : "Production", user
    });
    connected = { connectionId: result.connectionId, token: result.token, tabId: tab.id, orgOrigin: url.origin, browser };
    const saved = await chrome.storage.local.get("loginDeckConnections");
    const connections = saved.loginDeckConnections || [];
    const remaining = connections.filter(item => !(item.tabId === tab.id && item.orgOrigin === url.origin));
    remaining.push(connected);
    await chrome.storage.local.set({ loginDeckConnections: remaining });
    setConnectionStatus("Connected · " + user.username);
    setStatus("Connected to LoginDeck. You can search users here or from the desktop app.");
    startPolling();
  } catch (error) {
    setConnectionStatus(error.message, true);
  } finally {
    connectButton.disabled = false;
  }
}
async function heartbeat() {
  if (!connected || busy) return;
  try {
    activeTab = await chrome.tabs.get(connected.tabId);
    const user = await salesforceApi("getCurrentUser", connected.tabId);
    await api("/api/heartbeat", { ...connected, user });
    setConnectionStatus("Connected · " + user.username);
  } catch (error) {
    setConnectionStatus("Connection issue · " + error.message, true);
  }
}
async function searchUsers(term) {
  if (!activeTab?.id) throw new Error("No Salesforce tab is selected.");
  return salesforceApi("searchUsers", activeTab.id, term);
}
async function openUserInSetup(userId) {
  const { url } = await getSalesforceTab();
  const target = new URL("/lightning/setup/ManageUsers/page", url.origin);
  target.searchParams.set("address", "/" + userId);
  await chrome.tabs.create({ url: target.toString(), active: true });
  setStatus("Opened the user in Setup. Use Salesforce's standard Login action there.");
}
function renderUsers(users) {
  resultsEl.replaceChildren();
  if (!users.length) { setStatus("No matching users found."); return; }
  setStatus(users.length + " user(s) found.");
  for (const user of users) {
    const card = document.createElement("article"); card.className = "user";
    const top = document.createElement("div"); top.className = "user-top";
    const info = document.createElement("div");
    const name = document.createElement("h3"); name.textContent = user.Name || "(No name)";
    const username = document.createElement("p"); username.textContent = user.Username || "";
    const email = document.createElement("p"); email.textContent = user.Email || "";
    info.append(name, username, email);
    const active = document.createElement("span"); active.className = "pill" + (user.IsActive ? "" : " inactive");
    active.textContent = user.IsActive ? "Active" : "Inactive"; top.append(info, active);
    const open = document.createElement("button"); open.type = "button"; open.textContent = "Open Login As in Setup ↗";
    open.addEventListener("click", () => openUserInSetup(user.Id).catch(error => setStatus(error.message, true)));
    card.append(top, open); resultsEl.append(card);
  }
}
async function executeCommand(command) {
  try {
    let result;
    if (command.type === "searchUsers") result = await searchUsers(command.term);
    else if (command.type === "openLoginAs") {
      const tab = await chrome.tabs.get(connected.tabId);
      const target = new URL("/lightning/setup/ManageUsers/page", new URL(tab.url).origin);
      target.searchParams.set("address", "/" + command.userId);
      const created = await chrome.tabs.create({ url: target.toString(), active: true });
      result = { tabId: created.id, url: target.toString() };
    } else throw new Error("Unsupported LoginDeck command.");
    await api("/api/result", { ...connected, commandId: command.id, result });
  } catch (error) {
    await api("/api/result", { ...connected, commandId: command.id, error: error.message }).catch(() => {});
  }
}
async function pollCommands() {
  if (!connected || busy) return;
  busy = true;
  try {
    activeTab = await chrome.tabs.get(connected.tabId);
    const data = await api("/api/next?connectionId=" + encodeURIComponent(connected.connectionId) +
      "&token=" + encodeURIComponent(connected.token));
    if (data.command) await executeCommand(data.command);
  } catch {} finally { busy = false; }
}
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  pollTimer = setInterval(pollCommands, 1500);
  heartbeatTimer = setInterval(heartbeat, 15000);
  pollCommands(); heartbeat();
}
async function runSearch() {
  const term = searchInput.value.trim();
  if (term.length < 2) { setStatus("Enter at least 2 characters."); return; }
  searchButton.disabled = true; resultsEl.replaceChildren(); setStatus("Searching Salesforce users…");
  try {
    const context = await getSalesforceTab(); activeTab = context.tab; orgLabel.textContent = context.url.hostname;
    renderUsers(await searchUsers(term));
  } catch (error) { setStatus(error.message || "Search failed.", true); }
  finally { searchButton.disabled = false; }
}
async function disconnect() {
  if (!connected) return;
  try { await api("/api/disconnect", connected); } catch {}
  const saved = await chrome.storage.local.get("loginDeckConnections");
  const remaining = (saved.loginDeckConnections || []).filter(item => item.connectionId !== connected.connectionId);
  await chrome.storage.local.set({ loginDeckConnections: remaining });
  connected = null;
  if (pollTimer) clearInterval(pollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  setConnectionStatus("Disconnected"); setStatus("Browser org disconnected from LoginDeck.");
}
connectButton.addEventListener("click", connectOrg);
disconnectButton.addEventListener("click", disconnect);
searchButton.addEventListener("click", runSearch);
searchInput.addEventListener("keydown", event => { if (event.key === "Enter") runSearch(); });

getSalesforceTab().then(({ tab, url }) => {
  activeTab = tab; orgLabel.textContent = url.hostname;
  setStatus("Ready. Connect this org to LoginDeck or search here.");
}).catch(error => { orgLabel.textContent = "No Salesforce org detected"; setStatus(error.message, true); });

chrome.storage.local.get("loginDeckConnections").then(async data => {
  const { tab } = await getSalesforceTab().catch(() => ({ tab: null }));
  const match = (data.loginDeckConnections || []).find(item => tab && item.tabId === tab.id);
  if (match) {
    connected = match; activeTab = tab; pairingInput.value = "";
    setConnectionStatus("Previously connected · checking…"); startPolling();
  }
}).catch(() => {});
