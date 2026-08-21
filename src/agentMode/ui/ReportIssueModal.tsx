import { frameSink } from "@/agentMode/session/debugSink";
import { logError, logInfo, logWarn } from "@/logger";
import { flushRecordedPromptPayloadToLog } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { logFileManager } from "@/logFileManager";
import { captureViewScreenshot } from "@/utils/captureViewScreenshot";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";
import { formatBytes } from "@/utils/formatBytes";
import {
  assembleReportBundle,
  buildLinkedReportIssueUrl,
  zipReportBundle,
  type ReportEnvInfo,
  type ReportLogRequest,
} from "@/utils/issueReport";
import {
  ReportUploadError,
  type ReportUploader,
  type ReportUploadResult,
} from "@/utils/reportUpload";
import { findLatestOpencodeLog } from "@/utils/opencodeLog";
import { basename } from "@/utils/pathUtils";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { getSettings } from "@/settings/model";
import { App, Modal, Notice, apiVersion } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";
import {
  ReportIssueFlow,
  type PreparedReport,
  type PrepareStep,
  type ReportSourceId,
  type ReportSourceOption,
  type UploadOutcome,
} from "./ReportIssueFlow";

const OPENCODE_BACKEND_ID = "opencode";

// GitHub's issue attachment allowlist rejects `.ndjson`, so the bundled frame
// log gets a trailing `.txt` (an allowed type) while keeping `.ndjson` in the
// name as a format hint. Content is unchanged: one JSON object per line.
const FRAME_LOG_NAME = "acp-frames.ndjson.txt";
const CHAT_LOG_NAME = "copilot-chat-log.md";
const OPENCODE_LOG_NAME = "opencode.log";

export interface ReportIssueModalParams {
  app: App;
  /**
   * Reveals the Agent Mode pane and returns the element to screenshot, called
   * just before capture. Returns `null` to skip the screenshot (e.g. no agent
   * pane open). Must not dismiss the Settings surface — only this modal knows
   * whether Settings is even in the shot, so that call is `dismissSettings`.
   */
  resolveCaptureTarget: () => Promise<HTMLElement | null> | HTMLElement | null;
  /**
   * Closes the Settings surface this modal was opened from. Called only when it
   * shares a window with the capture target, so it is the one thing standing
   * between the camera and the pane.
   */
  dismissSettings: () => void;
  /**
   * Whether `resolveCaptureTarget` would find anything, asked while the form is
   * still up so an impossible screenshot is never offered as a choice. Must have
   * no side effects — unlike `resolveCaptureTarget`, this one runs before the
   * user has committed to anything, so it may not close or reveal a thing.
   */
  canCaptureTarget: () => boolean;
  /** Active backend id — gates the opencode-log option. */
  activeBackend: string;
  /** Plugin version for the report's environment block. */
  pluginVersion: string;
  /** Uploads the packed attempt and returns the report id to embed in the issue. */
  uploader: ReportUploader;
}

interface ElectronShell {
  openExternal?: (url: string) => Promise<void>;
  showItemInFolder?: (path: string) => void;
}
function getElectronShell(): ElectronShell | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell is optional and loaded lazily so reporting can degrade gracefully
    const electron = require("electron") as
      | { shell?: ElectronShell; remote?: { shell?: ElectronShell } }
      | undefined;
    return electron?.shell ?? electron?.remote?.shell ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a private directory for one report and return it.
 *
 * Made fresh per report rather than reused at a fixed path: on a machine whose
 * temp dir is shared between accounts, a predictable path can be created first
 * by someone else, and a name planted inside it ahead of time is followed by the
 * write that lands there — enough to overwrite a file the user owns. `mkdtemp`
 * settles all three preconditions at once, since it creates atomically, names
 * unpredictably, and is owner-only from the start.
 *
 * @returns The new directory, or null when the OS temp folder is unusable.
 */
export async function createReportsRootDir(): Promise<string | null> {
  try {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    const os = requireNodeModule<typeof import("node:os")>("os");
    const path = requireNodeModule<typeof import("node:path")>("path");
    return await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-copilot-report-"));
  } catch {
    return null;
  }
}

/** Size of a file on disk, or null when it does not exist or cannot be read. */
async function fileBytes(filePath: string): Promise<number | null> {
  try {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    return (await fs.stat(filePath)).size;
  } catch {
    return null;
  }
}

/**
 * Best-effort delete of paths a report no longer needs. Failures are logged, not
 * raised: the caller is already handling something that went wrong, or has
 * nothing left to tell the user with.
 *
 * Every path is attempted on its own, because they are separate leaks rather
 * than one: a staging folder that refuses to go (open handle, antivirus scan)
 * must not be the reason the zip beside it stays on disk. Exported for its own
 * tests, which are the only way to observe that isolation.
 *
 * @param paths Paths to delete, most exposed first — a partial cleanup should
 *   get rid of the worst leak, not whichever one happened to be listed first.
 */
export async function removeReportPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
      await fs.rm(path, { recursive: true, force: true });
    } catch (err) {
      logError(`[ReportIssue] could not remove the abandoned report path ${path}:`, err);
    }
  }
}

/**
 * Unique, sortable bundle id. The millisecond suffix matters: double-clicking
 * "Prepare report", or retrying after a failure, must land in a fresh folder
 * rather than mixing new files with the previous attempt's.
 */
function formatBundleId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${date.getTime().toString(36).slice(-4)}`;
}

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
    // DESIGN NOTE: this poll is clocked by the target's own window. Destroying
    // that window cancels its pending timers, so a popout closed between two
    // samples leaves this promise unsettled and the report waiting.
    //
    // Assessed as a contrived path, not a mainline one: the report dialog always
    // opens from Settings in the main window, so reaching it means clicking
    // "Prepare report" there, having the first agent pane in a popout, and then
    // closing that popout inside this 1.2s window.
    //
    // Not fixed. Racing a `pagehide`/`unload` listener here would be this repo's
    // first popout-teardown protocol, and cross-realm hardening belongs in one
    // codebase-wide sweep rather than in a single helper — the same call this
    // file's neighbour already made for `ResizeObserver` (AgentTabStrip.tsx).
    // What shipped before was strictly worse: it awaited the *main* window's
    // frame clock with no deadline at all, so merely backgrounding Obsidian hung
    // it forever, where this bounds every wait against a live window at 1.2s.
    //
    // If a future review flags this again, point them at this note.
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

/**
 * Upload the report's packed attempt and build the issue URL its id belongs
 * in. A plain function, not a method: it closes over nothing but its
 * arguments, so it can be driven directly in a test the same way
 * `captureBehindOverlay` is, rather than through a full `ReportIssueModal`
 * instance.
 *
 * Failures are caught here, not left to reject: the flow renders whichever
 * `UploadOutcome` comes back rather than needing its own try/catch around a
 * call into host code. An error that does not classify itself is treated as
 * retryable — an unknown failure is an *uncertain* outcome, and re-sending the
 * same attempt is safe because its idempotency key makes a duplicate store
 * impossible.
 */
export async function uploadReport(
  uploader: ReportUploader,
  report: PreparedReport
): Promise<UploadOutcome> {
  let result: ReportUploadResult;
  try {
    result = await uploader(report.uploadAttempt);
  } catch (err) {
    logError("[ReportIssue] could not upload the report:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      retryable: err instanceof ReportUploadError ? err.retryable : true,
    };
  }
  // Unguarded on purpose: with a fixed-width report id in the prefix,
  // `buildLinkedReportIssueUrl` cannot exceed the URL ceiling it throws over,
  // so a catch here would be a branch nothing can reach.
  return {
    ok: true,
    result,
    issueUrl: buildLinkedReportIssueUrl(report.issueDraft, result.reportId),
  };
}

/**
 * Hand the prefilled issue URL to the OS browser. Failures are surfaced rather
 * than swallowed: the flow's instructions are written for a user who is looking
 * at the GitHub page, so someone whose browser never opened needs to know it
 * was Copilot that fell short.
 *
 * Every failure shape is contained, and none may escape. The bridge can be
 * absent, reject its promise, or throw before returning one — and by the time
 * this runs the report is already uploaded, so an error thrown back at the
 * caller would abandon a page transition it cannot redo.
 *
 * A plain function, not a method, so a test can drive both failure shapes
 * without an Electron bridge — the same reason `uploadReport` is one.
 *
 * @param shell The Electron shell bridge, or null where there is none. Taken
 *   whole rather than as its URL opener so the call keeps its receiver, the
 *   same way `revealFile` calls `showItemInFolder`.
 * @param reportId Present on the uploaded path. Repeated in the failure Notice
 *   because it is the one thing the user cannot reconstruct by hand: the note
 *   and logs are on their machine, but the id exists only in a response this
 *   Notice may be the last surviving carrier of.
 */
export function openIssuePageWith(
  shell: Pick<ElectronShell, "openExternal"> | null,
  url: string,
  reportId?: string
): void {
  const fallback =
    "Open the GitHub issue page yourself" +
    (reportId ? ` and include the report ID ${reportId}.` : ".");
  if (!shell?.openExternal) {
    new Notice(`Copilot could not open your browser. ${fallback}`);
    return;
  }
  const failed = (err: unknown) => {
    logError("[ReportIssue] could not open the issue page:", err);
    new Notice(`Copilot could not open the issue page. ${fallback}`);
  };
  try {
    void shell.openExternal(url).catch(failed);
  } catch (err) {
    failed(err);
  }
}

/**
 * Guided "Report an issue" flow. Owns everything the wizard UI must not know
 * about: capturing the pane behind itself, resolving each log source, zipping
 * the bundle, uploading it, and reaching the OS browser and file manager. The
 * wizard itself lives in `ReportIssueFlow`.
 *
 * This modal stays open for the whole flow, so it hides itself around the
 * screenshot rather than closing.
 */
export class ReportIssueModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly params: ReportIssueModalParams) {
    super(params.app);
    // @ts-ignore — setTitle exists at runtime (see ConfirmModal).
    this.setTitle("Report an Agent Mode issue");
  }

  onOpen() {
    if (!isDesktopRuntime()) {
      new Notice("Reporting an issue is available on desktop only.");
      this.close();
      return;
    }
    this.root = createPluginRoot(this.contentEl, this.app);
    this.render(this.buildSourceOptions());
    void this.loadActivityLogSize();
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }

  private render(sources: ReportSourceOption[]): void {
    this.root?.render(
      <ReportIssueFlow
        sources={sources}
        prepare={(note, selected, onStep) => this.prepare(note, selected, onStep)}
        rebuildZip={(report) => this.rebuildZip(report)}
        // Zip before folder: the zip is a single-file copy of everything the
        // folder holds, so it is the bigger leak if only one of the two goes.
        // The wrapper holds the zip and the staging folder and nothing else, so
        // removing it takes both — and leaves no empty directory behind.
        discardReport={(report) => void removeReportPaths([report.rootDir])}
        onCancel={() => this.close()}
        revealFile={(path) => this.revealFile(path)}
        openIssuePage={(url, reportId) => this.openIssuePage(url, reportId)}
        upload={(report) => uploadReport(this.params.uploader, report)}
      />
    );
  }

  /**
   * The activity log's size needs a `stat`, which `onOpen` cannot await. Render
   * the options without it first, then re-render with the hint filled in; React
   * keeps the note and checkbox state across the second render.
   */
  private async loadActivityLogSize(): Promise<void> {
    const bytes = await fileBytes(frameSink.getPath());
    if (!this.root) return;
    this.render(this.buildSourceOptions(bytes));
  }

  /**
   * Whether a screenshot is possible at all. A host that throws while probing
   * must not take the form down with it — the report is still worth filing
   * without a screenshot, so a failed probe reads as "not available".
   */
  private canCapture(): boolean {
    try {
      return this.params.canCaptureTarget();
    } catch (err) {
      logError("[ReportIssue] could not tell whether a screenshot is possible:", err);
      return false;
    }
  }

  private buildSourceOptions(activityLogBytes?: number | null): ReportSourceOption[] {
    const settings = getSettings();
    return buildReportSourceOptions({
      // A screenshot needs a pane to point the camera at. Asked here rather than
      // at capture time so a user without one is told while they can still act
      // on it, instead of waiting out a bundle for an empty screenshot.png.
      canCapture: this.canCapture(),
      activityLogOn: settings.agentMode.debugFullFrames,
      activityLogBytes,
      debugMode: settings.debug,
      activeBackend: this.params.activeBackend,
    });
  }

  /**
   * Show the finished zip in the OS file manager. A missing capability has to be
   * said out loud: this is what the review step falls back to when the upload
   * cannot be used, and a silent no-op would leave the user with a report they
   * cannot find.
   */
  private revealFile(path: string): void {
    const shell = getElectronShell();
    if (!shell?.showItemInFolder) {
      new Notice(`Copilot could not open the folder. The report is at ${path}`);
      return;
    }
    try {
      shell.showItemInFolder(path);
    } catch (err) {
      logError("[ReportIssue] could not reveal the report:", err);
      new Notice(`Copilot could not open the folder. The report is at ${path}`);
    }
  }

  private openIssuePage(url: string, reportId?: string): void {
    openIssuePageWith(getElectronShell(), url, reportId);
  }

  private async prepare(
    note: string,
    selected: ReadonlySet<ReportSourceId>,
    onStep: (step: PrepareStep) => void
  ): Promise<PreparedReport> {
    const rootDir = await createReportsRootDir();
    if (!rootDir)
      throw new Error("The OS temp folder is unavailable, so nothing could be written.");

    // One wrapper directory per report, so anything that fails on the way to the
    // review step takes the whole thing with it: what it holds is plaintext
    // prompts and note contents nobody asked to keep. A bundle that reaches the
    // user outlives this modal on purpose and is theirs to discard.
    //
    // The guard starts here rather than at the first write, so the directory is
    // owned by the cleanup from the moment it exists: capturing the screenshot
    // and collecting the logs can both throw, and a boundary drawn at the write
    // would leave one behind per failed attempt.
    let report: Awaited<ReturnType<typeof assembleReportBundle>>;
    let packed: Awaited<ReturnType<typeof zipReportBundle>>;
    try {
      const screenshotRequested = selected.has("screenshot");
      const screenshotPng = screenshotRequested
        ? await captureBehindOverlay(
            this.containerEl,
            () => this.params.resolveCaptureTarget(),
            () => this.params.dismissSettings()
          )
        : null;
      onStep("screenshot");

      const logs: ReportLogRequest[] = [];
      if (selected.has("activityLog")) logs.push(await activityLogRequest());
      if (selected.has("chatLog")) logs.push(await chatLogRequest());
      if (selected.has("opencodeLog")) logs.push(await opencodeLogRequest());

      const env: ReportEnvInfo = {
        pluginVersion: this.params.pluginVersion,
        platform: process.platform,
        obsidianVersion: apiVersion,
        activeBackend: this.params.activeBackend,
      };

      report = await assembleReportBundle({
        note,
        env,
        screenshotRequested,
        screenshotPng,
        logs,
        reportsRootDir: rootDir,
        bundleId: formatBundleId(new Date()),
      });
      onStep("logs");
      packed = await zipReportBundle(report);
    } catch (err) {
      await removeReportPaths([rootDir]);
      throw err;
    }
    onStep("zip");

    logInfo(
      `[ReportIssue] bundle ready at ${packed.zipPath} ` +
        `(${formatBytes(packed.uploadAttempt.body.byteLength)})`
    );
    return {
      folderPath: report.folderPath,
      rootDir,
      zipPath: packed.zipPath,
      zipName: basename(packed.zipPath),
      uploadAttempt: packed.uploadAttempt,
      issueDraft: packed.issueDraft,
      manualIssueUrl: packed.manualIssueUrl,
      attachments: packed.attachments,
    };
  }

  /**
   * Repack the staging folder so edits the user made there reach the zip. The
   * stale zip goes first and on purpose: if the repack fails, the file still
   * holding whatever they just removed must not be sitting there uploadable.
   */
  private async rebuildZip(report: PreparedReport): Promise<PreparedReport> {
    await removeReportPaths([report.zipPath]);
    const packed = await zipReportBundle({
      folderPath: report.folderPath,
      attachments: report.attachments,
    });
    return {
      ...report,
      zipPath: packed.zipPath,
      zipName: basename(packed.zipPath),
      // A whole new attempt, not a patched one: the repack minted fresh bytes
      // *and* a fresh idempotency key together, so the server cannot answer
      // this upload with the pre-edit bundle stored under the old key.
      uploadAttempt: packed.uploadAttempt,
      attachments: packed.attachments,
      // Both are read back from the `report.md` that was just packed, so an
      // edit the user made to take something out reaches the issue too.
      issueDraft: packed.issueDraft,
      manualIssueUrl: packed.manualIssueUrl,
    };
  }
}

/** Everything the attachment checklist depends on, gathered by the modal. */
export interface ReportSourceInputs {
  /** Whether a pane exists to photograph; false greys the screenshot row out. */
  canCapture: boolean;
  activityLogOn: boolean;
  /** `undefined` while the `stat` is still in flight, `null` when there is no file. */
  activityLogBytes?: number | null;
  debugMode: boolean;
  activeBackend: string;
}

/**
 * The attachment checklist offered on the report form. A source the user cannot
 * actually contribute is listed disabled with a reason rather than hidden: it
 * tells someone missing a log why it is missing and what to turn on, which a
 * silently shorter list cannot do.
 */
export function buildReportSourceOptions({
  canCapture,
  activityLogOn,
  activityLogBytes,
  debugMode,
  activeBackend,
}: ReportSourceInputs): ReportSourceOption[] {
  const options: ReportSourceOption[] = [
    {
      id: "screenshot",
      label: "Screenshot of the Agent Mode pane",
      disabled: !canCapture,
      defaultChecked: canCapture,
      hint: canCapture ? undefined : "open the Agent Mode pane first",
    },
    {
      id: "activityLog",
      label: "Agent Mode activity log",
      // Honoring the opt-out means never reaching for the stale plaintext log
      // left behind after the toggle went off.
      disabled: !activityLogOn,
      defaultChecked: activityLogOn,
      hint: !activityLogOn
        ? "turn it on in Settings → Advanced"
        : describeActivityLogSize(activityLogBytes),
    },
    {
      id: "chatLog",
      label: "Regular chat log",
      hint: "copilot log file",
      defaultChecked: debugMode,
    },
  ];
  if (activeBackend === OPENCODE_BACKEND_ID) {
    options.push({
      id: "opencodeLog",
      label: "OpenCode backend log",
      // Off by default: this is opencode's newest *global* log, which may
      // belong to an unrelated CLI or Desktop session.
      defaultChecked: false,
      hint: "may include unrelated sessions",
    });
  }
  return options;
}

/**
 * Size hint for the activity-log row. `undefined` means the `stat` has not come
 * back yet, so the row stays hintless rather than briefly claiming the log is
 * missing; `null` means there is genuinely no file.
 */
function describeActivityLogSize(bytes: number | null | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes === null) return "nothing recorded yet";
  return formatBytes(bytes);
}

async function activityLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "activityLog", name: FRAME_LOG_NAME };
  // Honor the opt-out even if this source somehow got selected: turning the
  // toggle off leaves the previous plaintext log on disk, and a report must
  // never resurface it.
  if (!getSettings().agentMode.debugFullFrames) {
    return { ...base, unavailableReason: "The Agent Mode activity log is turned off." };
  }
  // Flush queued frames so the tail we read includes the failure the user is
  // reporting, not just whatever had already reached disk.
  await frameSink.flush();
  const path = frameSink.getPath();
  if ((await fileBytes(path)) == null) {
    return { ...base, unavailableReason: "No Agent Mode activity has been recorded yet." };
  }
  return { ...base, path };
}

async function chatLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "chatLog", name: CHAT_LOG_NAME };
  // The newest model request is still in the recorder, not the log buffer, so
  // exporting without draining it first omits the very turn being reported —
  // the same reason the activity log flushes its frame queue above. The row this
  // checkbox replaced drained it too; dropping that made the log arrive one
  // request short of the failure.
  await flushRecordedPromptPayloadToLog();
  const text = logFileManager.exportLogText();
  return text.length > 0
    ? { ...base, text }
    : { ...base, unavailableReason: "No chat log entries." };
}

async function opencodeLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "opencodeLog", name: OPENCODE_LOG_NAME };
  const path = await resolveOpencodeLogPath();
  return path ? { ...base, path } : { ...base, unavailableReason: "No OpenCode log was found." };
}

async function resolveOpencodeLogPath(): Promise<string | null> {
  try {
    const os = requireNodeModule<typeof import("node:os")>("os");
    // Resolve the log dir from the same env OpencodeBackend spawns opencode with:
    // user env overrides (e.g. XDG_DATA_HOME / HOME) relocate opencode's data dir,
    // so the log lives wherever the merged env points, not the ambient one.
    const envOverrides = getSettings().agentMode?.backends?.opencode?.envOverrides ?? {};
    const env = { ...process.env, ...envOverrides };
    const homeDir = envOverrides.HOME ?? os.homedir();
    return await findLatestOpencodeLog(env, homeDir);
  } catch {
    return null;
  }
}
