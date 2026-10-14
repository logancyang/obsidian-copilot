interface ElectronRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElectronBrowserWindow {
  getBounds: () => ElectronRect;
  webContents: {
    capturePage: () => Promise<{ toPNG: () => Uint8Array }>;
  };
}

interface ElectronRemote {
  getCurrentWindow?: () => ElectronBrowserWindow;
  BrowserWindow?: { getAllWindows?: () => ElectronBrowserWindow[] };
}

export async function captureWindowBehindDialogs(win: Window): Promise<Uint8Array | null> {
  const browserWindow = resolveBrowserWindow(win);
  if (!browserWindow) return null;

  const dialogs = Array.from(win.document.querySelectorAll<HTMLElement>(".modal-container")).filter(
    (dialog) => dialog.isShown()
  );
  dialogs.forEach((dialog) => dialog.hide());
  try {
    await untilPainted(win);
    const png = (await browserWindow.webContents.capturePage()).toPNG();
    return png.length > 0 ? png : null;
  } finally {
    dialogs.forEach((dialog) => dialog.show());
  }
}

function untilPainted(win: Window): Promise<void> {
  return new Promise((resolve) =>
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()))
  );
}

function resolveBrowserWindow(domWindow: Window): ElectronBrowserWindow | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- screenshot capture is an optional Electron capability and returns null when unavailable
  const electron = require("electron") as { remote?: ElectronRemote } | undefined;
  const remote = electron?.remote;
  if (!remote) return null;

  const current = remote.getCurrentWindow?.() ?? null;
  if (domWindow === window) return current;

  const all = remote.BrowserWindow?.getAllWindows?.() ?? [];
  if (all.length === 0) return current;
  if (all.length === 1) return all[0];

  let best: ElectronBrowserWindow | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const w of all) {
    try {
      const b = w.getBounds();
      const delta =
        Math.abs(b.x - domWindow.screenX) +
        Math.abs(b.y - domWindow.screenY) +
        Math.abs(b.width - domWindow.outerWidth) +
        Math.abs(b.height - domWindow.outerHeight);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = w;
      }
    } catch {
      continue;
    }
  }
  return best ?? current;
}
