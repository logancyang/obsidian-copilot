import { logInfo, logWarn } from "@/logger";
import { captureViewScreenshot } from "@/utils/captureViewScreenshot";

const CAPTURE_SETTLE_TIMEOUT_MS = 1200;

const CAPTURE_SETTLE_POLL_MS = 50;

export async function waitForStableTarget(el: HTMLElement): Promise<boolean> {
  const deadline = Date.now() + CAPTURE_SETTLE_TIMEOUT_MS;
  let previous: DOMRect | null = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => el.win.setTimeout(resolve, CAPTURE_SETTLE_POLL_MS));
    if (Date.now() >= deadline) return false;
    if (!el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    const settled =
      rect.width > 0 &&
      rect.height > 0 &&
      previous !== null &&
      rect.left === previous.left &&
      rect.top === previous.top &&
      rect.width === previous.width &&
      rect.height === previous.height;
    if (settled) return true;
    previous = rect;
  }
  return false;
}

export async function captureBehindOverlay(
  overlay: HTMLElement,
  resolveTarget: () => Promise<HTMLElement | null> | HTMLElement | null,
  dismissSettings: () => void
): Promise<Uint8Array | null> {
  const target = await resolveTarget();
  if (!target) return null;

  const inFrame = overlay.win === target.win;
  if (inFrame) {
    dismissSettings();
    overlay.hide();
  } else {
    logInfo("[ReportIssue] the pane is in another window; capturing without dismissing Settings");
  }
  try {
    if (!(await waitForStableTarget(target))) {
      logWarn("[ReportIssue] the Agent Mode pane never settled; skipping the screenshot");
      return null;
    }
    return await captureViewScreenshot(target);
  } finally {
    if (inFrame) overlay.show();
  }
}
