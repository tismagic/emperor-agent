const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

function argValue(prefix) {
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

const root = argValue("--emperor-root=") || process.env.EMPEROR_AGENT_ROOT || "";
const assetBaseUrl = argValue("--emperor-asset-base-url=");
const cursors = new Map();

// IPC event queue for live events from the main process.
const CORE_EVENT_CHANNEL = "emperor:core:event";
const ipcEventQueue = [];
const IPC_QUEUE_MAX = 500;

ipcRenderer.on(CORE_EVENT_CHANNEL, (_event, payload) => {
  if (ipcEventQueue.length < IPC_QUEUE_MAX) {
    ipcEventQueue.push(payload);
  }
});

function safeJson(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function runtimeFiles() {
  const files = [];
  const sessionsDir = path.join(root, "memory", "sessions");
  try {
    for (const name of fs.readdirSync(sessionsDir)) {
      if (name.startsWith(".")) continue;
      const file = path.join(sessionsDir, name, "runtime", "events.jsonl");
      if (fs.existsSync(file)) files.push(file);
    }
  } catch {
    // No sessions yet.
  }
  const legacy = path.join(root, "memory", "runtime", "events.jsonl");
  if (fs.existsSync(legacy)) files.push(legacy);
  return files.sort();
}

function readEvents(file) {
  try {
    return fs.readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => safeJson(line))
      .filter((event) => event && typeof event === "object" && typeof event.event === "string");
  } catch {
    return [];
  }
}

function eventTime(event) {
  const ts = event && event.ts;
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed / 1000 : 0;
  }
  return 0;
}

function readRecentEvents(limit = 100) {
  const events = [];
  for (const file of runtimeFiles()) {
    for (const event of readEvents(file)) events.push(event);
  }
  return events
    .sort((a, b) => eventTime(a) - eventTime(b) || Number(a.seq || 0) - Number(b.seq || 0))
    .slice(-Math.max(Number(limit) || 100, 1));
}

function readNewEvents() {
  const out = [];
  for (const file of runtimeFiles()) {
    const events = readEvents(file);
    const cursor = Math.max(Number(cursors.get(file) || 0), 0);
    const next = events.slice(cursor);
    cursors.set(file, events.length);
    out.push(...next);
  }
  return out.sort((a, b) => eventTime(a) - eventTime(b) || Number(a.seq || 0) - Number(b.seq || 0));
}

function readControl() {
  const state = safeJson(fs.existsSync(path.join(root, "memory", "control", "state.json"))
    ? fs.readFileSync(path.join(root, "memory", "control", "state.json"), "utf8")
    : "{}", {});
  return state && typeof state === "object" ? state : {};
}

contextBridge.exposeInMainWorld("emperorPet", {
  root,
  assetBaseUrl,
  readBootstrap: async () => {
    const events = readRecentEvents(100);
    for (const file of runtimeFiles()) cursors.set(file, readEvents(file).length);
    return {
      runtime: {
        latestSeq: Math.max(0, ...events.map((event) => Number(event.seq || 0) || 0)),
        events,
      },
      control: readControl(),
    };
  },
  readRuntimeEvents: async () => readNewEvents(),
  readIpcEvents: async () => {
    if (!ipcEventQueue.length) return [];
    const batch = ipcEventQueue.splice(0);
    return batch;
  },
  closePet: async () => {
    try { ipcRenderer.invoke("emperor:pet:close"); } catch { /* best-effort */ }
  },
});
