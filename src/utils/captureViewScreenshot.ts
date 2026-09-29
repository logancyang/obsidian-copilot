import { logWarn } from "@/logger";

interface ElectronRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElectronBrowserWindow {
  getBounds: () => ElectronRect;
  webContents: {
    capturePage: (rect?: ElectronRect) => Promise<{ toPNG: () => Uint8Array }>;
  };
}

interface ElectronRemote {
  getCurrentWindow?: () => ElectronBrowserWindow;
  BrowserWindow?: { getAllWindows?: () => ElectronBrowserWindow[] };
}

export async function captureViewScreenshot(el: HTMLElement): Promise<Uint8Array | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- screenshot capture is an optional Electron capability and returns null when unavailable
    const electron = require("electron") as { remote?: ElectronRemote } | undefined;
    const remote = electron?.remote;
    if (!remote) return null;

    const targetWindow = el.ownerDocument.defaultView;
    if (!targetWindow) return null;

    const browserWindow = resolveBrowserWindow(remote, targetWindow);
    if (!browserWindow) return null;

    const bounds = el.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;

    const rect: ElectronRect = {
      x: Math.max(0, Math.floor(bounds.left)),
      y: Math.max(0, Math.floor(bounds.top)),
      width: Math.ceil(bounds.width),
      height: Math.ceil(bounds.height),
    };

    const image = await browserWindow.webContents.capturePage(rect);
    const png = image.toPNG();
    return png.length > 0 ? png : null;
  } catch (err) {
    logWarn("captureViewScreenshot failed:", err);
    return null;
  }
}

function resolveBrowserWindow(
  remote: ElectronRemote,
  domWindow: Window
): ElectronBrowserWindow | null {
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
      // A window may have been destroyed mid-iteration; skip it.
    }
  }
  return best ?? current;
}
