"use strict";const e=require("electron");e.contextBridge.exposeInMainWorld("electronAPI",{selectDirectory:()=>e.ipcRenderer.invoke("select-directory")});
