// Line icons (24x24, stroke = currentColor). Static, trusted markup.
const P = {
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  text: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2"/>',
  code: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M10 12l-2 2 2 2M14 12l2 2-2 2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>',
  audio: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  video: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 10l4-2.5v9L17 14"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16.5v-4h1.2a1.2 1.2 0 0 1 0 2.4H8.5M13 12.5v4h1a2 2 0 0 0 0-4z"/>',
  app: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 8h18M7 5.5h.01M10 5.5h.01"/>',
  shortcut: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 15l6-6M10 9h5v5"/>',
  drive: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h6M17 12h.01"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  forward: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  playpause: '<path d="M4 5l9 7-9 7zM16 6v12M20 6v12"/>',
  next: '<path d="M5 5l10 7-10 7zM19 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  shuffle: '<path d="M16 4h4v4M4 20L20 4M20 16v4h-4M15 15l5 5M4 4l5 5"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  prev: '<path d="M19 5L9 12l10 7zM5 5v14"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
  offline: '<path d="M3 3l18 18M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M2.5 9a14 14 0 0 1 4.6-2.9M10.7 5.1A14 14 0 0 1 21.5 9"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  memory: '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M7 7v10M11 7v10M15 7v10M3 20h18"/>',
  apps: '<circle cx="6" cy="6" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v8"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  cut: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M7.8 16.2L19 4M16.2 16.2L5 4"/>',
  paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2M9 11h6M9 15h4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 11h8M8 15h8"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="3" rx="1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>',
  signout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  minimize: '<path d="M5 18h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  process: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  command: '<path d="M7 7h10v10H7z"/><path d="M7 7a2.5 2.5 0 1 1 0-.01M17 7a2.5 2.5 0 1 1 0-.01M7 17a2.5 2.5 0 1 1 0-.01M17 17a2.5 2.5 0 1 1 0-.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5h2A4.5 4.5 0 0 0 21 11c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15.5" cy="7.5" r="1"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  snapshot: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  snip: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5M19 6l1.5-1.5"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.6a5 5 0 0 1-.5 9.9z"/>',
  rain: '<path d="M7 15a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 5.1 5 5 0 0 1 17.5 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M7 14a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 4.1 5 5 0 0 1 17.5 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 22h.01M14 22h.01"/>',
  storm: '<path d="M7 15a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 5.1 5 5 0 0 1 17.5 15z"/><path d="M13 13l-3 4h4l-3 4"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
  gauge: '<path d="M4.5 18a9 9 0 1 1 15 0"/><path d="M12 13l4-4M12 13h.01"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  eq: '<path d="M6 4v16M12 4v16M18 4v16"/><path d="M4 14h4M10 8h4M16 16h4"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  bluetooth: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17"/>',
  git: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 8.2v7.6M18 11.2c0 3-3 3.8-6 4.3-2.5.4-4 1-4.8 1.6"/>',
  disk: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12l6 6"/>',
  grid4: '<rect x="3.5" y="3.5" width="7" height="7"/><rect x="13.5" y="3.5" width="7" height="7"/><rect x="3.5" y="13.5" width="7" height="7"/><rect x="13.5" y="13.5" width="7" height="7"/>',
  mixer: '<path d="M5 20v-6M5 10V4M12 20v-9M12 7V4M19 20v-4M19 12V4"/><path d="M3 14h4M10 7h4M17 16h4"/>',  tomato: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 6V3M9 6.5c1-1.5 5-1.5 6 0M12 6l-2.5-2M12 6l2.5-2"/>'
};

// The eDEX-UI logo (ring, square and "e"), drawn in the theme colour.
export const LOGO_SVG = '<svg viewBox="0 0 459.04 459.04" aria-hidden="true"><g transform="translate(126.89 109.98)">' +
  '<circle cx="102.63" cy="119.53" r="222" fill="none" stroke="currentColor" stroke-width="14" opacity=".45"/>' +
  '<path fill="currentColor" d="m-30.735-13.833v266.73h266.74v-266.73zm15.997 15.997h234.74v234.74h-234.74z"/>' +
  '<g transform="matrix(3.7504 0 0 3.7504 -344.72 -397.96)" fill="currentColor"><path d="m108.83 159.42-7.4083-7.4083v-28.046l7.4083-7.4083h20.902l7.4083 7.4083v16.922h-26.576v7.6387l2.4995 2.5815h13.328l1.7691-2.1032v-4.7438h8.9792v8.6327l-6.4382 6.5264zm1.8168-26.434h17.432v-6.1964l-2.2474-2.4113h-12.931l-2.2536 2.9032z"/></g>' +
  "</g></svg>";

export function iconSvg(name, cls = "") {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.file}</svg>`;
}

export function icon(name, cls = "") {
  const span = document.createElement("span");
  span.className = "ico-wrap";
  span.innerHTML = iconSvg(name, cls);
  return span;
}

const KIND_BY_EXT = {
  image: ["png", "jpg", "jpeg", "jfif", "gif", "bmp", "webp", "svg", "ico", "avif", "tif", "tiff", "heic"],
  audio: ["mp3", "wav", "ogg", "oga", "flac", "aac", "m4a", "opus", "weba", "wma", "mid", "midi"],
  video: ["mp4", "webm", "mkv", "avi", "mov", "m4v", "ogv", "wmv", "3gp", "flv"],
  archive: ["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "tgz", "cab", "iso"],
  pdf: ["pdf"],
  code: ["js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "py", "rb", "go", "rs", "c", "h", "cpp", "hpp", "cs", "java", "kt", "php", "html", "htm", "css", "scss", "less", "xml", "yml", "yaml", "toml", "ini", "sh", "ps1", "psm1", "bat", "cmd", "sql", "lua", "vue", "svelte"],
  text: ["txt", "md", "markdown", "log", "csv", "tsv", "rtf", "nfo", "cfg", "conf", "env", "gitignore"],
  app: ["exe", "msi", "com", "scr", "appx", "msix"],
  shortcut: ["lnk", "url", "appref-ms"]
};
const EXT_KIND = new Map();
for (const [kind, exts] of Object.entries(KIND_BY_EXT)) for (const e of exts) EXT_KIND.set(e, kind);

export function fileKind(name, isDir) {
  if (isDir) return "folder";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 && !name.startsWith(".")) return "file";
  return EXT_KIND.get(name.slice(dot + 1).toLowerCase()) || "file";
}
