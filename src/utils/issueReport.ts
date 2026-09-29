import { err2String } from "@/errorFormat";
import { formatBytes } from "@/utils/formatBytes";
import { type ReportUploadAttempt } from "@/utils/reportUpload";
import { zipSync } from "fflate";
import { v4 as uuidv4 } from "uuid";
import { redactLogText } from "@/utils/redactLog";
import { requireNodeModule } from "@/utils/desktopRuntime";
import {
  MIN_LOG_TAIL_BYTES,
  TRUNCATION_NOTE_RESERVE_BYTES,
  byteLength,
  encodeText,
  headOfText,
  readLogFrom,
  tailOfText,
  withTruncationNote,
} from "@/utils/logTail";

const REPORT_REPO = "logancyang/obsidian-copilot";
const SCREENSHOT_NAME = "screenshot.png";
const REPORT_NOTE_NAME = "report.md";
const SCREENSHOT_SOURCE_ID = "screenshot";
const REPORT_NOTE_SOURCE_ID = "report";

const MAX_BUNDLE_BYTES = 24 * 1024 * 1024;
const GITHUB_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;

const MAX_NOTE_BYTES = 64 * 1024;
const REPORT_NOTE_RESERVE_BYTES = MAX_NOTE_BYTES + 8 * 1024;
const MAX_REASON_BYTES = 1024;
export const MAX_REDACTABLE_LOG_BYTES = 64 * 1024 * 1024;

export interface ReportEnvInfo {
  pluginVersion: string;
  platform: string;
  obsidianVersion?: string;
  activeBackend: string;
}

export interface ReportLogRequest {
  id: string;
  name: string;
  path?: string;
  text?: string;
  unavailableReason?: string;
}

export interface ReportInput {
  bundleId: string;
  note: string;
  env: ReportEnvInfo;
  screenshotPng?: Uint8Array | null;
  logs: ReportLogRequest[];
}

export interface AttachmentResult {
  id: string;
  name: string;
  bytes: number;
  included: boolean;
  note?: string;
}

export interface ReportIssueDraft {
  title: string;
  body: string;
}

export interface ReportBundle {
  zip: Uint8Array;
  zipName: string;
  uploadAttempt: ReportUploadAttempt;
  issueDraft: ReportIssueDraft;
  attachments: AttachmentResult[];
}

export interface ReportRuntime {
  readLog: (path: string, maxBytes: number) => Promise<{ text: string; totalBytes: number }>;
}

interface SourceEntry {
  result: AttachmentResult;
  bytes?: Uint8Array;
}

export async function buildReportBundle(
  input: ReportInput,
  runtime: ReportRuntime = getNodeReportRuntime()
): Promise<ReportBundle> {
  let remainingBytes = MAX_BUNDLE_BYTES - REPORT_NOTE_RESERVE_BYTES;
  const entries: Record<string, Uint8Array> = Object.create(null);
  const attachments: AttachmentResult[] = [];
  const admit = ({ result, bytes }: SourceEntry) => {
    attachments.push(result);
    if (!bytes) return;
    entries[result.name] = bytes;
    remainingBytes -= bytes.length;
  };

  if (input.screenshotPng !== undefined)
    admit(screenshotEntry(input.screenshotPng, remainingBytes));
  for (const log of input.logs) admit(await logEntry(log, remainingBytes, runtime));

  const markdown = buildReportMarkdown(input, attachments);
  const noteBytes = encodeText(markdown);
  if (noteBytes.length > REPORT_NOTE_RESERVE_BYTES) {
    throw new Error(
      `The report summary came out ${formatBytes(noteBytes.length)}, over the ` +
        `${formatBytes(REPORT_NOTE_RESERVE_BYTES)} set aside for it. Include fewer sources.`
    );
  }
  entries[REPORT_NOTE_NAME] = noteBytes;
  attachments.unshift({
    id: REPORT_NOTE_SOURCE_ID,
    name: REPORT_NOTE_NAME,
    bytes: noteBytes.length,
    included: true,
  });

  const zip = zipSync(entries, { level: 0 });
  if (zip.length > GITHUB_ATTACHMENT_LIMIT_BYTES) {
    throw new Error(describeOversizedZip(zip.length, attachments));
  }

  return {
    zip,
    zipName: `copilot-report-${input.bundleId}.zip`,
    uploadAttempt: { body: exactArrayBuffer(zip), idempotencyKey: uuidv4() },
    issueDraft: { title: issueTitle(input.note), body: markdown },
    attachments,
  };
}

function screenshotEntry(png: Uint8Array | null, remainingBytes: number): SourceEntry {
  const base = { id: SCREENSHOT_SOURCE_ID, name: SCREENSHOT_NAME } as const;
  if (!png || png.length === 0)
    return { result: { ...base, bytes: 0, included: false, note: "no screenshot was captured" } };
  if (png.length > remainingBytes) {
    const note = `screenshot is ${formatBytes(png.length)}, over the ${formatBytes(remainingBytes)} left`;
    return { result: { ...base, bytes: 0, included: false, note } };
  }
  return { result: { ...base, bytes: png.length, included: true }, bytes: png };
}

async function logEntry(
  log: ReportLogRequest,
  remainingBytes: number,
  runtime: ReportRuntime
): Promise<SourceEntry> {
  const leftOut = (note: string): SourceEntry => ({
    result: { id: log.id, name: log.name, bytes: 0, included: false, note },
  });
  const tooBig = (size: number, limit: string) =>
    leftOut(`log is ${formatBytes(size)}, over the ${limit}`);
  const emptyTail = () => leftOut("newest entry alone is larger than the room left");
  const room = remainingBytes - TRUNCATION_NOTE_RESERVE_BYTES;
  const cutToFit = (text: string) => tailOfText(text, room).text.replace(/^[^\n]*\n?/, "");

  if (log.path == null && log.text == null)
    return leftOut(describeReason(log.unavailableReason ?? "not found"));

  try {
    const raw =
      log.path != null
        ? await runtime.readLog(log.path, MAX_REDACTABLE_LOG_BYTES)
        : tailOfText(log.text ?? "", MAX_REDACTABLE_LOG_BYTES);
    if (raw.totalBytes === 0) return leftOut("empty");
    // A log read in part cannot be redacted: the omitted part may hold the key that names a value inside it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
    if (raw.totalBytes > MAX_REDACTABLE_LOG_BYTES)
      return tooBig(raw.totalBytes, `${formatBytes(MAX_REDACTABLE_LOG_BYTES)} a report can redact`);
    // Read whole, redact whole, then cut: a key can sit any distance ahead of its value, so only full-text redaction is safe.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
    const redacted = redactLogText(raw.text);
    const redactedBytes = byteLength(redacted);
    const truncated = redactedBytes > remainingBytes;
    if (truncated && remainingBytes < MIN_LOG_TAIL_BYTES)
      return tooBig(redactedBytes, `${formatBytes(remainingBytes)} left`);
    const whole = truncated ? cutToFit(redacted) : redacted;
    if (truncated && whole.trim() === "") return emptyTail();
    const bytes = encodeText(truncated ? withTruncationNote(whole, raw.totalBytes) : whole);

    const note = truncated
      ? `truncated to the newest entries of ${formatBytes(raw.totalBytes)}`
      : undefined;
    return {
      result: { id: log.id, name: log.name, bytes: bytes.length, included: true, note },
      bytes,
    };
  } catch (err) {
    // A fresh install enables the activity log before anything is written, so the first report meets a missing file, not a read failure.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
    if ((err as { code?: unknown } | null)?.code === "ENOENT") return leftOut("not found");
    return leftOut(`failed: ${describeReason(err2String(err))}`);
  }
}

function issueTitle(note: string): string {
  const firstLine = redactLogText(note)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ? firstLine.slice(0, 80).trim() : "Copilot issue report";
}

export function buildReportMarkdown(input: ReportInput, attachments: AttachmentResult[]): string {
  const listed = attachments.filter((a) => a.id !== REPORT_NOTE_SOURCE_ID);
  return [
    "## What went wrong",
    "",
    describeNote(input.note),
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
    ...(listed.length > 0 ? listed.map(describeAttachment) : ["- (none captured)"]),
    "",
    "> These files are bundled in the zip Copilot prepared for this report.",
    "",
  ].join("\n");
}

function describeAttachment({ name, included, note }: AttachmentResult): string {
  if (included) return note ? `- ${name} — ${note}` : `- ${name}`;
  return `- ${name} — not included${note ? `: ${note}` : ""}`;
}

const MAX_ISSUE_URL_LENGTH = 1800;
const BODY_TRUNCATION_NOTE =
  "\n\n_…report truncated. The full report is `report.md` inside the report zip._";

function buildIssueUrl(title: string, prefix: string, body: string): string {
  const base = `https://github.com/${REPORT_REPO}/issues/new?`;
  const build = (b: string) =>
    base + new URLSearchParams({ title, body: prefix + b, labels: "bug" }).toString();

  if (build(body).length <= MAX_ISSUE_URL_LENGTH) return build(body);

  if (build(BODY_TRUNCATION_NOTE).length > MAX_ISSUE_URL_LENGTH) {
    throw new Error(
      `The GitHub issue link came out longer than the ${MAX_ISSUE_URL_LENGTH}-character ` +
        "limit on its own — nothing left to truncate."
    );
  }

  let keep = body.length;
  let truncated = build(body.slice(0, keep) + BODY_TRUNCATION_NOTE);
  while (keep > 0 && truncated.length > MAX_ISSUE_URL_LENGTH) {
    keep = Math.max(0, keep - Math.ceil((truncated.length - MAX_ISSUE_URL_LENGTH) / 3));
    truncated = build(body.slice(0, keep) + BODY_TRUNCATION_NOTE);
  }
  return truncated;
}

export function buildManualIssueUrl(draft: ReportIssueDraft): string {
  return buildIssueUrl(draft.title, "", draft.body);
}

export function buildLinkedReportIssueUrl(draft: ReportIssueDraft, reportId: string): string {
  return buildIssueUrl(draft.title, `**Copilot report ID:** \`${reportId}\`\n\n`, draft.body);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
    return bytes.buffer as ArrayBuffer;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function describeOversizedZip(zippedBytes: number, attachments: AttachmentResult[]): string {
  const opener =
    `The report zip came out ${formatBytes(zippedBytes)}, over GitHub's ` +
    `${formatBytes(GITHUB_ATTACHMENT_LIMIT_BYTES)} attachment limit. `;
  let largest: AttachmentResult | null = null;
  for (const attachment of attachments) {
    if (!attachment.included || attachment.id === REPORT_NOTE_SOURCE_ID) continue;
    if (!largest || attachment.bytes > largest.bytes) largest = attachment;
  }
  if (!largest) return `${opener}Include fewer sources and prepare it again.`;
  return (
    `${opener}The biggest one it can drop is ${largest.name} at ` +
    `${formatBytes(largest.bytes)} uncompressed — uncheck that first, then anything ` +
    "else you can spare, and prepare the report again."
  );
}

function describeNote(note: string): string {
  const redacted = redactLogText(note.trim());
  if (!redacted) return "_No description provided._";
  const { text, totalBytes } = headOfText(redacted, MAX_NOTE_BYTES);
  if (totalBytes <= MAX_NOTE_BYTES) return redacted;
  return (
    `${text}\n\n_…description truncated: only the first ${formatBytes(byteLength(text))} of ` +
    `${formatBytes(totalBytes)} was kept so the report stays under GitHub's upload limit._`
  );
}

function describeReason(reason: string): string {
  const oneLine = redactLogText(reason).replace(/\s+/g, " ").trim();
  const { text, totalBytes } = headOfText(oneLine, MAX_REASON_BYTES);
  return totalBytes > MAX_REASON_BYTES ? `${text}…` : text;
}

export function getNodeReportRuntime(): ReportRuntime {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  return {
    readLog: async (p, maxBytes) => {
      const handle = await fs.open(p, "r");
      try {
        return await readLogFrom(handle, maxBytes);
      } finally {
        await handle.close();
      }
    },
  };
}
