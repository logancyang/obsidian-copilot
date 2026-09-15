import { frameSink } from "@/agentMode/session/debugSink";
import { logError, logInfo, logWarn } from "@/logger";
import { flushRecordedPromptPayloadToLog } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { logFileManager } from "@/logFileManager";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";
import { formatBytes } from "@/utils/formatBytes";
import {
  buildLinkedReportIssueUrl,
  buildManualIssueUrl,
  buildReportBundle,
  getNodeReportRuntime,
  type ReportLogRequest,
} from "@/utils/issueReport";
import { ReportUploadError, type ReportUploader } from "@/utils/reportUpload";
import { findLatestOpencodeLog } from "@/utils/opencodeLog";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { captureBehindOverlay } from "./reportScreenshot";
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
 * Create the private directory one report's zip is written into.
 * Made fresh per report rather than reused at a fixed path: on a machine whose
 * temp dir is shared between accounts, a predictable path can be created first
 * by someone else, and a name planted inside it ahead of time is followed by the
 * write that lands there — enough to overwrite a file the user owns. `mkdtemp`
 * settles all three preconditions at once, since it creates atomically, names
 * unpredictably, and is owner-only from the start.
 */
export async function createReportDir(): Promise<string> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return fs.mkdtemp(path.join(os.tmpdir(), "obsidian-copilot-report-"));
}

/**
 * Delete the directory a report's zip lives in. Never rejects: every caller is
 * closing the dialog or already handling a failure, and what a refused delete
 * leaves behind is a temp folder the OS will reclaim, so a log line will do.
 *
 * @param report Whose `zipDir` goes; nothing else in the report is read.
 */
export async function discardReport(report: Pick<PreparedReport, "zipDir">): Promise<void> {
  try {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    await fs.rm(report.zipDir, { recursive: true, force: true });
  } catch (err) {
    logWarn(`[ReportIssue] could not remove the abandoned report at ${report.zipDir}:`, err);
  }
}

/**
 * Unique, sortable bundle id that names the zip. The millisecond suffix keeps
 * two reports prepared in the same second apart in a maintainer's downloads.
 */
function formatBundleId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${date.getTime().toString(36).slice(-4)}`;
}

/**
 * Upload the report's packed attempt and build the issue URL its id belongs
 * in. Never rejects: the review page renders whichever outcome comes back, and
 * every failure is retried the same way, by re-sending the same attempt.
 *
 * @param uploader Sends one packed attempt and answers with the stored report's id, or throws.
 * @param report The bundle whose attempt is sent and whose issue draft the URL is built from.
 */
export async function uploadReport(
  uploader: ReportUploader,
  report: PreparedReport
): Promise<UploadOutcome> {
  try {
    const { reportId } = await uploader(report.uploadAttempt);
    return { ok: true, reportId, issueUrl: buildLinkedReportIssueUrl(report.issueDraft, reportId) };
  } catch (err) {
    logError("[ReportIssue] could not upload the report:", err);
    // Only an upload error carries a message written for a person; anything
    // else is an internal failure whose text would mean nothing to the user.
    const generic = "Something went wrong while uploading the report.";
    return { ok: false, error: err instanceof ReportUploadError ? err.message : generic };
  }
}

/**
 * Hand a prefilled issue URL to the OS browser and say whether it was taken.
 * Never rejects: the bridge can be absent, reject its promise, or throw before
 * returning one, and every shape lands as `false` with the cause logged.
 *
 * @param shell The Electron shell bridge, or null; taken whole so the call keeps its receiver.
 * @param url The prefilled GitHub "new issue" address to open.
 */
export async function openIssuePageWith(
  shell: Pick<ElectronShell, "openExternal"> | null,
  url: string
): Promise<boolean> {
  if (!shell?.openExternal) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch (err) {
    logError("[ReportIssue] could not open the issue page:", err);
    return false;
  }
}

/**
 * Host of the guided "Report an issue" flow: the one place in it that touches
 * the filesystem, the Electron shell and Obsidian's `Notice`. `ReportIssueFlow`
 * owns the two pages and `issueReport` owns assembly; everything
 * platform-specific — the capture, the log sources, the zip, the upload, the
 * OS browser and file manager — stops here. Also owns the zip's lifetime once
 * it exists, because Obsidian's `Modal` cannot refuse a close: ESC is an exit
 * off the review page the flow's Cancel button does not see, so what happens
 * to the zip is decided here from what the modal last handed out.
 */
export class ReportIssueModal extends Modal {
  private root: Root | null = null;
  /** The zip on the review page, until it is uploaded or discarded. */
  private prepared: PreparedReport | null = null;
  private uploading = false;

  constructor(private readonly params: ReportIssueModalParams) {
    super(params.app);
    // @ts-ignore — setTitle exists at runtime (see ConfirmModal).
    // Not "an Agent Mode issue": this dialog opens from the general Debugging &
    // support settings and can carry nothing but the regular chat log, so
    // naming a mode here would misdescribe the report a Quick Chat user is
    // filing. Same reason the issue title carries no mode prefix.
    this.setTitle("Report an issue");
  }

  onOpen() {
    // Every source this flow collects is read through Node and the zip lands in
    // the OS temp folder, neither of which mobile has. Refusing up front is the
    // only honest answer: an opened dialog would fail at whichever step touched
    // disk first, after the user had already written their description.
    if (!isDesktopRuntime()) {
      new Notice("Reporting an issue is available on desktop only.");
      this.close();
      return;
    }
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <ReportIssueFlow
        sources={this.buildSources()}
        prepare={(note, selected, onStep) => this.prepare(note, selected, onStep)}
        upload={(report) => this.upload(report)}
        discardReport={(report) => this.discard(report)}
        onCancel={() => this.close()}
        onUploaded={(outcome) => void this.onUploaded(outcome)}
        openIssuePage={(url) => void this.openIssuePage(url)}
        revealFile={(path) => this.revealFile(path)}
      />
    );
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    // A zip nobody will send is plaintext prompts and note contents in the OS
    // temp folder, so ESC on the review page must take it with it. An upload
    // in flight is the exception: its bytes are already on their way, and if
    // they never arrive the zip is the copy the user is told about
    // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    if (this.prepared && !this.uploading) void this.discard(this.prepared);
  }

  /**
   * Forgets the report before deleting it, so the flow's Cancel button and the
   * close that follows it do not both reach for the same directory.
   */
  private discard(report: PreparedReport): Promise<void> {
    if (this.prepared === report) this.prepared = null;
    return discardReport(report);
  }

  private buildSources(): ReportSourceOption[] {
    const settings = getSettings();
    const sources: ReportSourceOption[] = [];
    // A screenshot needs a pane to point the camera at. A shot that cannot be
    // taken is not on the list at all, rather than offered and then skipped.
    if (this.params.canCaptureTarget()) {
      sources.push({
        id: "screenshot",
        label: "Screenshot of the Agent Mode pane",
        defaultChecked: true,
      });
    }
    const activityLogOn = settings.agentMode.debugFullFrames;
    sources.push(
      {
        id: "activityLog",
        label: "Agent Mode activity log",
        description: activityLogOn ? undefined : "turned off in Settings → Advanced",
        defaultChecked: activityLogOn,
      },
      {
        id: "chatLog",
        label: "Regular chat log",
        description: "copilot log file",
        defaultChecked: settings.debug,
      }
    );
    if (this.params.activeBackend === OPENCODE_BACKEND_ID) {
      sources.push({
        id: "opencodeLog",
        label: "OpenCode backend log",
        // Off by default: this is opencode's newest *global* log, which may
        // belong to an unrelated CLI or Desktop session.
        description: "may include unrelated sessions",
        defaultChecked: false,
      });
    }
    return sources;
  }

  private async prepare(
    note: string,
    selected: ReadonlySet<ReportSourceId>,
    onStep: (step: PrepareStep) => void
  ): Promise<PreparedReport> {
    // Two absences the manifest tells apart: `undefined` for a screenshot never
    // selected, which gets no line at all, and `null` for one selected but not
    // captured (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    let screenshotPng: Uint8Array | null | undefined;
    if (selected.has("screenshot")) {
      screenshotPng = null;
      try {
        screenshotPng = await captureBehindOverlay(
          this.containerEl,
          () => this.params.resolveCaptureTarget(),
          () => this.params.dismissSettings()
        );
      } catch (err) {
        // A pane that went away before the capture costs the picture, not the report.
        logWarn("[ReportIssue] the screenshot failed; the report goes without it:", err);
      }
    }
    onStep("screenshot");

    const logs: ReportLogRequest[] = [];
    if (selected.has("activityLog")) logs.push(await activityLogRequest());
    if (selected.has("chatLog")) logs.push(await chatLogRequest());
    if (selected.has("opencodeLog")) logs.push(await opencodeLogRequest());
    onStep("logs");

    const bundle = await buildReportBundle(
      {
        bundleId: formatBundleId(new Date()),
        note,
        env: {
          pluginVersion: this.params.pluginVersion,
          platform: process.platform,
          obsidianVersion: apiVersion,
          activeBackend: this.params.activeBackend,
        },
        screenshotPng,
        logs,
      },
      getNodeReportRuntime()
    );

    // Built before the directory exists, so a bundle that fails leaves nothing
    // on disk; the directory then holds the zip and nothing else.
    const zipDir = await createReportDir();
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const zipPath = path.join(zipDir, bundle.zipName);
    try {
      await fs.writeFile(zipPath, bundle.zip);
    } catch (err) {
      // A partly written zip is plaintext prompts and note contents in a folder
      // nothing will name again: the error goes back to the form and the
      // directory goes with it (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
      await discardReport({ zipDir });
      throw err;
    }
    onStep("zip");

    logInfo(
      `[ReportIssue] bundle ready at ${zipPath} (${formatBytes(bundle.uploadAttempt.body.byteLength)})`
    );
    this.prepared = {
      zipDir,
      zipPath,
      zipName: bundle.zipName,
      uploadAttempt: bundle.uploadAttempt,
      issueDraft: bundle.issueDraft,
      manualIssueUrl: buildManualIssueUrl(bundle.issueDraft),
      attachments: bundle.attachments,
    };
    return this.prepared;
  }

  private async upload(report: PreparedReport): Promise<UploadOutcome> {
    this.uploading = true;
    const outcome = await uploadReport(this.params.uploader, report);
    this.uploading = false;
    if (this.root) return outcome;
    // The dialog closed while the bytes were in flight. No browser tab — the
    // user has moved on — but the id is the one thing they cannot reconstruct,
    // so a success hands it over with a way to the issue; a failure asks nothing
    // of them and the zip stays put (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    if (outcome.ok) {
      this.issueLinkNotice(`Report uploaded (ID ${outcome.reportId}).`, outcome.issueUrl);
    } else {
      logWarn(
        `[ReportIssue] the upload failed after the dialog closed; the zip is still at ${report.zipPath}:`,
        outcome.error
      );
    }
    return outcome;
  }

  /**
   * The flow has no page after the upload: the browser is opened, the dialog
   * closes, and a notice says what happened. The close does not wait for the
   * browser — the report is already stored, and a hung shell would otherwise
   * keep a dead dialog on screen — only the notice does, since which one to
   * show depends on whether the page opened.
   */
  private async onUploaded({ reportId, issueUrl }: { reportId: string; issueUrl: string }) {
    // Once stored, the zip is the user's to keep, so the close below must not
    // take it: the issue page opens in a browser that can fail, and a
    // maintainer may still ask for the file.
    this.prepared = null;
    const opened = openIssuePageWith(getElectronShell(), issueUrl);
    this.close();
    if (await opened) {
      new Notice("Report uploaded. Finish the issue in your browser.");
    } else {
      // The report is stored either way; what is missing is the way to the
      // issue page, so the notice carries it in place of the browser
      // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
      this.issueLinkNotice(
        `Report uploaded (ID ${reportId}), but Copilot could not open your browser.`,
        issueUrl
      );
    }
  }

  /** "Open issue anyway": the no-ID page for a report the user attaches by hand. */
  private async openIssuePage(url: string): Promise<void> {
    if (!(await openIssuePageWith(getElectronShell(), url))) {
      this.issueLinkNotice("Copilot could not open your browser.", url);
    }
  }

  /** Stays until dismissed; the address holds the whole report, far too long to read out. */
  private issueLinkNotice(text: string, url: string): void {
    const fragment = this.contentEl.doc.win.createFragment();
    fragment.append(`${text} `);
    fragment.createEl("a", { href: url, text: "Open the GitHub issue page" });
    new Notice(fragment, 0);
  }

  /**
   * Show the finished zip in the OS file manager. A missing capability is said
   * out loud: this is the review step's fallback when the upload cannot be
   * used, and a silent no-op would leave the user with a report they cannot find.
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
}

// Both reasons name a state the user can act on (turn the log on, fix its location) and show
// verbatim as the manifest note, which keeps them distinct from the assembler's "not found".
async function activityLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "activityLog", name: FRAME_LOG_NAME };
  // Honor the opt-out even if this source somehow got selected: turning the
  // toggle off leaves the previous plaintext log on disk, and a report must
  // never resurface it.
  if (!getSettings().agentMode.debugFullFrames) {
    return { ...base, unavailableReason: "The Agent Mode activity log is turned off." };
  }
  // The sink both owns the location and vouches for it, so a path it will not
  // stand behind is one this report must not read, let alone upload. Asking it
  // also settles the write queue on the way — it answers from the same chain
  // the appends run on — so the tail read later includes the failure the user
  // is reporting rather than whatever had already reached disk.
  const path = await frameSink.getValidatedPath();
  return path === null
    ? { ...base, unavailableReason: "The Agent Mode activity log's location is unavailable." }
    : { ...base, path };
}

async function chatLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "chatLog", name: CHAT_LOG_NAME };
  // The newest model request is still in the recorder, not the log buffer, so
  // exporting without draining it first would omit the very turn being
  // reported — the same reason the activity log settles its write queue above.
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
