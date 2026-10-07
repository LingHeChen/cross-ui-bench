const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("benchNative", {
  metadata: () => ipcRenderer.invoke("metadata"),
  sample: () => ipcRenderer.invoke("sample"),
  save: (result) => ipcRenderer.invoke("save", result),
});
