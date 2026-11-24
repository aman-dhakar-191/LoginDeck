const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("loginDeck", {
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  saveSession: (session) => ipcRenderer.invoke("sessions:save", session),
  deleteSession: (id) => ipcRenderer.invoke("sessions:delete", id),
  launchSession: (id) => ipcRenderer.invoke("sessions:launch", id),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  searchSalesforceUsers: (sessionId, term) => ipcRenderer.invoke("salesforce:searchUsers", { sessionId, term }),
  openLoginAs: (sessionId, userId) => ipcRenderer.invoke("salesforce:openLoginAs", { sessionId, userId }),
  getAppVersion: () => ipcRenderer.invoke("updater:version"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  onUpdateStatus: callback => subscribe("updater:status", callback)
});
