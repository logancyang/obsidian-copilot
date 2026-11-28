interface ElectronWindow extends Window {
  electron?: {
    remote?: {
      getCurrentWindow?: () => {
        webContents: { capturePage: () => Promise<{ toPNG: () => Uint8Array }> };
      };
    };
  };
}

export async function captureWindowBehindDialogs(win: Window): Promise<Uint8Array | null> {
  const browserWindow = (win as ElectronWindow).electron?.remote?.getCurrentWindow?.();
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
