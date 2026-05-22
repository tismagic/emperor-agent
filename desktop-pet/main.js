const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const DEFAULT_BOUNDS = { width: 300, height: 340 };
const MIN_BOUNDS = { width: 300, height: 340 };

function parseArgs(argv) {
  const out = {
    root: process.env.EMPEROR_AGENT_ROOT || path.resolve(__dirname, ".."),
    webuiUrl: process.env.EMPEROR_WEBUI_URL || "http://127.0.0.1:8765",
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root" && argv[i + 1]) out.root = argv[i + 1];
    if (argv[i] === "--webui-url" && argv[i + 1]) out.webuiUrl = argv[i + 1];
  }
  return out;
}

const runtime = parseArgs(process.argv.slice(2));
const stateDir = path.join(runtime.root, "memory", "desktop_pet");
const boundsPath = path.join(stateDir, "window.json");
const assetBaseUrl = pathToFileURL(path.join(runtime.root, "assets", "desktop-pet", "clawd-tank") + path.sep).href;

function readBounds() {
  try {
    const raw = JSON.parse(fs.readFileSync(boundsPath, "utf8"));
    const width = Math.max(Number(raw.width) || DEFAULT_BOUNDS.width, MIN_BOUNDS.width);
    const height = Math.max(Number(raw.height) || DEFAULT_BOUNDS.height, MIN_BOUNDS.height);
    const bounds = { width, height };
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      bounds.x = Math.round(raw.x);
      bounds.y = Math.round(raw.y);
    }
    return bounds;
  } catch {
    return { ...DEFAULT_BOUNDS };
  }
}

function saveBounds(win) {
  if (!win || win.isDestroyed()) return;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const bounds = win.getBounds();
    fs.writeFileSync(boundsPath, `${JSON.stringify(bounds, null, 2)}\n`, "utf8");
  } catch {
    // Best-effort only; window persistence must not crash the companion.
  }
}

function createWindow() {
  const win = new BrowserWindow({
    ...readBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--emperor-root=${runtime.root}`,
        `--emperor-webui-url=${runtime.webuiUrl}`,
        `--emperor-asset-base-url=${assetBaseUrl}`,
      ],
    },
  });

  win.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin") {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  win.loadFile(path.join(__dirname, "renderer.html"));
  win.once("ready-to-show", () => win.showInactive());

  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveBounds(win);
    }, 180);
  };
  win.on("move", scheduleSave);
  win.on("close", () => saveBounds(win));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
