const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("loginDeck", {
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  saveSession: (session) => ipcRenderer.invoke("sessions:save", session),
  deleteSession: (id) => ipcRenderer.invoke("sessions:delete", id),
  launchSession: (id) => ipcRenderer.invoke("sessions:launch", id),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url)
});
