import { frameSink } from "@/agentMode/session/debugSink";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { logError, logInfo } from "@/logger";
import { captureViewScreenshot } from "@/utils/captureViewScreenshot";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { assembleReportBundle, type ReportEnvInfo } from "@/utils/issueReport";
import { findLatestOpencodeLog } from "@/utils/opencodeLog";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { cn } from "@/lib/utils";
import { getSettings } from "@/settings/model";
import { AlertTriangle } from "lucide-react";
import { App, Modal, Notice, apiVersion } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";

const OPENCODE_BACKEND_ID = "opencode";

export interface ReportIssueModalParams {
  app: App;
  /**
   * Resolves the element to screenshot, called after this modal closes and just
   * before capture. Lets the caller first dismiss any overlay (e.g. the Settings
   * window) and reveal the Agent Mode pane so the shot is the chat surface, not
   * the dialog. Returns `null` to skip the screenshot (e.g. no agent pane open).
   */
  resolveCaptureTarget: () => Promise<HTMLElement | null> | HTMLElement | null;
  /** Active backend id — gates the opencode-log option. */
  activeBackend: string;
  /** Plugin version for the report's environment block. */
  pluginVersion: string;
}

interface ElectronShell {
  openPath?: (path: string) => Promise<string>;
  openExternal?: (url: string) => Promise<void>;
  showItemInFolder?: (path: string) => void;
}

function getElectronShell(): ElectronShell | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as
      | { shell?: ElectronShell; remote?: { shell?: ElectronShell } }
      | undefined;
    return electron?.shell ?? electron?.remote?.shell ?? null;
  } catch {
    return null;
  }
}

function reportsRootDir(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("node:os") as typeof import("node:os");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    return path.join(os.tmpdir(), "obsidian-copilot", "reports");
  } catch {
    return null;
  }
}

/** `YYYYMMDD-HHmmss` in local time, for a sortable, filesystem-safe folder name. */
function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface ReportIssueContentProps {
  showOpencodeOption: boolean;
  onSubmit: (note: string, includeOpencodeLog: boolean) => void;
  onCancel: () => void;
}

function ReportIssueContent({ showOpencodeOption, onSubmit, onCancel }: ReportIssueContentProps) {
  const [note, setNote] = React.useState("");
  // Opt-in by default: the bundled log is opencode's newest *global* log, which
  // may belong to an unrelated CLI/Desktop session, so don't attach it silently.
  const [includeOpencodeLog, setIncludeOpencodeLog] = React.useState(false);

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-flex-col tw-gap-1">
        <span className="tw-text-sm tw-font-medium">What went wrong?</span>
        <Textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Describe what you were doing and what happened…"
          className="tw-min-h-24"
        />
      </div>

      {showOpencodeOption && (
        <label className="tw-flex tw-items-start tw-gap-2 tw-text-sm">
          <Checkbox
            checked={includeOpencodeLog}
            onCheckedChange={(checked) => setIncludeOpencodeLog(checked === true)}
            className="tw-mt-0.5"
          />
          <span>Include the OpenCode log (helps diagnose backend issues)</span>
        </label>
      )}

      <div className="tw-flex tw-flex-col tw-gap-1.5 tw-text-sm">
        <span className="tw-font-medium">When you click “Prepare report”</span>
        <ul className="tw-m-0 tw-flex tw-flex-col tw-gap-1 tw-pl-5 tw-text-muted">
          <li>
            A screenshot of the <strong className="tw-text-normal">Agent Mode chat pane</strong>{" "}
            (not your whole screen) and a recent activity log are saved to a folder on your
            computer.
          </li>
          <li>That folder opens, and a pre-filled GitHub issue opens in your browser.</li>
          <li>Drag the saved files into the issue to attach them, then submit.</li>
        </ul>
      </div>

      <div
        className={cn(
          "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-border tw-border-solid tw-border-warning/100",
          "tw-bg-callout-warning/20 tw-px-3.5 tw-py-2.5 tw-text-sm tw-text-warning"
        )}
        role="alert"
      >
        <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" aria-hidden="true" />
        <div className="tw-flex-1">
          <span className="tw-block tw-font-semibold">Before you share these files</span>
          <span className="tw-mt-0.5 tw-block tw-text-normal">
            The activity log can include your prompts, note contents, and tool inputs/outputs in
            plain text. Review the saved files and remove anything sensitive before posting them
            publicly.
          </span>
        </div>
      </div>

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" onClick={() => onSubmit(note, includeOpencodeLog)}>
          Prepare report
        </Button>
      </div>
    </div>
  );
}

/**
 * One-click "Report an issue" flow for Agent Mode. Collects a note (and, for
 * opencode, an optional backend-log opt-in), then on submit captures the chat
 * surface, bundles it with the frame log, reveals the folder, and opens a
 * prefilled GitHub issue. Desktop-only; the bundle assembly runs after the
 * modal closes so the screenshot reflects the unobstructed view.
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
    this.root.render(
      <ReportIssueContent
        showOpencodeOption={this.params.activeBackend === OPENCODE_BACKEND_ID}
        onSubmit={(note, includeOpencodeLog) => {
          this.close();
          void this.prepareReport(note, includeOpencodeLog);
        }}
        onCancel={() => this.close()}
      />
    );
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }

  private async prepareReport(note: string, includeOpencodeLog: boolean): Promise<void> {
    const root = reportsRootDir();
    if (!root) {
      new Notice("Could not prepare the report (filesystem unavailable).");
      return;
    }
    new Notice("Preparing issue report…");

    try {
      // Let this modal tear down, then let the caller dismiss any overlay (e.g.
      // the Settings window) and reveal the agent pane. Wait again so the
      // revealed pane is painted before capturePage reads its pixels.
      await sleep(200);
      const captureTargetEl = await this.params.resolveCaptureTarget();
      await sleep(250);
      const screenshotPng = captureTargetEl ? await captureViewScreenshot(captureTargetEl) : null;

      // Only bundle the frame log when logging is currently enabled. A user who
      // opted out may still have a stale acp-frames.ndjson on disk; honoring the
      // opt-out keeps that old plaintext out of the report.
      let frameLogPath: string | null = null;
      if (getSettings().agentMode.debugFullFrames) {
        await frameSink.flush();
        frameLogPath = frameSink.getPath();
      }

      const opencodeLogPath =
        includeOpencodeLog && this.params.activeBackend === OPENCODE_BACKEND_ID
          ? await resolveOpencodeLogPath()
          : null;

      const env: ReportEnvInfo = {
        pluginVersion: this.params.pluginVersion,
        platform: process.platform,
        obsidianVersion: apiVersion,
        activeBackend: this.params.activeBackend,
      };

      const report = await assembleReportBundle({
        note,
        env,
        screenshotPng,
        frameLogPath,
        opencodeLogPath,
        reportsRootDir: root,
        timestamp: formatTimestamp(new Date()),
      });

      const shell = getElectronShell();
      shell?.openPath?.(report.folderPath).catch(() => {});
      shell?.openExternal?.(report.issueUrl).catch(() => {});

      logInfo(`[ReportIssue] bundle written to ${report.folderPath} (${report.files.join(", ")})`);
      new Notice("Report ready. Attach the saved files to the GitHub issue that just opened.");
    } catch (err) {
      logError("[ReportIssue] failed to prepare report:", err);
      new Notice("Failed to prepare the issue report. See the console for details.");
    }
  }
}

async function resolveOpencodeLogPath(): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("node:os") as typeof import("node:os");
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
