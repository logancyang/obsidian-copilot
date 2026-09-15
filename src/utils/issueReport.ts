/**
 * Assembles a bug-report bundle in memory and builds the prefilled GitHub issue
 * URLs it can be filed with. The disk is reached only through the injected
 * `readLog`, so assembly is testable without a filesystem and the caller alone
 * decides where the zip goes. Every requested source is listed with its actual
 * outcome, so the review page and `report.md` say what landed in the bundle, not
 * what was ticked. Every free-text input — log bodies, description, title, failure
 * and unavailable reasons — passes `redactLogText` on its way in; caller-composed
 * text (environment, attachment names) carries nothing to redact. Redaction is best
 * effort, which is why the flow shows the bundle before it goes anywhere; only the
 * issue URL opens in a browser unreviewed.
 */

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

/**
 * End-user reports go to the PUBLIC repo: users cannot see the private
 * `obsidian-copilot-preview` repo, so routing them there would lose the report.
 */
const REPORT_REPO = "logancyang/obsidian-copilot";
const SCREENSHOT_NAME = "screenshot.png";
const REPORT_NOTE_NAME = "report.md";
const SCREENSHOT_SOURCE_ID = "screenshot";
const REPORT_NOTE_SOURCE_ID = "report";

/**
 * Both destinations — the report endpoint and GitHub's issue-attachment limit on
 * the manual path — reject anything above 25 MB; STOREd, so the budget maps 1:1 onto the zip.
 */
const MAX_BUNDLE_BYTES = 24 * 1024 * 1024;
/** The shared 25 MB ceiling, checked on the packed zip: its headers sit on top of the budget. */
const GITHUB_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;

/** Longest description kept: the textarea is unbounded, and the head is the part worth keeping. */
const MAX_NOTE_BYTES = 64 * 1024;
/** Headroom for `report.md`, which must always fit: the capped note plus the fixed sections. */
const REPORT_NOTE_RESERVE_BYTES = MAX_NOTE_BYTES + 8 * 1024;
/** Cap on one failure reason: filesystem errors are unbounded and eat report.md's headroom. */
const MAX_REASON_BYTES = 1024;
/**
 * Largest log a report reads, and it reads it whole: redaction equals redacting
 * the whole file only when the whole file is what it sees, so a larger log is
 * left out. The activity log rotates at 50 MiB, so this admits every log the
 * plugin writes and bounds memory only for third-party logs.
 */
export const MAX_REDACTABLE_LOG_BYTES = 64 * 1024 * 1024;

export interface ReportEnvInfo {
  pluginVersion: string;
  platform: string;
  obsidianVersion?: string;
  activeBackend: string;
}

/**
 * One log the user opted into. `path` (read from disk) and `text` (in memory)
 * are alternatives; with neither set, the bundle lists it as not included with `unavailableReason`.
 */
export interface ReportLogRequest {
  /** Stable id echoed back on the matching result. */
  id: string;
  /** Entry name inside the zip; two sources sharing a name pack as one entry. */
  name: string;
  path?: string;
  text?: string;
  /** Shown to the user when neither `path` nor `text` is available. */
  unavailableReason?: string;
}

export interface ReportInput {
  /** Unique id of this preparation; the zip is named after it. */
  bundleId: string;
  /** Free-text description the user typed in the modal. */
  note: string;
  env: ReportEnvInfo;
  /**
   * PNG bytes of the captured view. Leave it undefined when the screenshot
   * source was never offered or selected, so the bundle lists no screenshot at
   * all; pass null when a capture was requested but produced nothing, so the
   * bundle lists the screenshot as not included.
   */
  screenshotPng?: Uint8Array | null;
  /** Logs the user opted into, in the order they should appear in the bundle. */
  logs: ReportLogRequest[];
}

/**
 * One line of the manifest the review page shows and `report.md` lists. The
 * assembler settles this list before packing; nothing downstream re-derives it
 * from the user's selection.
 */
export interface AttachmentResult {
  /** Matches the requesting source's id. */
  id: string;
  /** Entry name inside the zip. */
  name: string;
  /** Bytes packed for this source; 0 when `included` is false. */
  bytes: number;
  included: boolean;
  /** Why a source is absent ("empty", "failed: …"), or what was done to fit it. */
  note?: string;
}

/**
 * Title and body of the GitHub issue prefill, before truncation. The body is the
 * packed `report.md` itself, so the issue and the bundle can never drift apart.
 */
export interface ReportIssueDraft {
  title: string;
  body: string;
}

export interface ReportBundle {
  zip: Uint8Array;
  /** `copilot-report-<bundleId>.zip`, for whoever writes or uploads the zip. */
  zipName: string;
  /** Packed bytes and the idempotency key minted with them: a retry re-sends this exact pair. */
  uploadAttempt: ReportUploadAttempt;
  issueDraft: ReportIssueDraft;
  /** One entry per source in bundle order, `report.md` first. */
  attachments: AttachmentResult[];
}

export interface ReportRuntime {
  /**
   * Complete file snapshot decoded to text, or empty text with its size when
   * it exceeds `maxBytes`. Zero total bytes means an empty file. Rejects when
   * the file cannot be read.
   */
  readLog: (path: string, maxBytes: number) => Promise<{ text: string; totalBytes: number }>;
}

/** What one source contributes: its manifest line, and the bytes to pack if any. */
interface SourceEntry {
  result: AttachmentResult;
  bytes?: Uint8Array;
}

/**
 * Build the whole report in memory: settle every source against the budget,
 * write `report.md` from the settled list, pack one zip and mint its upload
 * attempt. The budget is spent in a fixed order — `report.md`'s reserve, the
 * screenshot, then the logs in request order — so what a source gets depends
 * only on what precedes it. A source that does not fit is listed as not
 * included; only `report.md` outgrowing its reserve or the zip outgrowing the
 * shared limit throws, since neither leaves anything sendable.
 *
 * @param input What the user asked to send.
 * @param runtime Injected so assembly can be exercised without a filesystem.
 */
export async function buildReportBundle(
  input: ReportInput,
  runtime: ReportRuntime = getNodeReportRuntime()
): Promise<ReportBundle> {
  let remainingBytes = MAX_BUNDLE_BYTES - REPORT_NOTE_RESERVE_BYTES;
  // Null-prototype: the keys are source basenames, and on a plain object one
  // named `__proto__` would land somewhere other than the map that gets packed.
  const entries: Record<string, Uint8Array> = Object.create(null);
  const attachments: AttachmentResult[] = [];
  const admit = ({ result, bytes }: SourceEntry) => {
    attachments.push(result);
    if (!bytes) return;
    entries[result.name] = bytes;
    remainingBytes -= bytes.length;
  };

  // An unselected screenshot has no line to show: listing it as "not captured"
  // would tell the user a capture they never asked for went wrong
  // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
  if (input.screenshotPng !== undefined)
    admit(screenshotEntry(input.screenshotPng, remainingBytes));
  for (const log of input.logs) admit(await logEntry(log, remainingBytes, runtime));

  const markdown = buildReportMarkdown(input, attachments);
  const noteBytes = encodeText(markdown);
  // The sources were budgeted with this reserve set aside, so overshooting it
  // can push the bundle over the limit; `logs` is unbounded, so enough failures
  // add up (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
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

  // STOREd (`level: 0`) so the packed size stays equal to the sum the budget
  // already measured; nothing compression could win is worth a worker's lifecycle.
  const zip = zipSync(entries, { level: 0 });
  if (zip.length > GITHUB_ATTACHMENT_LIMIT_BYTES) {
    throw new Error(describeOversizedZip(zip.length, attachments));
  }

  return {
    zip,
    zipName: `copilot-report-${input.bundleId}.zip`,
    // Bytes and idempotency key are minted together, here and nowhere else: the
    // key names exactly these bytes to the server, so a retry re-sends the pair.
    uploadAttempt: { body: exactArrayBuffer(zip), idempotencyKey: uuidv4() },
    issueDraft: { title: issueTitle(input.note), body: markdown },
    attachments,
  };
}

function screenshotEntry(png: Uint8Array | null, remainingBytes: number): SourceEntry {
  const base = { id: SCREENSHOT_SOURCE_ID, name: SCREENSHOT_NAME } as const;
  if (!png || png.length === 0)
    return { result: { ...base, bytes: 0, included: false, note: "no screenshot was captured" } };
  // A screenshot cannot be trimmed the way a log can, so one that does not fit
  // is left out rather than failing the bundle: the logs it would displace are
  // usually the more diagnostic half
  // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
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
  // The banner's room comes out of the tail that carries one, so a log that fits
  // whole keeps every byte; a tail is cut at a byte offset, so its first line is dropped.
  const room = remainingBytes - TRUNCATION_NOTE_RESERVE_BYTES;
  const cutToFit = (text: string) => tailOfText(text, room).text.replace(/^[^\n]*\n?/, "");

  // Caller-supplied text, and this is its last stop before the zip: same treatment as a failure.
  if (log.path == null && log.text == null)
    return leftOut(describeReason(log.unavailableReason ?? "not found"));

  try {
    const raw =
      log.path != null
        ? await runtime.readLog(log.path, MAX_REDACTABLE_LOG_BYTES)
        : tailOfText(log.text ?? "", MAX_REDACTABLE_LOG_BYTES);
    if (raw.totalBytes === 0) return leftOut("empty");
    // A log read in part cannot be redacted: the part left out may hold the key
    // that names a value inside it (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    if (raw.totalBytes > MAX_REDACTABLE_LOG_BYTES)
      return tooBig(raw.totalBytes, `${formatBytes(MAX_REDACTABLE_LOG_BYTES)} a report can redact`);
    // Read whole, redacted whole, then cut: the only order equal to full-text
    // redaction. A key can sit any distance ahead of its value — the previous
    // line, above a lone separator, or heading a run of bare `secret=` lines that
    // pair up from wherever the text starts — so a read opening after it packs the
    // value plain or shifts the pairing so a later one does. Every pair was seen
    // together here, so cutting redacted text exposes nothing
    // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    const redacted = redactLogText(raw.text);
    const redactedBytes = byteLength(redacted); // rewrites can lengthen it
    const truncated = redactedBytes > remainingBytes;
    // The floor rejects a useless *tail*, not a small log: one that fits whole is
    // often the most diagnostic attachment. Its note names the redacted size, the
    // one that did not fit (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    if (truncated && remainingBytes < MIN_LOG_TAIL_BYTES)
      return tooBig(redactedBytes, `${formatBytes(remainingBytes)} left`);
    // No later measure: `whole` fits `room`, the banner its reserve: under budget by construction.
    const whole = truncated ? cutToFit(redacted) : redacted;
    // Nothing under the dropped fragment: a banner over an empty entry helps nobody.
    if (truncated && whole.trim() === "") return emptyTail();
    const bytes = encodeText(truncated ? withTruncationNote(whole, raw.totalBytes) : whole);

    // Names only the original size: the packed `bytes` can exceed it, banner and rewrites in.
    const note = truncated
      ? `truncated to the newest entries of ${formatBytes(raw.totalBytes)}`
      : undefined;
    return {
      result: { id: log.id, name: log.name, bytes: bytes.length, included: true, note },
      bytes,
    };
  } catch (err) {
    // A fresh install has the activity log enabled before anything is written to
    // it, so the first report meets a file that does not exist yet: a missing
    // log, not a read failure (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    if ((err as { code?: unknown } | null)?.code === "ENOENT") return leftOut("not found");
    return leftOut(`failed: ${describeReason(err2String(err))}`);
  }
}

/**
 * Issue title cut from the description's first line. Redacted before it is cut: a
 * cut through a secret can hide it from the pattern that would have caught it
 * whole. No "[Agent Mode]" prefix on either title: the flow is reachable from
 * the general settings, so the prefix would mislabel plain-chat reports.
 */
function issueTitle(note: string): string {
  const firstLine = redactLogText(note)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ? firstLine.slice(0, 80).trim() : "Copilot issue report";
}

/**
 * Markdown report body, mirrored both into `report.md` and the issue prefill.
 *
 * @param input The description and environment the user is reporting from.
 * @param attachments Every source in bundle order, left-out ones included, so
 *   the note says what is missing as well as what is there.
 */
export function buildReportMarkdown(input: ReportInput, attachments: AttachmentResult[]): string {
  // `report.md` never lists itself: a reader holding it already knows it is there.
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
    // Says where the files are, not what to do with them: the flow tells the
    // user how the zip reaches the issue.
    "> These files are bundled in the zip Copilot prepared for this report.",
    "",
  ].join("\n");
}

function describeAttachment({ name, included, note }: AttachmentResult): string {
  if (included) return note ? `- ${name} — ${note}` : `- ${name}`;
  return `- ${name} — not included${note ? `: ${note}` : ""}`;
}

/**
 * `shell.openExternal` silently rejects URLs over ~2081 chars on Windows while the
 * caller still reports success; what the body cannot carry is still in `report.md`.
 */
const MAX_ISSUE_URL_LENGTH = 1800;
/** Appended when the issue body has to be cut; the zip holds the full `report.md` either way. */
const BODY_TRUNCATION_NOTE =
  "\n\n_…report truncated. The full report is `report.md` inside the report zip._";

/**
 * Assemble a GitHub "new issue" URL, shrinking the body (never the prefix) until
 * it fits under `MAX_ISSUE_URL_LENGTH`.
 *
 * @param prefix Goes before `body` and survives truncation intact, for what
 *   the reader must see even when the note is cut short.
 */
function buildIssueUrl(title: string, prefix: string, body: string): string {
  const base = `https://github.com/${REPORT_REPO}/issues/new?`;
  const build = (b: string) =>
    base + new URLSearchParams({ title, body: prefix + b, labels: "bug" }).toString();

  if (build(body).length <= MAX_ISSUE_URL_LENGTH) return build(body);

  // The prefix (and, once truncated, the note) are the floor: if even an
  // empty body doesn't fit under them, no amount of shrinking `body` helps.
  if (build(BODY_TRUNCATION_NOTE).length > MAX_ISSUE_URL_LENGTH) {
    throw new Error(
      `The GitHub issue link came out longer than the ${MAX_ISSUE_URL_LENGTH}-character ` +
        "limit on its own — nothing left to truncate."
    );
  }

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

/**
 * Prefilled "new issue" URL with no reference to the bundle, for when the user
 * attaches the zip by hand.
 *
 * @param draft The title and body cut from the user's own description.
 */
export function buildManualIssueUrl(draft: ReportIssueDraft): string {
  return buildIssueUrl(draft.title, "", draft.body);
}

/**
 * Prefilled "new issue" URL whose body opens with the uploaded report's id, in a
 * prefix truncation can never reach. An id and not a link: the issue is public,
 * and a URL that fetched the bundle would hand the user's logs to every reader.
 *
 * @param draft The title and body cut from the user's own description.
 * @param reportId Identifies the stored bundle; the one thing the body must
 *   keep however far it is cut.
 */
export function buildLinkedReportIssueUrl(draft: ReportIssueDraft, reportId: string): string {
  return buildIssueUrl(draft.title, `**Copilot report ID:** \`${reportId}\`\n\n`, draft.body);
}

/**
 * The `ArrayBuffer` holding exactly `bytes`: the slice branch guards against a
 * view into a larger pooled buffer, whose siblings' bytes must never be uploaded.
 */
function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
    return bytes.buffer as ArrayBuffer;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Explain an over-limit zip in terms the user can act on: name the heaviest
 * source they may drop, since `report.md` is mandatory and the total alone leaves them guessing.
 */
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

/**
 * The user's description as it goes into the report, redacted and then capped:
 * redaction runs first because rewriting text changes its length, and the cut
 * is announced so no reader mistakes the kept head for the whole thing.
 */
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

/**
 * A reason bound for `report.md`: a filesystem error is unbounded and quotes the user's own path.
 */
function describeReason(reason: string): string {
  const oneLine = redactLogText(reason).replace(/\s+/g, " ").trim();
  const { text, totalBytes } = headOfText(oneLine, MAX_REASON_BYTES);
  return totalBytes > MAX_REASON_BYTES ? `${text}…` : text;
}

/**
 * The runtime `buildReportBundle` uses by default: bounded logs are read from
 * the desktop filesystem. Exported so a caller can sample a log the same way before building.
 */
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
