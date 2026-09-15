/**
 * Screenshots the Agent Mode pane from behind the "Report an issue" dialog.
 * Kept apart from the modal because which window gets dismissed, and when the
 * pane is still enough to photograph, are decided from DOM geometry alone and
 * are tested without a modal.
 */

import { logInfo, logWarn } from "@/logger";
import { captureViewScreenshot } from "@/utils/captureViewScreenshot";

/** How long `waitForStableTarget` keeps waiting before giving up on the pane. */
const CAPTURE_SETTLE_TIMEOUT_MS = 1200;

/** Gap between geometry samples — two quiet samples are what ends the wait. */
const CAPTURE_SETTLE_POLL_MS = 50;

/**
 * Wait until `el` holds a non-empty box that has stopped moving, or the timeout
 * runs out. Revealing the Agent Mode pane and dismissing the Settings window are
 * both animated, so the moment right after the call still shows the old picture
 * and the pane can still measure zero.
 *
 * Samples the whole rect, not just its size: `captureViewScreenshot` crops on
 * `left`/`top` too, so a pane that has finished growing while still sliding in
 * would otherwise be captured at the wrong offset.
 *
 * Scheduled on the element's own window, and on timers rather than
 * `requestAnimationFrame`. The pane can be revealed in a popout while the report
 * dialog sits in the main renderer, and a hidden window stops firing frame
 * callbacks — a frame-driven loop, or one clocked off the wrong window, would
 * never reach its own deadline and would hang the report with the dialog still
 * hidden.
 *
 * @param el Element the screenshot will be cropped to; also names the window
 *   whose clock drives the polling.
 * @returns Whether the element settled into something worth capturing.
 */
export async function waitForStableTarget(el: HTMLElement): Promise<boolean> {
  const deadline = Date.now() + CAPTURE_SETTLE_TIMEOUT_MS;
  let previous: DOMRect | null = null;
  while (Date.now() < deadline) {
    // The poll is clocked by the target's own window, so destroying that window
    // cancels the pending timer and leaves this promise unsettled — the report
    // would then wait with the dialog still hidden and nothing to end it.
    // Reaching that takes the first agent pane living in a popout while the
    // dialog sits in the main window Settings opened it from, and that popout
    // being closed inside this 1.2s budget. It is left unguarded because racing
    // a `pagehide` listener here would be this codebase's only popout-teardown
    // protocol, and cross-realm teardown is worth doing in one sweep rather
    // than in one helper. Clocking the poll off the main window instead would
    // be worse: merely backgrounding Obsidian would stall every capture.
    await new Promise((resolve) => el.win.setTimeout(resolve, CAPTURE_SETTLE_POLL_MS));
    // Re-checked after the wait, not only before it: a throttled window can hold
    // a timer well past the deadline, and the budget has to mean something to
    // whoever reads it.
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

/**
 * Screenshot the Agent Mode pane, first clearing anything that would otherwise
 * be in the frame.
 *
 * Only what shares the pane's window can be in the shot, and that is the whole
 * decision here. Obsidian 1.13 moved Settings into a window of its own, and the
 * report dialog opens from Settings — so dismissing Settings on 1.13 destroys
 * the window hosting the dialog, ending the report mid-capture with nothing
 * shown and nothing cleaned up, to remove something that was never in frame.
 *
 * Exported for its own tests: which overlay gets dismissed is decided from the
 * windows involved, and that is only observable from outside.
 *
 * @param overlay The report dialog. Doubles as Settings' stand-in, since the
 *   dialog opens from it and therefore shares its window.
 * @param resolveTarget Reveals the pane and returns the element to crop to, or
 *   null when there is no pane to photograph.
 * @param dismissSettings Closes the Settings surface. Spent only when Settings
 *   is in frame, which is the only time it was ever worth anything.
 */
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
    // Dismissing Settings and revealing the pane are animated, so the pane needs
    // time to finish arriving and to stop moving before its rect describes what
    // is actually on screen. The same wait covers the dialog leaving the
    // picture: `hide()` only changes the DOM, and settling spans at least two
    // polls before any pixel is read.
    if (!(await waitForStableTarget(target))) {
      logWarn("[ReportIssue] the Agent Mode pane never settled; skipping the screenshot");
      return null;
    }
    return await captureViewScreenshot(target);
  } finally {
    if (inFrame) overlay.show();
  }
}
