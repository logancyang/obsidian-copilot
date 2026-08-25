/**
 * Assembles a self-contained bug-report bundle on disk (note, screenshot, and
 * whichever logs the user opted into), zips it into a single file, and builds
 * the prefilled GitHub issue URLs it can be opened with — one with no report
 * reference, for when the user attaches the zip by hand, and one built later
 * from an uploaded report's id (`buildLinkedReportIssueUrl`) once it exists.
 *
 * Pure of singletons: the Node runtime is injectable so the assembler is
 * unit-testable without touching the real filesystem.
 *
 * Two invariants the report UI depends on:
 *
 * - **Every requested source reports its own outcome.** A source that was
 *   selected but could not be read is reported as `skipped`/`failed` with a
 *   reason, never silently dropped, so the UI can show what actually landed in
 *   the bundle instead of echoing the user's checkboxes back at them.
 * - **`report.md` is mandatory.** If it cannot be written the whole assembly
 *   throws, because a bundle without it is not worth attaching.
 * - **Every free-text input is redacted on its way in.** The log bodies, the
 *   user's own description, the issue title cut from it, and the failure
 *   reasons of sources that could not be read all pass `redactLogText` before
 *   they reach `report.md` or the issue URL. The environment block and the
 *   attachment names are composed here rather than taken from the user, so they
 *   carry nothing to redact. Redaction is best effort — it matches shapes it
 *   knows, so an unfamiliar credential format still reaches the other side —
 *   which is why the flow hands the user the bundle to review. The issue URL is
 *   the one surface that review cannot cover: it goes to a browser before the
 *   user has seen anything, so a home path or a pasted key in the description
 *   is public the moment the page opens.
 *
 * A failed assembly leaves nothing behind: the staging folder holds plaintext
 * prompts and note contents, so it is removed rather than orphaned when the
 * bundle is never handed to the user.
 */

import { err2String } from "@/errorFormat";
import { logWarn } from "@/logger";
import { formatBytes } from "@/utils/formatBytes";
import { isMissingFileError } from "@/utils/isMissingFileError";
import { type ReportUploadAttempt } from "@/utils/reportUpload";
import { zipSync } from "fflate";
import { v4 as uuidv4 } from "uuid";
import { redactLogText } from "./redactLog";
import { requireNodeModule } from "./desktopRuntime";

/**
 * End-user reports go to the PUBLIC repo. The private `obsidian-copilot-preview`
 * repo is for internal triage/BRAT only and must never receive user issues
 * (users can't see it, and routing them there would lose the report).
 */
const REPORT_REPO = "logancyang/obsidian-copilot";
const BUNDLE_DIR_PREFIX = "copilot-report-";
const SCREENSHOT_NAME = "screenshot.png";
const REPORT_NOTE_NAME = "report.md";

/** Stable id for the screenshot outcome, paired with `REPORT_NOTE_SOURCE_ID`. */
const SCREENSHOT_SOURCE_ID = "screenshot";
const REPORT_NOTE_SOURCE_ID = "report";

/**
 * Both places a zip can go reject anything above 25 MB — the report endpoint,
 * and GitHub's issue-attachment limit on the manual fallback path. Budget the
 * bundle below that so the zip is always sendable; the activity log alone can
 * reach 50 MB before it rotates, so something has to give and it is the oldest
 * log lines. The zip is STOREd (uncompressed), so this budget maps 1:1 onto
 * the packed size — no compression absorbs an overrun.
 */
const MAX_BUNDLE_BYTES = 24 * 1024 * 1024;

/**
 * Hard ceiling on what the packer will read into the renderer, separate from
 * `MAX_BUNDLE_BYTES` and much looser. The budget shapes a report; this only
 * refuses input that cannot be held in memory at once — and only the staging
 * folder, which the user may edit freely, can reach it.
 */
const MAX_PACKABLE_INPUT_BYTES = MAX_BUNDLE_BYTES * 4;
/**
 * The shared 25 MB ceiling (report endpoint and GitHub attachment alike),
 * checked against the packed zip. Kept separate from `MAX_BUNDLE_BYTES`: that
 * one is the budget sources are trimmed against *before* redaction rewrites
 * and truncation banners change their size, so the finished artifact needs its
 * own measurement against the actual limit.
 */
const GITHUB_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;
/**
 * Longest user description kept in `report.md`. The textarea is unbounded and
 * users paste stack traces into it, so without a cap a single note could blow
 * the whole budget. The head is the part worth keeping — a pasted trace's origin
 * and a description's point are both at the top.
 */
const MAX_NOTE_BYTES = 64 * 1024;
/**
 * Headroom kept for `report.md`, which must always fit: the capped note plus the
 * fixed environment and attachment sections around it.
 */
const REPORT_NOTE_RESERVE_BYTES = MAX_NOTE_BYTES + 8 * 1024;
/** A tail smaller than this is too short to diagnose anything, so skip instead. */
const MIN_LOG_TAIL_BYTES = 64 * 1024;
/**
 * Longest failure reason kept for one attachment. A filesystem error message is
 * unbounded and the source list is a general parameter, so without a cap a
 * handful of long errors would eat the headroom `report.md` is promised.
 */
const MAX_REASON_BYTES = 1024;
/**
 * Timestamp stamped into every zip entry; see the pack site for why it is fixed.
 *
 * Built from local calendar fields rather than an instant, because that is how
 * it is read back: a DOS timestamp has no zone, so fflate encodes the `Date`'s
 * local year, month and day and refuses anything outside 1980-2099. The same
 * instant is 1979 west of UTC — `1980-01-01T00:00:00Z` is December 31st in
 * every negative offset — so an instant here fails the pack outright for those
 * users. Local fields also keep the bytes identical wherever the pack runs,
 * which the rebuild comparison depends on.
 */
const ZIP_EPOCH = new Date(1980, 0, 1);

export interface ReportEnvInfo {
  pluginVersion: string;
  platform: string;
  obsidianVersion?: string;
  activeBackend: string;
}

/**
 * One log the user opted into. `path` (tailed from disk) and `text` (already in
 * memory) are alternatives; when neither is set the source could not be located
 * and the bundle records a skip carrying `unavailableReason`.
 */
export interface ReportLogRequest {
  /** Stable id echoed back on the matching outcome. */
  id: string;
  /** Basename to write inside the bundle folder. */
  name: string;
  path?: string;
  text?: string;
  /** Shown to the user when neither `path` nor `text` is available. */
  unavailableReason?: string;
}

export interface ReportInput {
  /** Free-text description the user typed in the modal. */
  note: string;
  env: ReportEnvInfo;
  /**
   * Whether the user asked for a screenshot. Kept separate from the bytes so a
   * failed capture can be reported as a skip rather than vanishing.
   */
  screenshotRequested: boolean;
  /** PNG bytes of the captured view, or null when capture produced nothing. */
  screenshotPng: Uint8Array | null;
  /** Logs the user opted into, in the order they should appear in the bundle. */
  logs: ReportLogRequest[];
  /** Root dir bundles are written under (one subfolder per report). */
  reportsRootDir: string;
  /**
   * Unique, filesystem-safe bundle id (e.g. `20260615-101500-a1b2`). Must be
   * unique per attempt: two reports prepared in the same second, or a retry
   * after a failure, must not land in the same folder and mix files.
   */
  bundleId: string;
}

export type AttachmentStatus = "included" | "skipped" | "failed";

export interface AttachmentOutcome {
  /** Matches the requesting source's id. */
  id: string;
  /** Basename inside the bundle folder. */
  name: string;
  /**
   * Where the file was staged, or null when the source was never written at
   * all. Survives a demotion to `skipped`/`failed` on purpose — it is the
   * location a later rebuild looks at again, not a claim that the file is
   * there right now. Clearing it on demotion makes that first failure
   * permanent.
   */
  absPath: string | null;
  /** Bytes actually written; 0 unless `status` is `included`. */
  bytes: number;
  status: AttachmentStatus;
  /** Why the source was skipped or failed, shown verbatim in the report UI. */
  reason?: string;
  /** True when only the newest slice of an oversized source was kept. */
  truncated?: boolean;
}

/**
 * Title and body of the GitHub issue prefill, before any report-id prefix or
 * truncation is applied. Both URLs — the manual one and the id-carrying one
 * built once upload succeeds — come from this, so they can never drift out of
 * sync with each other or with the `report.md` they were read from.
 */
export interface ReportIssueDraft {
  title: string;
  body: string;
}

export interface AssembledReport {
  /** Absolute path to the created bundle folder, kept for the user to review. */
  folderPath: string;
  /** One entry per requested source, in bundle order, `report.md` first. */
  attachments: AttachmentOutcome[];
}

export interface ReportRuntime {
  join: (...parts: string[]) => string;
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  readBytes: (path: string) => Promise<Uint8Array>;
  /**
   * Size of a file on disk, without reading it. Lets the packer weigh what it is
   * about to pull into memory while the answer is still cheap.
   */
  sizeOf: (path: string) => Promise<number>;
  /**
   * Read at most `maxBytes` from the END of a file — the newest activity is the
   * useful part — and report the file's full size so the caller knows whether
   * what it got is complete. A reported size of 0 means nothing was read,
   * whatever the file measured beforehand.
   */
  readTail: (path: string, maxBytes: number) => Promise<{ text: string; totalBytes: number }>;
  /**
   * Delete a file or a folder tree. Must resolve when the path is already gone:
   * every caller here is cleaning up after a failure and has nothing to gain
   * from a second error on top of the first.
   */
  remove: (path: string) => Promise<void>;
}

/**
 * Write the report bundle to `<reportsRootDir>/copilot-report-<bundleId>/` and
 * report per-source outcomes. Throws when the folder or `report.md` cannot be
 * written (the caller should surface a retry); an individual log or screenshot
 * failing only downgrades that one attachment. A throw tries to take the folder
 * with it — a bundle nobody received must not leave the user's prompts on disk —
 * but a deletion can fail in turn, so a caller that can name a leftover path to
 * the user should sweep the folder again rather than trust this one.
 */
export async function assembleReportBundle(
  input: ReportInput,
  runtime: ReportRuntime = getNodeReportRuntime()
): Promise<AssembledReport> {
  const folderPath = runtime.join(input.reportsRootDir, BUNDLE_DIR_PREFIX + input.bundleId);
  await runtime.mkdir(folderPath, { recursive: true });
  try {
    return await writeBundle(input, folderPath, runtime);
  } catch (err) {
    await discardQuietly(folderPath, runtime);
    throw err;
  }
}

async function writeBundle(
  input: ReportInput,
  folderPath: string,
  runtime: ReportRuntime
): Promise<AssembledReport> {
  let remainingBytes = MAX_BUNDLE_BYTES - REPORT_NOTE_RESERVE_BYTES;
  const attachments: AttachmentOutcome[] = [];

  if (input.screenshotRequested) {
    const outcome = await writeScreenshot(input.screenshotPng, folderPath, remainingBytes, runtime);
    attachments.push(outcome);
    remainingBytes -= outcome.bytes;
  }

  for (const log of input.logs) {
    const outcome = await writeLog(log, folderPath, remainingBytes, runtime);
    attachments.push(outcome);
    remainingBytes -= outcome.bytes;
  }

  const noteMarkdown = buildReportMarkdown(input, attachments);
  const notePath = runtime.join(folderPath, REPORT_NOTE_NAME);
  const noteBytes = encodeText(noteMarkdown);
  // The sources above were trimmed against a budget that set this many bytes
  // aside for `report.md`, so overshooting here means the bundle can exceed the
  // limit it was planned under. The note and each failure reason are capped, but
  // `logs` is an unbounded parameter — enough failing sources still adds up.
  if (noteBytes.length > REPORT_NOTE_RESERVE_BYTES) {
    throw new Error(
      `The report summary came out ${formatBytes(noteBytes.length)}, over the ` +
        `${formatBytes(REPORT_NOTE_RESERVE_BYTES)} set aside for it. Include fewer sources.`
    );
  }
  await runtime.writeFile(notePath, noteBytes);
  attachments.unshift({
    id: REPORT_NOTE_SOURCE_ID,
    name: REPORT_NOTE_NAME,
    absPath: notePath,
    bytes: noteBytes.length,
    status: "included",
  });

  // No issue draft here: it is read back from the packed `report.md` in
  // `zipReportBundle`, which is the only copy the user can still edit and
  // therefore the only one an issue may be built from.
  return { folderPath, attachments };
}

/**
 * Pack the bundle's written files into `<folderPath>.zip`. A single file is not
 * a preference: one upload either succeeds or fails as a whole instead of
 * partially landing, and a manual attach still only has to drag one thing.
 *
 * Safe to call again on the same bundle after the user edits the staging folder,
 * which is the only way an edit there can reach the zip. Everything returned
 * describes the zip that now exists rather than the one it replaced: the
 * `attachments` carry the sizes just read from disk, and `issueDraft` /
 * `manualIssueUrl` are rebuilt from the `report.md` that was actually packed.
 * That last part is what stops a repack from publishing text the user removed —
 * they edit the staging folder precisely to take something out, and the issue
 * body must not still be quoting it.
 *
 * A staged attachment that has gone missing or become unreadable does not stop
 * the rebuild: it comes back demoted in the returned outcomes, so the rest of
 * the report still packs. `report.md` is the exception — without it there is no
 * issue to file, and this throws.
 *
 * Throws when the zip cannot be produced, including when the packed result
 * exceeds GitHub's attachment limit — a bundle we cannot vouch for must not be
 * presented as ready to attach. Nothing partial is left at `zipPath` on the way
 * out.
 */
export async function zipReportBundle(
  report: AssembledReport,
  runtime: ReportRuntime = getNodeReportRuntime()
): Promise<{
  zipPath: string;
  /**
   * The packed bytes and the idempotency key minted with them, as one pair:
   * retrying an upload re-sends this exact attempt, and only repacking mints a
   * new one. The zip's size is `uploadAttempt.body.byteLength` — kept off this
   * shape as a separate field so there is exactly one source of truth for it.
   */
  uploadAttempt: ReportUploadAttempt;
  attachments: AttachmentOutcome[];
  issueDraft: ReportIssueDraft;
  manualIssueUrl: string;
}> {
  // Candidacy is `absPath`, not `status`: anything the assembler staged gets
  // looked at again, however the last rebuild judged it. A source that was
  // never staged (a log turned off, a capture that produced nothing) has no
  // path and so keeps its own reason rather than being retried and relabelled
  // as a removal.
  const packable = report.attachments.filter(
    (a): a is AttachmentOutcome & { absPath: string } => a.absPath !== null
  );

  // Weigh the staging folder before reading any of it. Not the report budget —
  // `GITHUB_ATTACHMENT_LIMIT_BYTES` below still owns "this report is a little too
  // big", and says which source to drop. This is the separate question of whether
  // the input is safe to hold at all: the UI invites the user to edit the staging
  // folder and repack it, so a file there can be arbitrarily larger than what the
  // assembler wrote, and by the time the compressed size is known the whole thing
  // has already been read into the renderer and zipped synchronously. Past this
  // ceiling that pause stops being a pause.
  // A staged file that has gone missing is a removal, not a failure
  // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202). The
  // review step invites exactly this edit ("Edited the files? Rebuild zip
  // repacks them") right after warning that the screenshot is not redacted, so
  // deleting it is the obvious way to act on that warning. Throwing would
  // strand the user with nothing to send, since the rebuild deletes the old zip
  // first.
  // `report.md` is the one file this cannot rescue — dropping it leaves no
  // issue to file, and `draftFromPackedNote` says so in as many words.
  const asRemoved = (a: AttachmentOutcome): AttachmentOutcome => ({
    ...a,
    bytes: 0,
    status: "skipped",
    reason: "Removed from the report folder before the rebuild.",
  });
  // Only an absent file is the user's own edit
  // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202). A file
  // that is still there but cannot be read — locked by another program,
  // permissions changed underneath us — is a failure, and reporting it as
  // "Removed" would blame the user for something they did not do while the
  // report goes out a source short. Same split the assembler already makes, so
  // the two passes describe one kind of trouble the same way.
  const afterReadError = (a: AttachmentOutcome, err: unknown): AttachmentOutcome =>
    isMissingFileError(err)
      ? asRemoved(a)
      : { ...a, bytes: 0, status: "failed", reason: describeFailure(err) };

  const unreadable = new Map<string, unknown>();

  let stagedBytes = 0;
  for (const attachment of packable) {
    try {
      stagedBytes += await runtime.sizeOf(attachment.absPath);
    } catch (e) {
      unreadable.set(attachment.id, e);
    }
  }
  if (stagedBytes > MAX_PACKABLE_INPUT_BYTES) {
    throw new Error(
      `The report folder holds ${formatBytes(stagedBytes)} — too much to pack without ` +
        `freezing Obsidian. Remove or shorten something in it, then rebuild the zip.`
    );
  }

  const entries: Record<string, Uint8Array> = {};
  const attachments: AttachmentOutcome[] = [];
  let readBytes = 0;
  for (const attachment of report.attachments) {
    // Same candidate test as the weigh pass above, so the two halves of the
    // packer never disagree about what is worth trying.
    if (!attachment.absPath) {
      attachments.push(attachment);
      continue;
    }
    if (unreadable.has(attachment.id)) {
      attachments.push(afterReadError(attachment, unreadable.get(attachment.id)));
      continue;
    }
    let data: Uint8Array;
    try {
      data = await runtime.readBytes(attachment.absPath);
    } catch (e) {
      // Went missing or became unreadable in the window between the weigh pass
      // and this one — same two outcomes, just reached later.
      attachments.push(afterReadError(attachment, e));
      continue;
    }
    // Re-checked against what was actually read: a file can grow between its
    // `sizeOf` and its `readBytes`, and the sum above would then be an
    // underestimate of what is now in memory.
    readBytes += data.length;
    if (readBytes > MAX_PACKABLE_INPUT_BYTES) {
      throw new Error(
        "The report folder grew while it was being packed, past what can be packed " +
          "without freezing Obsidian. Rebuild the zip."
      );
    }
    entries[attachment.name] = data;
    // A successful read restates the whole outcome rather than patching `bytes`
    // onto it: this attachment may be arriving from a previous rebuild's
    // demotion, and leaving that `status`/`reason` in place would pack the file
    // while still telling the user it was removed. `truncated` is read back off
    // the bytes for the same reason — the user is invited to edit this folder,
    // and a log they replaced with the whole thing must stop being described as
    // its own newest slice.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
    attachments.push({
      ...attachment,
      bytes: data.length,
      status: "included",
      reason: undefined,
      truncated: startsTruncated(data) || undefined,
    });
  }

  // Everything the issue is built from, settled before a byte is compressed:
  // this validates `report.md` and can throw, and doing that after `zipSync`
  // and `writeFile` would spend the whole synchronous pack on a bundle already
  // known to be unusable — and leave a new zip on disk while the UI says there
  // is nothing to upload.
  //
  // DESIGN NOTE — report.md attachment list may name a file the rebuilt zip omits
  // (https://github.com/Brevilabs/obsidian-copilot-private/issues/227). When the user deletes an attachment
  // from the staging folder and clicks Rebuild, the above loop demotes it to
  // `skipped` in the returned manifest, but `entries[report.md]` is still the
  // original markdown listing that file. So the public issue can say an
  // attachment was included when it was omitted. Severity: what leaks is the
  // filename in a list, not the file content — if the user deleted
  // screenshot.png to keep its content private, that goal IS achieved.
  // The obvious fix (regenerate report.md from the final manifest)
  // has a real cost: the flow explicitly invites the user to edit the staging
  // folder ("Edited the files? Rebuild zip repacks them"), and report.md is one
  // of the files they may have edited — including to redact their own prose.
  // Silently regenerating it would discard the user's sanitization, which is
  // strictly worse than a stale filename. This is the edit-the-folder contract's
  // inherent tradeoff: you can promise "I use what you edited" (list can lag) or
  // "the list is always accurate" (edits get clobbered), not both. Shipping with
  // the first promise. Follow-up can add UI that detects the discrepancy and lets
  // the user choose (regenerate vs keep edits), or drop the attachment list from
  // report.md entirely (the zip is the source of truth anyway).
  // If a future review flags this, point them at this note.
  const issueDraft = draftFromPackedNote(entries[REPORT_NOTE_NAME]);
  const manualIssueUrl = buildIssueUrl(
    issueDraft.title,
    "",
    issueDraft.body,
    MANUAL_BODY_TRUNCATION_NOTE
  );

  const zipPath = `${report.folderPath}.zip`;
  // DESIGN NOTE — deliberately the synchronous `zipSync`, not fflate's async
  // `zip()`. fflate does manage its own worker lifecycle, so that is not the
  // objection; the objection is how it gets one. In the browser build it spawns
  // `new Worker(URL.createObjectURL(new Blob([...])))`, and this repo has never
  // started a worker at all — `new Worker` appears nowhere — so whether a blob
  // worker survives Obsidian's renderer CSP is unknown, with no precedent here
  // to reason from. With STORE (below) the sync pack is a bounded memory copy,
  // not a compression pass, so there is no responsiveness win to buy either.
  //
  // `level: 0` (STORE) is the report endpoint's contract, not a preference: it
  // rejects any entry that is compressed. The size cost is bounded by
  // `MAX_BUNDLE_BYTES`, which now maps 1:1 onto the packed size.
  // A fixed timestamp, so the same folder packs to the same bytes every time.
  // fflate stamps `Date.now()` into each entry's header otherwise, which makes
  // two packs of identical content differ in four bytes — enough to defeat the
  // "did anything actually change?" comparison a rebuild depends on to decide
  // whether the upload attempt it already has is still the right one. Neither
  // the report endpoint nor anything here reads the stamps back — the bundle
  // travels as one upload and its own `report.md` carries the timestamp that
  // matters — though an archive tool will show them to a user who extracts the
  // zip by hand. The epoch itself is arbitrary beyond having to sit in the DOS
  // range fflate accepts (1980-2099).
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
  const zipped = zipSync(entries, { level: 0, mtime: ZIP_EPOCH });
  // Last line of defence, separate from the assembler's budget: redaction can
  // grow text (a short token becomes `<secret>`) and truncation adds a banner,
  // so the packed size is not fully predictable when sources were budgeted.
  // Better a clear failure than handing the user a zip GitHub will reject.
  if (zipped.length > GITHUB_ATTACHMENT_LIMIT_BYTES) {
    throw new Error(describeOversizedZip(zipped.length, attachments));
  }
  try {
    await runtime.writeFile(zipPath, zipped);
  } catch (err) {
    // A half-written zip is worse than none: nothing uploads it, because the
    // bytes that upload are the ones held in memory here, but it sits in the
    // temp folder holding whatever the bundle holds.
    await discardQuietly(zipPath, runtime);
    throw err;
  }
  // Bytes and idempotency key are minted together, here and nowhere else: the
  // key names exactly these bytes to the server, so a retry re-sends this pair
  // and a rebuild lands back here to mint a fresh one.
  const uploadAttempt: ReportUploadAttempt = {
    body: exactArrayBuffer(zipped),
    idempotencyKey: uuidv4(),
  };
  return { zipPath, uploadAttempt, attachments, issueDraft, manualIssueUrl };
}

/**
 * The `ArrayBuffer` holding exactly `bytes` and nothing else. fflate allocates
 * its output exact-size today, so this is normally a free `.buffer` read; the
 * slice branch guards against a future allocator handing back a view into a
 * larger pooled buffer, whose siblings' bytes must never be uploaded.
 */
function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * The issue draft as the packed `report.md` now reads — both halves of it. The
 * title is re-cut from the note's first line rather than carried over: it is
 * the same text the body is, so a user who edits the staging folder to remove
 * something from the opening line would otherwise still see it published as the
 * issue's title.
 *
 * Redaction runs again here because the file passed through the user's editor
 * between assembly and this repack, so nothing it now holds has been through
 * `redactLogText`. Note this covers the issue text only — the bytes inside the
 * zip are whatever the user left there, which is why the report is theirs to
 * review before it goes anywhere.
 *
 * @param packedNote Bytes of the `report.md` that went into the zip.
 * @throws When the note is missing or has grown past the size a report summary
 *   is budgeted, since neither can produce an issue worth opening.
 */
function draftFromPackedNote(packedNote: Uint8Array | undefined): ReportIssueDraft {
  if (!packedNote) {
    // `report.md` is mandatory (see `writeBundle`), so reaching here means the
    // caller assembled an `AssembledReport` that never should have existed.
    throw new Error("The report bundle has no report.md, so there is nothing to file.");
  }
  if (packedNote.length > REPORT_NOTE_RESERVE_BYTES) {
    throw new Error(
      `report.md is ${formatBytes(packedNote.length)}, over the ` +
        `${formatBytes(REPORT_NOTE_RESERVE_BYTES)} a report summary is allowed. ` +
        "Shorten it in the folder, then rebuild the zip."
    );
  }
  const body = redactLogText(new TextDecoder().decode(packedNote));
  return { title: titleFromNoteBody(body), body };
}

/**
 * Stands in for the description in `report.md` when the user typed none. Named
 * rather than inlined because `titleFromNoteBody` has to recognise it: a title
 * reading "_No description provided._" is worse than the generic one it falls
 * back to.
 */
const NO_DESCRIPTION_PLACEHOLDER = "_No description provided._";

/**
 * Heading `report.md` opens its description with. Shared with
 * `titleFromNoteBody`, which reads that section back — a second copy of this
 * string would silently stop the title tracking the note the day either moved.
 */
const NOTE_SECTION_HEADING = "## What went wrong";

/**
 * Title used when the note carries no description to cut one from. No
 * "[Agent Mode]" prefix on this or the cut title: the flow is reachable from
 * the general Debugging & support settings and can carry nothing but the
 * regular chat log, so the prefix would label plain-chat reports with a mode
 * they never used. Which surface a report concerns is already in its body's
 * environment block and attachment list.
 */
const GENERIC_ISSUE_TITLE = "Copilot issue report";

/**
 * Issue title cut from the description in a report body. Reads only the
 * `NOTE_SECTION_HEADING` section, and falls back to a generic title when it is
 * not there at all: the sections around it hold the environment block and the
 * attachment list, so guessing at the first prose line anywhere produces a
 * title like "- Plugin version: 1.2.3" — which describes nothing
 * and is what a user who deleted the heading would get.
 */
function titleFromNoteBody(body: string): string {
  const lines = body.split("\n").map((line) => line.trim());
  const start = lines.indexOf(NOTE_SECTION_HEADING);
  if (start === -1) return GENERIC_ISSUE_TITLE;
  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => line.startsWith("## "));
  const firstLine = (end === -1 ? section : section.slice(0, end)).find(
    (line) => line.length > 0 && line !== NO_DESCRIPTION_PLACEHOLDER
  );
  return firstLine ? firstLine.slice(0, 80).trim() : GENERIC_ISSUE_TITLE;
}

/**
 * Explain an over-limit zip in terms the user can act on. The total alone leaves
 * someone staring at a column of checkboxes with no way to tell which one is
 * responsible, so name the heaviest source they are allowed to drop —
 * `report.md` is mandatory, and pointing at it would be advice they cannot take.
 * The wording stops at "start here" rather than promising sufficiency: the sizes
 * are the uncompressed originals and more than one source can be oversized.
 */
function describeOversizedZip(zippedBytes: number, attachments: AttachmentOutcome[]): string {
  const opener =
    `The report zip came out ${formatBytes(zippedBytes)}, over GitHub's ` +
    `${formatBytes(GITHUB_ATTACHMENT_LIMIT_BYTES)} attachment limit. `;
  let largest: AttachmentOutcome | null = null;
  for (const attachment of attachments) {
    if (attachment.status !== "included" || attachment.id === REPORT_NOTE_SOURCE_ID) continue;
    if (!largest || attachment.bytes > largest.bytes) largest = attachment;
  }
  if (!largest) return `${opener}Include fewer sources and prepare it again.`;
  return (
    `${opener}The biggest one it can drop is ${largest.name} at ` +
    `${formatBytes(largest.bytes)} uncompressed — uncheck that first, then anything ` +
    "else you can spare, and prepare the report again."
  );
}

/** Markdown report body, mirrored both into `report.md` and the issue prefill. */
export function buildReportMarkdown(input: ReportInput, attachments: AttachmentOutcome[]): string {
  const note = describeNote(input.note);
  // `report.md` never lists itself: it is generated before it exists on disk,
  // and a reader holding it already knows it is there.
  const listed = attachments.filter((a) => a.id !== REPORT_NOTE_SOURCE_ID);
  return [
    NOTE_SECTION_HEADING,
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
    ...(listed.length > 0 ? listed.map(describeAttachment) : ["- (none captured)"]),
    "",
    // True on both delivery paths: uploaded (the zip is the stored bundle the
    // report ID identifies) and manual (the user attaches the same zip by hand).
    "> These files are bundled in the zip Copilot prepared for this report.",
    "",
  ].join("\n");
}

/**
 * `shell.openExternal` silently rejects URLs over ~2081 chars on Windows, which
 * would skip opening the issue page while the caller still reports success. Cap
 * the assembled URL well under that so the page always opens; what the body
 * cannot carry is still in `report.md` inside the zip.
 */
const MAX_ISSUE_URL_LENGTH = 1800;
/**
 * Only ever appended to the manual URL, which is opened when the upload failed
 * or was never attempted — so the zip is on the user's machine and unattached,
 * and telling them to paste the full report in is advice they can act on.
 */
const MANUAL_BODY_TRUNCATION_NOTE =
  "\n\n_…report truncated. The full report is `report.md` inside the zip Copilot " +
  "prepared — attach that zip here, or paste the report in._";
const LINKED_BODY_TRUNCATION_NOTE =
  "\n\n_…report truncated. The full report is `report.md` inside the uploaded bundle " +
  "the report ID above identifies._";

/**
 * Assemble a GitHub "new issue" URL from a title, body, and a prefix that
 * must never be cut. When the full body doesn't fit under
 * `MAX_ISSUE_URL_LENGTH`, the body (never the prefix) is shrunk until it
 * does, since URL-encoding expands characters non-linearly and estimating a
 * byte budget up front would under- or over-shoot.
 *
 * @param prefix Text that goes before `body` and is never truncated — this
 *   is what keeps an uploaded report's id from being the first thing a
 *   long note pushes out.
 * @param truncationNote Appended to `body` once it has been cut, so the
 *   reader knows the rest is missing and where to find it.
 */
function buildIssueUrl(
  title: string,
  prefix: string,
  body: string,
  truncationNote: string
): string {
  const base = `https://github.com/${REPORT_REPO}/issues/new?`;
  const build = (b: string) =>
    base + new URLSearchParams({ title, body: prefix + b, labels: "bug" }).toString();

  if (build(body).length <= MAX_ISSUE_URL_LENGTH) return build(body);

  // The prefix (and, once truncated, the note) are the floor: if even an
  // empty body doesn't fit under them, no amount of shrinking `body` helps.
  if (build(truncationNote).length > MAX_ISSUE_URL_LENGTH) {
    throw new Error(
      `The GitHub issue link came out longer than the ${MAX_ISSUE_URL_LENGTH}-character ` +
        "limit on its own — nothing left to truncate."
    );
  }

  // URL-encoding expands characters non-linearly, so shrink the kept slice
  // until the fully-encoded URL fits rather than estimating a byte budget.
  let keep = body.length;
  let truncated = build(body.slice(0, keep) + truncationNote);
  while (keep > 0 && truncated.length > MAX_ISSUE_URL_LENGTH) {
    keep = Math.max(0, keep - Math.ceil((truncated.length - MAX_ISSUE_URL_LENGTH) / 3));
    truncated = build(body.slice(0, keep) + truncationNote);
  }
  return truncated;
}

/**
 * Build a prefilled GitHub "new issue" URL whose body opens with the uploaded
 * report's id, placed in a prefix truncation can never reach.
 *
 * An id and not a link: the issue is public, and a URL that fetched the bundle
 * would hand the user's logs to everyone who reads the thread. Maintainers
 * resolve the id against the report store instead; nothing on the issue can.
 */
export function buildLinkedReportIssueUrl(draft: ReportIssueDraft, reportId: string): string {
  const prefix = `**Copilot report ID:** \`${reportId}\`\n\n`;
  return buildIssueUrl(draft.title, prefix, draft.body, LINKED_BODY_TRUNCATION_NOTE);
}

async function writeScreenshot(
  png: Uint8Array | null,
  folderPath: string,
  remainingBytes: number,
  runtime: ReportRuntime
): Promise<AttachmentOutcome> {
  const base = {
    id: SCREENSHOT_SOURCE_ID,
    name: SCREENSHOT_NAME,
    absPath: null,
    bytes: 0,
  } as const;
  if (!png || png.length === 0) {
    return { ...base, status: "skipped", reason: "No screenshot could be captured." };
  }
  // A screenshot cannot be trimmed the way a log can, so an oversized one is
  // fatal for the whole bundle rather than a silent omission: the user asked
  // for it, and a 24 MB PNG means something is wrong worth telling them about.
  if (png.length > remainingBytes) {
    throw new Error(
      `The screenshot alone is ${formatBytes(png.length)}, over the ` +
        `${formatBytes(MAX_BUNDLE_BYTES)} report limit.`
    );
  }
  const absPath = runtime.join(folderPath, SCREENSHOT_NAME);
  try {
    await runtime.writeFile(absPath, png);
    return { ...base, absPath, bytes: png.length, status: "included" };
  } catch (err) {
    return { ...base, status: "failed", reason: describeFailure(err) };
  }
}

async function writeLog(
  log: ReportLogRequest,
  folderPath: string,
  remainingBytes: number,
  runtime: ReportRuntime
): Promise<AttachmentOutcome> {
  const base = { id: log.id, name: log.name, absPath: null, bytes: 0 } as const;

  if (log.path == null && log.text == null) {
    return {
      ...base,
      status: "skipped",
      reason: log.unavailableReason ?? "This log was not available.",
    };
  }

  try {
    const raw =
      log.path != null
        ? await runtime.readTail(log.path, remainingBytes)
        : tailOfText(log.text ?? "", remainingBytes);

    if (raw.totalBytes === 0) {
      return { ...base, status: "skipped", reason: "This log is empty." };
    }

    const truncated = raw.totalBytes > remainingBytes;
    // The floor rejects a useless *tail*, not a small log. A complete 5 KB log
    // is often the most diagnostic attachment in the bundle, so it goes in
    // whenever it fits whole — only a slice too short to show context is worth
    // dropping, and that can only happen once the source outgrows the budget.
    if (truncated && remainingBytes < MIN_LOG_TAIL_BYTES) {
      return {
        ...base,
        status: "skipped",
        reason:
          `No room left in the ${formatBytes(MAX_BUNDLE_BYTES)} report budget — ` +
          "the earlier attachments used it up.",
      };
    }

    // A tail is cut at a byte offset, not at a line, so its first line is a
    // fragment whose beginning is on the other side of the cut. That matters
    // because redaction recognises a secret by what precedes it: cut between
    // `password=` and its value and the value arrives looking like ordinary
    // text, which is why the fragment is dropped rather than redacted. When the
    // tail holds no line break at all there is no complete entry underneath it
    // to keep, so the source is left out and says so
    // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    if (truncated && !raw.text.includes("\n")) {
      return {
        ...base,
        status: "skipped",
        reason: "The newest entry alone is larger than the room left in the report.",
      };
    }

    const body = truncated ? withTruncationNote(raw.text, raw.totalBytes) : raw.text;
    // Redact after trimming so the expensive pattern pass only runs over the
    // slice that is actually going into the bundle.
    const bytes = encodeText(redactLogText(body));

    const absPath = runtime.join(folderPath, log.name);
    await runtime.writeFile(absPath, bytes);
    return { ...base, absPath, bytes: bytes.length, status: "included", truncated };
  } catch (err) {
    return { ...base, status: "failed", reason: describeFailure(err) };
  }
}

/**
 * Remove a path that a failure has made worthless, without letting the cleanup's
 * own failure replace the error the caller is about to report.
 *
 * DESIGN NOTE — the failure is swallowed here rather than returned, so a path
 * that will not go is left unnamed at this layer. What that path holds is the
 * user's prompts and note contents, in a temp folder they have no other way to
 * find, which is worth naming; naming it is the caller's job. This module has
 * no user-visible surface — a return value it can only push upwards would have
 * to be threaded through every throw site to reach one — while the callers
 * already sweep and report: preparation clears the whole report directory in
 * its catch and names what survives, and a rebuild does the same for its zip.
 * A caller added later that does neither would reintroduce the silence.
 */
async function discardQuietly(path: string, runtime: ReportRuntime): Promise<void> {
  try {
    await runtime.remove(path);
  } catch {
    // The original failure is the one the user needs to see.
  }
}

/**
 * Byte-accurate tail of an in-memory log, mirroring what `readTail` does for a
 * file so both sources obey the same budget. Slicing by bytes rather than
 * characters matters: note contents are often non-ASCII, where one character
 * costs up to four bytes and a character-based cap would blow the budget.
 */
function tailOfText(text: string, maxBytes: number): { text: string; totalBytes: number } {
  const encoded = encodeText(text);
  if (encoded.length <= maxBytes) return { text, totalBytes: encoded.length };
  return {
    text: decodeTail(encoded.subarray(encoded.length - maxBytes)),
    totalBytes: encoded.length,
  };
}

/**
 * Decode bytes whose start is an arbitrary cut through a UTF-8 stream. Dropping
 * the leading continuation bytes costs at most three bytes of log and can only
 * shorten the slice; keeping them would decode the back half of a character into
 * a replacement glyph, and reaching backwards for the character's start would
 * push the slice past the budget its caller was promised.
 */
function decodeTail(bytes: Uint8Array): string {
  let start = 0;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return new TextDecoder().decode(bytes.subarray(start));
}

/**
 * Byte-accurate head of a string, mirroring `tailOfText` at the opposite end so
 * both obey the same budget. Cutting on a UTF-8 character boundary matters as
 * much here: a note is often non-ASCII, and a naive byte slice would leave half
 * a character that decodes to a replacement glyph.
 */
function headOfText(text: string, maxBytes: number): { text: string; totalBytes: number } {
  const encoded = encodeText(text);
  if (encoded.length <= maxBytes) return { text, totalBytes: encoded.length };
  // UTF-8 continuation bytes are 0b10xxxxxx; back the cut off until it lands on
  // a leading byte so only whole characters survive.
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
  return { text: new TextDecoder().decode(encoded.subarray(0, end)), totalBytes: encoded.length };
}

/**
 * Drop the leading partial line of a byte-sliced tail and label the gap, so a
 * reader is never misled into thinking a truncated log is the whole story.
 *
 * @param tail A truncated tail that contains at least one line break; the
 *   caller leaves the source out entirely when it does not, since there would
 *   be no complete entry left once the partial line went.
 */
/**
 * Opening of the banner the assembler writes into a shortened log. It is also
 * how a rebuild tells a tail from a whole file: the banner travels inside the
 * staged bytes, so it still describes them after the user has edited the folder,
 * where a flag carried alongside them would not.
 */
const TRUNCATION_MARKER = "… earlier entries omitted:";
const TRUNCATION_MARKER_BYTES = new TextEncoder().encode(TRUNCATION_MARKER);

/** Whether `data` opens with the banner {@link withTruncationNote} writes. */
function startsTruncated(data: Uint8Array): boolean {
  if (data.length < TRUNCATION_MARKER_BYTES.length) return false;
  return TRUNCATION_MARKER_BYTES.every((byte, i) => data[i] === byte);
}

function withTruncationNote(tail: string, totalBytes: number): string {
  const whole = tail.slice(tail.indexOf("\n") + 1);
  return (
    `${TRUNCATION_MARKER} only the newest ${formatBytes(byteLength(whole))} of ` +
    `${formatBytes(totalBytes)} is included …\n${whole}`
  );
}

/**
 * The user's description as it goes into the report, redacted and then capped at
 * `MAX_NOTE_BYTES`. Truncating beats rejecting: someone who just wrote a long
 * description should not be sent back to trim it by hand, and the opening is
 * where the useful part of both prose and a pasted stack trace lives. The cut is
 * announced so no reader mistakes the kept head for the whole thing.
 */
function describeNote(note: string): string {
  const redacted = redactedNote(note);
  if (!redacted) return NO_DESCRIPTION_PLACEHOLDER;
  const { text, totalBytes } = headOfText(redacted, MAX_NOTE_BYTES);
  if (totalBytes <= MAX_NOTE_BYTES) return redacted;
  return (
    `${text}\n\n_…description truncated: only the first ${formatBytes(byteLength(text))} of ` +
    `${formatBytes(totalBytes)} was kept so the report stays under GitHub's upload limit._`
  );
}

/**
 * The description with private data removed, which is the only form allowed past
 * this module. Redaction runs before any truncation: rewriting text changes its
 * length, so cutting first would leave the cap describing a string that no
 * longer exists — and the issue title is cut from this too, because the
 * prefilled URL opens in a browser before the user has reviewed anything.
 */
function redactedNote(note: string): string {
  return redactLogText(note.trim());
}

/**
 * A source's failure as it goes into `report.md`. A filesystem error is user
 * data in its own right — it quotes the absolute path it failed on, and with it
 * the home-directory username — and nothing bounds its length or keeps it on one
 * line, which the markdown list it lands in relies on.
 */
function describeFailure(err: unknown): string {
  const oneLine = redactLogText(err2String(err)).replace(/\s+/g, " ").trim();
  const { text, totalBytes } = headOfText(oneLine, MAX_REASON_BYTES);
  return totalBytes > MAX_REASON_BYTES ? `${text}…` : text;
}

function describeAttachment(attachment: AttachmentOutcome): string {
  const suffix =
    attachment.status === "included"
      ? attachment.truncated
        ? " — truncated to the newest entries"
        : ""
      : ` — ${attachment.status}: ${attachment.reason ?? "no reason given"}`;
  return `- ${attachment.name}${suffix}`;
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function byteLength(text: string): number {
  return encodeText(text).length;
}

/**
 * The subset of an open file handle `readTailFrom` needs, so the tail logic can
 * be exercised without a real filesystem.
 */
export interface TailReadable {
  stat: () => Promise<{ size: number }>;
  read: (
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ) => Promise<{ bytesRead: number }>;
}

/**
 * Read at most `maxBytes` from the end of an open file. Positional rather than
 * whole-file because the activity log can be 50 MB and only its newest entries
 * are ever wanted.
 *
 * Exported for its own tests: the loop is this module's only defence against a
 * short read, which `read` may return at any time and does when the file shrinks
 * between the `stat` that sizes the buffer and the read that fills it. Decoding
 * the whole buffer regardless would turn the unfilled remainder into NUL
 * characters inside a log the user is told is genuine.
 *
 * @param handle Open file to read from; the caller owns closing it.
 * @param maxBytes Ceiling on how much of the tail to keep.
 */
export async function readTailFrom(
  handle: TailReadable,
  maxBytes: number
): Promise<{ text: string; totalBytes: number }> {
  const { size } = await handle.stat();
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  if (length <= 0) return { text: "", totalBytes: size };

  const buffer = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, start + filled);
    if (bytesRead <= 0) break;
    filled += bytesRead;
  }
  // Reading nothing means the file shrank past `start` between the `stat` that
  // planned the read and the read itself — rotation truncates the 50 MB activity
  // log in place and does exactly that. Reporting the stale `size` here would
  // have the caller bundle a body of nothing but a truncation banner and label
  // the source included; reporting 0 is what was actually read, and the caller
  // already turns that into an honest skip.
  return { text: decodeTail(buffer.subarray(0, filled)), totalBytes: filled === 0 ? 0 : size };
}

/**
 * Report bundles hold an unredacted screenshot of the user's vault and their own
 * prose, and they live in the OS temp folder, which on Linux is shared with every
 * other account on the machine. Default permissions there are world-readable, so
 * the staging folder and the zip are narrowed to their owner.
 *
 * Applied with `chmod` after each write rather than through a creation `mode`,
 * because umask trims a creation mode and `mkdir --recursive` only applies one to
 * the deepest directory it makes. POSIX-only by nature: on Windows the call is a
 * no-op the ACL ignores, which is why failing to apply it is not fatal.
 */
const OWNER_ONLY_DIR_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;

async function restrictToOwner(
  fs: typeof import("node:fs/promises"),
  target: string,
  mode: number
): Promise<void> {
  try {
    await fs.chmod(target, mode);
  } catch (err) {
    // Windows has no POSIX mode bits, and a temp dir owned by another account
    // cannot be re-moded. Neither is worth failing a bug report over — the
    // bundle is still written, just without the extra narrowing.
    logWarn(`[issueReport] could not restrict permissions on ${target}:`, err);
  }
}

function getNodeReportRuntime(): ReportRuntime {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return {
    join: (...parts: string[]) => path.join(...parts),
    mkdir: async (p, opts) => {
      await fs.mkdir(p, opts);
      await restrictToOwner(fs, p, OWNER_ONLY_DIR_MODE);
    },
    writeFile: async (p, data) => {
      await fs.writeFile(p, data);
      // After the write, not through a creation `mode`: that one is ignored for
      // a file that already exists, and umask trims it even for a new one.
      await restrictToOwner(fs, p, OWNER_ONLY_FILE_MODE);
    },
    readBytes: async (p) => new Uint8Array(await fs.readFile(p)),
    sizeOf: async (p) => (await fs.stat(p)).size,
    remove: (p) => fs.rm(p, { recursive: true, force: true }),
    readTail: async (p, maxBytes) => {
      const handle = await fs.open(p, "r");
      try {
        return await readTailFrom(handle, maxBytes);
      } finally {
        await handle.close();
      }
    },
  };
}
