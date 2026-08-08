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

/**
 * Capture a screenshot of a DOM element's on-screen region as PNG bytes via
 * Electron's `webContents.capturePage`. Desktop-only; returns `null` on mobile,
 * when Electron is unavailable, or on any capture failure so callers can
 * degrade gracefully (the report flow proceeds without a screenshot).
 *
 * Popout-aware: the element may live in a detached Obsidian window, which is a
 * separate Electron `BrowserWindow`. Since plugin code runs in the main
 * renderer, `getCurrentWindow()` only ever returns the main window, so for a
 * popout we match the owning DOM window against all Electron windows by screen
 * bounds and capture that one.
 */
export async function captureViewScreenshot(el: HTMLElement): Promise<Uint8Array | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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

/**
 * Resolve the Electron `BrowserWindow` hosting `domWindow`. For the main
 * renderer this is `getCurrentWindow()`; for a popout we pick the Electron
 * window whose screen bounds best match the popout's `screenX/screenY/outer*`.
 */
function resolveBrowserWindow(
  remote: ElectronRemote,
  domWindow: Window
): ElectronBrowserWindow | null {
  const current = remote.getCurrentWindow?.() ?? null;

  // The main renderer's window — capture it directly.
  if (domWindow === window) return current;

  const all = remote.BrowserWindow?.getAllWindows?.() ?? [];
  if (all.length === 0) return current;
  if (all.length === 1) return all[0];

  // Match by screen position. Obsidian popouts are top-level OS windows, so the
  // DOM window's screen coordinates line up with the Electron window bounds.
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
