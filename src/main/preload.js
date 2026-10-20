// The only surface the sandboxed renderer has into the system. Every method
// maps to a validated handler in src/main/ipc; nothing here touches Node APIs.
"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = (channel) => (cb) => {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("edex", {
  app: {
    info: invoke("app:info"),
    quit: invoke("app:quit"),
    hide: invoke("app:hide"),
    devtools: invoke("app:devtools"),
    reload: invoke("app:reload"),
    takeoverState: invoke("takeover:state"),
    takeoverPeek: invoke("takeover:peek"),
    onVisibility: subscribe("app:visibility"),
    onMode: subscribe("app:mode"),
    onCommand: subscribe("app:command"),
    onNotice: subscribe("app:notice")
  },
  settings: {
    get: invoke("settings:get"),
    set: invoke("settings:set"),
    onChange: subscribe("settings:changed")
  },
  themes: {
    list: invoke("themes:list"),
    get: invoke("themes:get"),
    save: invoke("themes:save"),
    folder: invoke("themes:folder"),
    import: invoke("themes:import"),
    export: invoke("themes:export"),
    remove: invoke("themes:remove")
  },
  term: {
    shells: invoke("term:shells"),
    spawn: invoke("term:spawn"),
    kill: invoke("term:kill"),
    write: (id, data) => ipcRenderer.send("term:write", { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send("term:resize", { id, cols, rows }),
    onData: subscribe("term:data"),
    onExit: subscribe("term:exit")
  },
  sys: {
    static: invoke("sys:static"),
    live: invoke("sys:live"),
    appUsage: invoke("sys:appUsage"),
    cpu: invoke("sys:cpu"),
    mem: invoke("sys:mem"),
    battery: invoke("sys:battery"),
    temp: invoke("sys:temp"),
    drives: invoke("sys:drives"),
    net: invoke("sys:net"),
    netStats: invoke("sys:netStats"),
    gpu: invoke("sys:gpu"),
    diskIO: invoke("sys:diskIO"),
    processes: invoke("sys:processes"),
    uptime: invoke("sys:uptime"),
    kill: invoke("sys:kill"),
    snapshot: invoke("sys:snapshot")
  },
  fs: {
    home: invoke("fs:home"),
    places: invoke("fs:places"),
    list: invoke("fs:list"),
    stat: invoke("fs:stat"),
    peek: invoke("fs:peek"),
    read: invoke("fs:read"),
    write: invoke("fs:write"),
    create: invoke("fs:create"),
    rename: invoke("fs:rename"),
    copy: invoke("fs:copy"),
    move: invoke("fs:move"),
    trash: invoke("fs:trash"),
    open: invoke("fs:open"),
    openWith: invoke("fs:openWith"),
    reveal: invoke("fs:reveal"),
    properties: invoke("fs:properties"),
    icons: invoke("fs:icons"),
    search: invoke("fs:search"),
    quickIndex: invoke("fs:quickIndex"),
    startDrag: (paths) => ipcRenderer.send("fs:startDrag", paths),
    pathForFile: (file) => {
      try { return webUtils.getPathForFile(file) || ""; } catch (_) { return ""; }
    }
  },
  apps: {
    list: invoke("apps:list"),
    launch: invoke("apps:launch"),
    icons: invoke("apps:icons"),
    reveal: invoke("apps:reveal")
  },
  win: {
    list: invoke("win:list"),
    focus: invoke("win:focus"),
    minimize: invoke("win:minimize"),
    maximize: invoke("win:maximize"),
    close: invoke("win:close")
  },
  media: {
    key: invoke("media:key"),
    volume: invoke("media:volume"),
    setVolume: invoke("media:setVolume"),
    setMute: invoke("media:setMute")
  },
  player: {
    pickFiles: invoke("media:pickFiles"),
    pickFolder: invoke("media:pickFolder"),
    scan: invoke("media:scan"),
    tags: invoke("media:tags")
  },
  power: { action: invoke("power:action") },
  display: {
    brightness: invoke("display:brightness"),
    setBrightness: invoke("display:setBrightness")
  },
  shell: {
    openExternal: invoke("shell:openExternal"),
    openSettings: invoke("shell:openSettings"),
    taskManager: invoke("shell:taskManager"),
    snip: invoke("shell:snip")
  },
  net: {
    geo: invoke("net:geo"),
    pings: invoke("net:pings"),
    latency: invoke("net:latency"),
    weather: invoke("net:weather")
  },
  wifi: {
    status: invoke("wifi:status"),
    connect: invoke("wifi:connect"),
    disconnect: invoke("wifi:disconnect")
  },
  clip: {
    list: invoke("clip:list"),
    read: invoke("clip:read"),
    copy: invoke("clip:copy"),
    remove: invoke("clip:remove"),
    clear: invoke("clip:clear"),
    onChange: subscribe("clip:changed")
  },
  notes: {
    load: invoke("notes:load"),
    save: invoke("notes:save")
  },
  kb: {
    list: invoke("kb:list"),
    get: invoke("kb:get"),
    folder: invoke("kb:folder"),
    import: invoke("kb:import"),
    onChange: subscribe("kb:changed")
  },
  alarm: {
    set: invoke("alarm:set"),
    clear: invoke("alarm:clear"),
    onFired: subscribe("alarm:fired")
  }
});
