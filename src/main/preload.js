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
    idle: invoke("app:idle"),
    openData: invoke("app:openData"),
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
    thumbnails: invoke("fs:thumbnails"),
    indexSearch: invoke("fs:indexSearch"),
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
    close: invoke("win:close"),
    tile: invoke("win:tile"),
    layout: invoke("win:layout"),
    arrangements: invoke("win:arrangements"),
    saveArrangement: invoke("win:saveArrangement"),
    restoreArrangement: invoke("win:restoreArrangement"),
    deleteArrangement: invoke("win:deleteArrangement")
  },
  mixer: {
    list: invoke("mixer:list"),
    set: invoke("mixer:set"),
    devices: invoke("audio:devices"),
    setDefault: invoke("audio:setDefault")
  },
  nowPlaying: {
    get: invoke("nowplaying:get"),
    art: invoke("nowplaying:art"),
    control: invoke("nowplaying:control")
  },
  bluetooth: {
    status: invoke("bt:status"),
    radio: invoke("bt:radio")
  },
  disk: {
    scan: invoke("disk:scan"),
    progress: invoke("disk:progress"),
    node: invoke("disk:node"),
    cancel: invoke("disk:cancel"),
    clear: invoke("disk:clear")
  },
  tools: {
    runCommandWidget: invoke("cmdw:run"),
    gitStatus: invoke("git:status"),
    batteryHealth: invoke("battery:health"),
    loadTasks: invoke("tasks:load"),
    saveTasks: invoke("tasks:save"),
    exportSettings: invoke("settings:export"),
    importSettings: invoke("settings:import")
  },
  ai: {
    status: invoke("ai:status"),
    setKey: invoke("ai:setKey"),
    ask: invoke("ai:ask"),
    cancel: invoke("ai:cancel"),
    onChunk: subscribe("ai:chunk"),
    onDone: subscribe("ai:done")
  },
  updates: {
    info: invoke("updates:info"),
    check: invoke("updates:check"),
    download: invoke("updates:download"),
    install: invoke("updates:install"),
    skip: invoke("updates:skip"),
    openPage: invoke("updates:openPage"),
    onAvailable: subscribe("updates:available"),
    onProgress: subscribe("updates:progress")
  },
  saver: {
    start: invoke("saver:start"),
    dismiss: invoke("saver:dismiss")
  },
  browser: {
    create: invoke("browser:create"),
    go: invoke("browser:go"),
    action: invoke("browser:action"),
    layout: invoke("browser:layout"),
    focus: invoke("browser:focus"),
    snapshot: invoke("browser:snapshot"),
    find: invoke("browser:find"),
    close: invoke("browser:close"),
    clearData: invoke("browser:clearData"),
    onState: subscribe("browser:state"),
    onOpen: subscribe("browser:open"),
    onKey: subscribe("browser:key"),
    onDownload: subscribe("browser:download")
  },
  appTabs: {
    show: invoke("apptab:show"),
    hide: invoke("apptab:hide"),
    check: invoke("apptab:check"),
    snapshot: invoke("apptab:snapshot"),
    release: invoke("apptab:release")
  },
  spotify: {
    status: invoke("spotify:status"),
    connect: invoke("spotify:connect"),
    cancel: invoke("spotify:cancel"),
    disconnect: invoke("spotify:disconnect"),
    me: invoke("spotify:me"),
    player: invoke("spotify:player"),
    devices: invoke("spotify:devices"),
    control: invoke("spotify:control"),
    playlists: invoke("spotify:playlists"),
    playlistTracks: invoke("spotify:playlistTracks"),
    liked: invoke("spotify:liked"),
    recent: invoke("spotify:recent"),
    search: invoke("spotify:search"),
    art: invoke("spotify:art")
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
  screenTime: {
    get: invoke("screentime:get"),
    clear: invoke("screentime:clear")
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
