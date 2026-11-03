import { logError } from "@/logger";

export interface ElectronShell {
  openExternal?: (url: string) => Promise<void>;
  showItemInFolder?: (path: string) => void;
}

export function getElectronShell(): ElectronShell | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell is optional and loaded lazily so callers can degrade gracefully
    const electron = require("electron") as
      | { shell?: ElectronShell; remote?: { shell?: ElectronShell } }
      | undefined;
    return electron?.shell ?? electron?.remote?.shell ?? null;
  } catch {
    return null;
  }
}

interface LinkClick {
  preventDefault(): void;
  currentTarget: { href: string };
}

// Obsidian's Web Viewer can open external links inside Obsidian, where Google sign-in fails, so sign-in links go to the system browser. https://github.com/logancyang/obsidian-copilot/issues/3985
export function openLinkInSystemBrowser(event: LinkClick): void {
  const shell = getElectronShell();
  if (!shell?.openExternal) return;
  event.preventDefault();
  shell
    .openExternal(event.currentTarget.href)
    .catch((err) => logError("[Links] could not open the system browser:", err));
}
