/**
 * Assembles a self-contained Agent Mode bug-report bundle on disk (note,
 * screenshot, frame log, optional opencode log) and builds a prefilled GitHub
 * issue URL. GitHub can't attach binaries via a URL, so the files are written
 * to a folder the caller reveals in the OS file manager and the user drag-drops
 * into the issue.
 *
 * Pure of singletons: the Node runtime is injectable so the assembler is
 * unit-testable without touching the real filesystem.
 */

/**
 * End-user reports go to the PUBLIC repo. The private `obsidian-copilot-preview`
 * repo is for internal triage/BRAT only and must never receive user issues
 * (users can't see it, and routing them there would lose the report).
 */
const REPORT_REPO = "logancyang/obsidian-copilot";
const SCREENSHOT_NAME = "screenshot.png";
const FRAME_LOG_NAME = "acp-frames.ndjson";
const OPENCODE_LOG_NAME = "opencode.log";
const REPORT_NOTE_NAME = "report.md";

export interface ReportEnvInfo {
  pluginVersion: string;
  platform: string;
  obsidianVersion?: string;
  activeBackend: string;
}

export interface ReportInput {
  /** Free-text description the user typed in the modal. */
  note: string;
  env: ReportEnvInfo;
  /** PNG bytes of the captured view, or null when capture was unavailable. */
  screenshotPng: Uint8Array | null;
  /** Absolute path to the current Agent Mode frame log, if any. */
  frameLogPath: string | null;
  /** Absolute path to the latest opencode log, included only when provided. */
  opencodeLogPath: string | null;
  /** Root dir bundles are written under (one timestamped subfolder per report). */
  reportsRootDir: string;
  /** Pre-formatted timestamp (e.g. `20260615-101500`) used for the subfolder. */
  timestamp: string;
}

export interface AssembledReport {
  /** Absolute path to the created bundle folder. */
  folderPath: string;
  /** Basenames of the files written into the folder. */
  files: string[];
  /** Prefilled GitHub "new issue" URL for the user to open. */
  issueUrl: string;
}

export interface ReportRuntime {
  join: (...parts: string[]) => string;
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>;
  writeFile: (path: string, data: string | Uint8Array) => Promise<void>;
  copyFile: (src: string, dest: string) => Promise<void>;
}

/**
 * Write the report bundle to `<reportsRootDir>/report-<timestamp>/` and return
 * its path, the file basenames written, and a prefilled issue URL. Best-effort
 * per file: a missing/unreadable frame or opencode log is skipped rather than
 * failing the whole report.
 */
export async function assembleReportBundle(
  input: ReportInput,
  runtime: ReportRuntime = getNodeReportRuntime()
): Promise<AssembledReport> {
  const folderPath = runtime.join(input.reportsRootDir, `report-${input.timestamp}`);
  await runtime.mkdir(folderPath, { recursive: true });

  const files: string[] = [];

  if (input.screenshotPng && input.screenshotPng.length > 0) {
    try {
      await runtime.writeFile(runtime.join(folderPath, SCREENSHOT_NAME), input.screenshotPng);
      files.push(SCREENSHOT_NAME);
    } catch {
      // Screenshot is optional; keep going without it.
    }
  }

  if (input.frameLogPath) {
    try {
      await runtime.copyFile(input.frameLogPath, runtime.join(folderPath, FRAME_LOG_NAME));
      files.push(FRAME_LOG_NAME);
    } catch {
      // Frame log may not exist yet (logging just enabled); skip it.
    }
  }

  if (input.opencodeLogPath) {
    try {
      await runtime.copyFile(input.opencodeLogPath, runtime.join(folderPath, OPENCODE_LOG_NAME));
      files.push(OPENCODE_LOG_NAME);
    } catch {
      // opencode log may be absent; skip it.
    }
  }

  const noteMarkdown = buildReportMarkdown(input, files);
  await runtime.writeFile(runtime.join(folderPath, REPORT_NOTE_NAME), noteMarkdown);
  files.unshift(REPORT_NOTE_NAME);

  return {
    folderPath,
    files,
    issueUrl: buildReportIssueUrl(input, files),
  };
}

/** Markdown report body, mirrored both into `report.md` and the issue prefill. */
export function buildReportMarkdown(input: ReportInput, attachedFiles: string[]): string {
  const note = input.note.trim() || "_No description provided._";
  const attachments = attachedFiles.length > 0 ? attachedFiles : ["(none captured)"];
  return [
    "## What went wrong",
    "",
    note,
    "",
    "## Environment",
    "",
    `- Plugin version: ${input.env.pluginVersion}`,
    `- Active backend: ${input.env.activeBackend}`,
    `- Platform: ${input.env.platform}`,
    ...(input.env.obsidianVersion ? [`- Obsidian: ${input.env.obsidianVersion}`] : []),
    "",
    "## Attached files",
    "",
    ...attachments.map((f) => `- ${f}`),
    "",
    "> These files were saved to the bundle folder that just opened. Drag them",
    "> into the GitHub issue to attach them.",
    "",
  ].join("\n");
}

/**
 * `shell.openExternal` silently rejects URLs over ~2081 chars on Windows, which
 * would skip opening the issue page while the caller still reports success. Cap
 * the assembled URL well under that so the page always opens; the full report
 * already lives in `report.md` on disk for the user to paste in.
 */
const MAX_ISSUE_URL_LENGTH = 1800;
const BODY_TRUNCATION_NOTE =
  "\n\n_…report truncated. The full report is saved as `report.md` in the bundle " +
  "folder that just opened — paste it here._";

/**
 * Build a prefilled GitHub "new issue" URL. The body carries the note and
 * environment; the saved files must be drag-dropped by the user since a URL
 * cannot upload binaries. The body is truncated when needed to keep the URL
 * within `MAX_ISSUE_URL_LENGTH`.
 */
export function buildReportIssueUrl(input: ReportInput, attachedFiles: string[]): string {
  const firstLine = input.note.trim().split("\n")[0]?.slice(0, 80).trim();
  const title = firstLine ? `[Agent Mode] ${firstLine}` : "[Agent Mode] Issue report";
  const body = buildReportMarkdown(input, attachedFiles);
  const base = `https://github.com/${REPORT_REPO}/issues/new?`;

  const build = (b: string) =>
    base + new URLSearchParams({ title, body: b, labels: "bug" }).toString();

  if (build(body).length <= MAX_ISSUE_URL_LENGTH) return build(body);

  // URL-encoding expands characters non-linearly, so shrink the kept slice
  // until the fully-encoded URL fits rather than estimating a byte budget.
  let keep = body.length;
  let truncated = build(body.slice(0, keep) + BODY_TRUNCATION_NOTE);
  while (keep > 0 && truncated.length > MAX_ISSUE_URL_LENGTH) {
    keep = Math.max(0, keep - Math.ceil((truncated.length - MAX_ISSUE_URL_LENGTH) / 3));
    truncated = build(body.slice(0, keep) + BODY_TRUNCATION_NOTE);
  }
  return truncated;
}

function getNodeReportRuntime(): ReportRuntime {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs/promises") as typeof import("node:fs/promises");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  return {
    join: (...parts: string[]) => path.join(...parts),
    mkdir: async (p, opts) => {
      await fs.mkdir(p, opts);
    },
    writeFile: (p, data) => fs.writeFile(p, data),
    copyFile: (src, dest) => fs.copyFile(src, dest),
  };
}
