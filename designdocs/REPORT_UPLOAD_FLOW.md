# Issue Report Upload Flow

"Report an issue" packs a diagnostic zip on the user's machine, uploads it privately, and opens a prefilled GitHub issue carrying the returned **report ID**. The user presses Submit in the browser and is done. The zip never appears on the issue: maintainers resolve the ID against the report store, and nothing on the public page can download anything.

## Privacy boundary

- **Redaction on the way in.** `redactLogText` runs over every log body, the description, the issue title cut from it, and every source's failure reason; nothing else in the bundle is user-typed. It is a pattern pass, so an unfamiliar secret can get through. **The screenshot is raw PNG**, and the consent copy says so.
- **Review before send.** Page one consents to _categories_; page two shows the _artifact_ and needs its own click.
- **Private storage, opaque ID.** No licence key or account identity travels with the upload. The issue carries the ID and never a URL: a download surface would publish the bundle.
- **Expiry.** Retention is the server's contract; the consent copy states the window ("deleted after 60 days"). The receipt's `expiresAt` is validated but displayed nowhere.

## Two pages

**Details** (`DetailsPage` in `ReportIssueFlow.tsx`): a description field, one checkbox per source, the verbatim consent copy, **Cancel** and **Prepare report**. The screenshot is listed only while a capture target exists; the activity log is always listed but unchecked, with "turned off in Settings → Advanced" under it, when logging is off; the opencode log appears only on the opencode backend.

**Review** (`ReviewPage`): stage ticks while `prepare` runs, then the manifest — one row per selected source with a tick or cross and its note — and the zip's name and size. Buttons: **Cancel**, **Show zip**, **Upload & open issue**. While uploading the buttons give way to "Uploading — this can't be canceled…", because the transport has no abort. On failure the page shows the error and offers **Retry upload**, **Show zip**, **Open issue anyway** (the no-ID URL; the zip is attached by hand) and **Cancel**. On success the flow calls `onUploaded` and has no further state: the modal opens the linked issue URL, closes, and shows "Report uploaded. Finish the issue in your browser."; if the browser cannot be opened, the Notice carries the report ID and a link to the issue page instead.

## The pack: once, in memory, one file written

`buildReportBundle(input, runtime)` in `src/utils/issueReport.ts` is the whole assembly; its only disk access is the injected `readTail`, so it runs in a unit test without a filesystem. The modal captures the screenshot (a failed capture costs the picture, not the report), resolves the log requests, calls the assembler, and only then makes a fresh `mkdtemp` directory and writes the zip into it. A failed write removes the directory and fails prepare.

**Budget, in a fixed order.** `MAX_BUNDLE_BYTES` is 24 MiB; `REPORT_NOTE_RESERVE_BYTES` (a 64 KiB note cap plus 8 KiB of fixed sections) comes off first so `report.md` always fits. Then the screenshot: one that does not fit is left out with `screenshot is N, over the M left` rather than failing the bundle. Then each log in request order, read **whole** (up to `MAX_REDACTABLE_LOG_BYTES`, 64 MiB), redacted whole, and only then cut to the budget. The order is the whole guarantee: redaction recognises a value by the key in front of it, and that key can be any distance ahead — on the previous line, two lines up with the separator alone between them, or at the head of a run of bare `secret=` lines that the generic rule pairs up from wherever the text starts. Any read that opens after the key, however much context it carries, either packs the value as plain text or shifts the pairing so a later value goes plain; only reading from the file's first byte sees every pair that full-text redaction sees, so what is packed is exactly a tail of `redactLogText(whole file)`. Cutting already-redacted text cannot expose anything. The ceiling bounds memory for third-party logs (the activity log rotates at 50 MiB, so every log the plugin writes fits under it); a log above it is left out with `log is N, over the M a report can redact` rather than redacted in part. Its other notes are `not found`, `empty`, `failed: …`, `truncated to the newest entries of M` (the packed size sits in the size column; it can exceed the kept slice once the banner and redaction's rewrites are in), `newest entry alone is larger than the room left` (a tail's cut-open first line is a fragment and is dropped) or `log is N, over the M left` (a tail under the 64 KiB floor). Redaction rewrites rather than only removes, so a log that fit whole before it can overflow after it: it is then treated like any other oversized log — cut to a tail and listed as truncated, or left out under the floor. A truncated log opens with a banner naming the original size, never the kept one. The zip is stored uncompressed so the budget maps 1:1 onto the packed size; a zip over the 25 MiB limit both destinations share throws, naming the largest source the user can uncheck.

**The manifest is settled before packing.** `attachments` (`report.md` first, then every requested source in bundle order) is the assembler's word on what the zip holds; `bytes` is what was packed, 0 when `included` is false. The same array feeds `buildReportMarkdown` (the "Attached files" list in `report.md`, which is also the issue body) and the review page; nothing re-derives it from the checkboxes.

## Idempotency: why Retry is always safe

`buildReportBundle` mints `uploadAttempt = { body, idempotencyKey }` in one place, so one set of bytes has one key and only preparing again mints a new pair. The server deduplicates on the key, so **Retry upload** re-sends the identical attempt without repacking, and a "failed" upload whose response was lost (not its write) returns the stored copy's ID instead of storing a second one.

There is one failure type, `ReportUploadError`, and every failure is retryable. A refused upload reads `Upload failed (HTTP N)` with the server's reason when it gives one (413 → `Upload failed (HTTP 413): Report ZIP exceeds 25 MiB`). A request that gets no answer within the deadline fails the same way and can be retried; it and any other unconfirmed outcome say so, because the report may already be stored.

## Closing the dialog mid-flight

Obsidian's `Modal` cannot refuse a close, and neither `prepare` nor `upload` can be aborted, so both outlive the dialog; `mountedRef` keeps their results out of the unmounted tree. A report that finishes preparing after close goes to `discardReport`, which deletes its temp directory, and Cancel or ESC on the review page before uploading deletes it too. An upload in flight is the exception: the zip is left alone, and when the upload lands the modal shows a persistent Notice with the report ID and a link to the issue page; no browser tab opens for a user who has left. A failure after close is only logged.

## The issue URL

`buildLinkedReportIssueUrl` puts the ID in a prefix that truncation can never reach; `buildManualIssueUrl` carries no ID. Both bodies are the packed `report.md`, so the issue and the bundle cannot drift apart. The URL is capped at 1,800 characters (Windows' `shell.openExternal` silently rejects longer ones); what is cut is still in the zip.

## Deliberately not done

- **No editable staging folder.** Files on disk would need reading back, a size guard and rules for a missing or unreadable file; the review page already shows everything the zip holds.
- **No rebuild.** Without a folder there is nothing to re-read; unchecking a source and preparing again mints a new attempt.
- **No status classification.** With the idempotency key a re-send is safe after every failure, so there is nothing for a `retryable` flag to gate.
- **No completion page.** A page after success is a third step holding a Notice's worth of text; the ID is already in the issue body.
- **No deleting the zip after success.** The user may still need it if the browser did not open or a maintainer asks for the file; the OS temp sweep reclaims it.

## Related

- <https://github.com/Brevilabs/obsidian-copilot-private/issues/202> — the redaction, truncation and close-mid-flight edge cases above.
- <https://github.com/logancyang/obsidian-copilot-preview/issues/250> — frame logs at a predictable temp path; same privacy axis, different surface.
