// main.js
const { app, BrowserWindow, session } = require("electron");
const path = require("path");

function attachZoomShortcuts(win) {
  let zoom = 1;
  const STEP = 0.1,
    MIN = 0.25,
    MAX = 3;

  const apply = (nf) => {
    zoom = Math.min(MAX, Math.max(MIN, nf));
    win.webContents.setZoomFactor(zoom);
  };

  win.webContents.on("before-input-event", (event, input) => {
    // Ctrl + lăn chuột
    if (input.type === "mouseWheel" && input.control) {
      apply(zoom + (input.deltaY < 0 ? STEP : -STEP));
      event.preventDefault();
      return;
    }
    // Ctrl + '+', '='
    if (
      input.type === "keyDown" &&
      input.control &&
      (input.key === "+" || input.key === "=")
    ) {
      apply(zoom + STEP);
      event.preventDefault();
      return;
    }
    // Ctrl + '-'
    if (input.type === "keyDown" && input.control && input.key === "-") {
      apply(zoom - STEP);
      event.preventDefault();
      return;
    }
    // Ctrl + '0' → reset
    if (input.type === "keyDown" && input.control && input.key === "0") {
      apply(1);
      event.preventDefault();
      return;
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  });

  // Load LogTag Online
  win.loadURL("https://logtagonline.com/locations");
  attachZoomShortcuts(win);

  // ✅ Cho phép mở mini logs (window.open) — KHÔNG còn trắng
  win.webContents.setWindowOpenHandler((details) => {
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 700,
        height: 500,
        minWidth: 360,
        minHeight: 260,
        title: "LogTag — Mini Logs",
        autoHideMenuBar: true,
        resizable: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          devTools: true,
        },
      },
    };
  });

  // Debug khi cần
  // win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(() => {
  // Chỉ gỡ CSP cho logtagonline.com
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const host = new URL(details.url).host || "";
    const headers = details.responseHeaders || {};
    if (/(^|\.)logtagonline\.com$/i.test(host)) {
      delete headers["Content-Security-Policy"];
      delete headers["content-security-policy"];
    }
    callback({ responseHeaders: headers });
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
