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
  type ReportSourceId,
  type ReportSourceOption,
  type UploadOutcome,
} from "./ReportIssueFlow";

const OPENCODE_BACKEND_ID = "opencode";

const FRAME_LOG_NAME = "acp-frames.ndjson.txt";
const CHAT_LOG_NAME = "copilot-log.md";
const OPENCODE_LOG_NAME = "opencode.log";

export interface ReportIssueModalParams {
  app: App;
  resolveCaptureTarget: () => Promise<HTMLElement | null> | HTMLElement | null;
  dismissSettings: () => void;
  canCaptureTarget: () => boolean;
  activeBackend: string;
  pluginVersion: string;
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

export async function createReportDir(): Promise<string> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return fs.mkdtemp(path.join(os.tmpdir(), "obsidian-copilot-report-"));
}

export async function discardReport(report: Pick<PreparedReport, "zipDir">): Promise<void> {
  try {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    await fs.rm(report.zipDir, { recursive: true, force: true });
  } catch (err) {
    logWarn(`[ReportIssue] could not remove the abandoned report at ${report.zipDir}:`, err);
  }
}

function formatBundleId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${date.getTime().toString(36).slice(-4)}`;
}

export async function uploadReport(
  uploader: ReportUploader,
  report: PreparedReport
): Promise<UploadOutcome> {
  try {
    const { reportId } = await uploader(report.uploadAttempt);
    return { ok: true, reportId, issueUrl: buildLinkedReportIssueUrl(report.issueDraft, reportId) };
  } catch (err) {
    logError("[ReportIssue] could not upload the report:", err);
    const generic = "Something went wrong while uploading the report.";
    return { ok: false, error: err instanceof ReportUploadError ? err.message : generic };
  }
}

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

export class ReportIssueModal extends Modal {
  private root: Root | null = null;
  private prepared: PreparedReport | null = null;
  private uploading = false;

  constructor(private readonly params: ReportIssueModalParams) {
    super(params.app);
    // @ts-ignore — setTitle exists at runtime (see ConfirmModal).
    this.setTitle("Report an issue");
  }

  onOpen() {
    if (!isDesktopRuntime()) {
      new Notice("Reporting an issue is available on desktop only.");
      this.close();
      return;
    }
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <ReportIssueFlow
        sources={this.buildSources()}
        prepare={(note, selected) => this.prepare(note, selected)}
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

  private discard(report: PreparedReport): Promise<void> {
    // A manual handoff releases ownership even while the dialog stays open;
    // Cancel must not delete the attachment the user is about to send
    // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    if (this.prepared !== report) return Promise.resolve();
    this.prepared = null;
    return discardReport(report);
  }

  private buildSources(): ReportSourceOption[] {
    const settings = getSettings();
    const sources: ReportSourceOption[] = [];
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
        label: "Copilot log",
        description: "includes Agent Mode backend errors",
        // OpenCode 2's server errors reach only this log, and reporters skipped it unchecked.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/649
        defaultChecked: true,
      }
    );
    if (this.params.activeBackend === OPENCODE_BACKEND_ID) {
      sources.push({
        id: "opencodeLog",
        label: "OpenCode backend log",
        description: "may include unrelated sessions",
        defaultChecked: false,
      });
    }
    return sources;
  }

  private async prepare(
    note: string,
    selected: ReadonlySet<ReportSourceId>
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
        logWarn("[ReportIssue] the screenshot failed; the report goes without it:", err);
      }
    }

    // This order is the budget: `buildReportBundle` spends the bundle's room in
    // request order and cuts each log to what is left, so an early source can
    // starve every later one below the tail floor and drop it whole. Ask in
    // ascending order of how large the source gets. The chat log is capped at
    // the source (`logFileManager` keeps 500 lines), opencode's log is its own
    // and stays modest, and the frame log routinely reaches its 50 MiB rotation
    // on a heavy session, so it goes last and loses a tail instead — the
    // degradation it is built for and already announces.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/538
    const logs: ReportLogRequest[] = [];
    if (selected.has("chatLog")) logs.push(await chatLogRequest());
    if (selected.has("opencodeLog")) logs.push(await opencodeLogRequest());
    if (selected.has("activityLog")) logs.push(await activityLogRequest());

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

  private async onUploaded({ reportId, issueUrl }: { reportId: string; issueUrl: string }) {
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

  private async openIssuePage(url: string): Promise<void> {
    // The browser or fallback link hands the zip to the user. Release it before
    // waiting so closing the dialog cannot remove their manual attachment
    // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    this.prepared = null;
    if (!(await openIssuePageWith(getElectronShell(), url))) {
      this.issueLinkNotice("Copilot could not open your browser.", url);
    }
  }

  private issueLinkNotice(text: string, url: string): void {
    const fragment = this.contentEl.doc.win.createFragment();
    fragment.append(`${text} `);
    fragment.createEl("a", { href: url, text: "Open the GitHub issue page" });
    new Notice(fragment, 0);
  }

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

async function activityLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "activityLog", name: FRAME_LOG_NAME };
  if (!getSettings().agentMode.debugFullFrames) {
    return { ...base, unavailableReason: "The Agent Mode activity log is turned off." };
  }
  const path = await frameSink.getValidatedPath();
  return path === null
    ? { ...base, unavailableReason: "The Agent Mode activity log's location is unavailable." }
    : { ...base, path };
}

async function chatLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "chatLog", name: CHAT_LOG_NAME };
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
    const envOverrides = getSettings().agentMode?.backends?.opencode?.envOverrides ?? {};
    const env = { ...process.env, ...envOverrides };
    const homeDir = envOverrides.HOME ?? os.homedir();
    return await findLatestOpencodeLog(env, homeDir);
  } catch {
    return null;
  }
}
