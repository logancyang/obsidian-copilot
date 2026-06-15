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
import { App, Modal, Notice, apiVersion } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";

const OPENCODE_BACKEND_ID = "opencode";

export interface ReportIssueModalParams {
  app: App;
  /** Root element of the agent view; screenshotted to capture the chat surface. */
  captureTargetEl: HTMLElement;
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

      <div className="tw-rounded-md tw-bg-secondary tw-p-3 tw-text-xs tw-text-muted">
        Submitting saves a screenshot of this view plus the Agent Mode frame log to a folder on your
        computer. The log can contain your prompts, note contents, and tool inputs/outputs in
        plaintext. Review the files before sharing them publicly.
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
      // Let the modal overlay tear down before capturing so the screenshot
      // shows the chat surface, not a dimmed/closing dialog.
      await sleep(200);
      const screenshotPng = await captureViewScreenshot(this.params.captureTargetEl);

      await frameSink.flush();
      const frameLogPath = frameSink.getPath();

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
    return await findLatestOpencodeLog(process.env, os.homedir());
  } catch {
    return null;
  }
}
