# Issue Report Upload Flow

How "Report an issue" hands a diagnostic bundle to a maintainer: the plugin packs
a zip, uploads it through the existing Brevilabs API, and writes the returned link
into a prefilled GitHub issue. The user clicks Submit in their browser and is
done.

This replaces a native OS drag. The UI is built and merged against a mock
uploader; what remains before it can ship to users is the endpoint.

## Why change it

Today the flow packs the zip and asks the user to **drag it** from the modal into
a GitHub issue comment box, via Electron's `webContents.startDrag`. That hand-off
carries most of the feature's cost and most of its fragility:

- `src/utils/nativeFileDrag.ts` exists solely to serve it, including a base64
  fallback icon because macOS refuses a drag with an empty one, and
  single-file-only handling because Windows drags only the first entry of a
  `files` array (electron#9019, closed unfixed).
- The drag can fail for reasons the plugin cannot detect in advance, so the UI
  carries a `dragSupported` / `dragFailed` pair and three degraded layouts.
- **The gesture requires the modal to stay alive.** That is what made the modal a
  multi-step wizard, and what let Obsidian 1.13 break it: dismissing Settings (now
  a window of its own) destroyed the window hosting the dialog mid-capture. Fixed
  in `1f679e5d`, but the class of problem is inherent to hosting an OS drag in a
  dialog that must survive a window teardown.
- Even when it works, the user still has to aim a file at a browser window.

## Transport: the existing Brevilabs API

The upload goes through `BrevilabsClient`
(`src/LLMProviders/brevilabsClient.ts`), not a new path. This settles three
questions and closes off two features.

**Authentication and delivery are solved.** `makeRequest` already attaches
`user_id` and `X-Client-Version` (`brevilabsClient.ts:196-207`). There is no
broker to build, no presigned-URL signing in the client, and no storage
credential ever ships inside the plugin. Binary upload has precedent too:
`docs4llm` posts multipart via `makeFormDataRequest`, which is the shape to
follow. `pdf4llm`'s base64-into-JSON is not — base64 inflates a 24 MB zip to
roughly 32 MB of string.

**No licence is required.** `validateLicenseKey` already calls with
`excludeAuthHeader` and `skipLicenseCheck` (`brevilabsClient.ts:294-300`), so a
report can be sent without `checkLicenseKey()` (`:173`) rejecting it. Reporting a
bug is not a premium feature: gating it would silence exactly the users most
likely to hit a rough edge.

The endpoint is therefore unauthenticated and needs its own abuse controls. The
plugin gives it one handle — `body.user_id` is attached unconditionally
(`brevilabsClient.ts:196`), a random per-install UUID, so rate limits and quotas
do not need a licence to key on.

**There is no progress and no cancellation.** Everything goes through Obsidian's
`requestUrl`, and `RequestUrlParam` (`obsidian.d.ts:3006`) has no `signal` and no
progress callback. So the UI shows an indeterminate spinner, not a percentage —
inventing one from elapsed time would be a lie with a progress bar around it — and
it offers no Cancel, because a button that only stops the UI waiting while the
request runs to completion is a button that lies.

This is a real constraint, and it also removes work: no `AbortController`
lifecycle, no attempt-ID bookkeeping to discard late progress callbacks, no
partial-upload cleanup path.

## The flow

Three pages in one modal, with a read-only stepper at the top.

```
┌ ① What to include ─── ② Pack & review ─── ③ Submit ┐
```

The stepper **replaces** the inline `①②③` numbering the current attach screen
uses; two numbering systems in one dialog is worse than either alone. It indicates
position only — clicking back would open a whole re-edit state space for a bundle
that has already been packed or sent.

### ① What to include

Description textarea, the source checkboxes, and the notice, then
`[Pack the report]`.

The notice has to be specific about the two things a reasonable person would not
assume:

> Copilot packs the selected items into one zip and uploads it, then puts the link
> in the GitHub issue. Anyone who opens that issue can download it — the
> screenshot is not redacted.

Both halves are load-bearing. The destination is a **public** repo (`REPORT_REPO`
in `src/utils/issueReport.ts`, whose comment says so), and while every text source
passes through `redactLogText`, **the screenshot is raw PNG** — no redaction pass
exists for pixels.

`report.md` is not one of the checkboxes: it is mandatory and always included,
carrying the description, the environment block, and the per-source outcomes
(`issueReport.ts:233`). The notice speaks for it.

### ② Pack & review

Packing runs on entry. The page then shows **what was actually packed**, and
waits:

```
✓  report.md                 2.1 KB
✓  screenshot.png            848 KB
✓  acp-frames.ndjson.txt     3.2 MB   truncated
✓  copilot-report-….zip      4.2 MB

[ Upload & open issue ]   Show in folder   Rebuild zip
```

**The upload needs its own click, and this is not a redundant confirmation.** Page
① consented to _categories_; this is the first and only view of the _artifact_ —
real filenames, real sizes, and which sources came back skipped or truncated.
`docs/agent-mode-and-tools.md:243` already tells users to check the unredacted
screenshot before sending, so removing that opportunity would regress documented
behaviour.

`Rebuild zip` lives here and **only** here. Once the bundle is uploaded this page
is gone, so rebuild-after-upload is unreachable by construction. That single
constraint deletes a whole class of states: a stale link pointing at replaced
contents, an orphaned remote object, a user stripping sensitive content locally
while the old copy is still downloadable.

While uploading, the row set stays put and a spinner replaces the button row.
Failure stays on this page — the error, `[Retry upload]`, `Show in folder`, and an
escape hatch worded so it is unmistakable: the issue it opens carries **no** link
and the user must attach the zip themselves.

### ③ Submit

What was uploaded, the link (copyable), its expiry, and `[Open the issue]`.

This page earns its click. The link needs somewhere to live if the browser never
surfaces the page or the user closes the tab, and it carries the one clarification
that prevents a false sense of completion:

> The link is already written into the issue. Nothing is filed until you press
> Submit in your browser.

If the API supports revocation, `Delete uploaded report` belongs here too — this
is the last page that still holds a handle on the uploaded object.

## The uploader interface

```ts
export interface ReportUploadResult {
  /** Stable, non-secret URL for the issue body. Never a raw presigned GET. */
  shareUrl: string;
  /** When `shareUrl` stops working, so page ③ can say. */
  expiresAt?: string;
}

export type ReportUploader = (zipPath: string) => Promise<ReportUploadResult>;
```

A function type, not an interface with one method: one operation, no state. No
`signal` and no `onProgress`, because the transport supports neither — an
interface that advertises capabilities the implementation cannot honour is how a
UI ends up promising a Cancel button that does nothing.

Two fields rather than a bare URL, because each has a caller: `shareUrl` goes in
the issue and `expiresAt` is displayed on page ③. A server-side id for revocation
and support correlation is deliberately absent — nothing here would read it, and
requiring it would oblige an endpoint that does not exist yet to return a field
no caller wants. Revocation, when it lands, adds both the id and the sibling
`deleteReport` that consumes it, rather than pre-paying for half of it now.

**Injected at the composition root**, as a **required** `ReportIssueModalParams`
field. Tests override it.

An earlier draft of this section said the opposite — that requiring it would
break the barrel-exported constructor contract, so it had to be optional. That
was written before the call sites were counted, and the count settles it:
`ReportIssueModal` is constructed in exactly one place
(`AdvancedSettings.tsx:150`), the barrel that re-exports it
(`src/agentMode/index.ts:67`) has no consumer outside this plugin, and the
plugin ships as a single bundle. There is no contract to break.

With that gone, the trade is one-sided. A required field turns "forgot to wire
the uploader" into a compile error; an optional one turns it into a modal that
looks fine until the user clicks Upload and gets a failure that names nothing
they can act on. The one caller is already updated, so the compile-time check
costs nothing and catches the next caller too.

### What the API contract must guarantee

The plugin cannot solve these, but the design depends on them:

- **`shareUrl` is not a bearer credential.** Writing one into a public issue
  publishes it, at which point "unguessable" provides nothing. The link must be a
  stable reference whose authorisation happens server-side when a maintainer opens
  it.
- **Retry is idempotent.** A lost response does not mean a lost write; see the
  completion-ambiguity row in the matrix.
- **Limits are stated.** The packer caps its own input, but the endpoint's ceiling
  has to surface as a distinguishable error so page ② can name it.
- **Retention is a real number** the endpoint enforces and returns as
  `expiresAt`, so the disclosure can be specific rather than open-ended.

## The issue URL is built after upload

The obvious implementation has two defects. Both are fixed; this records what
they were, because both are easy to reintroduce.

**The link would be truncated first.** Over-long bodies were cut with
`body.slice(0, keep)` — from the **end**. A link appended to the body is the
first thing a long description pushes out. The report reference now sits in a
prefix `buildIssueUrl` never touches, with truncation applied only to the body
below it, and a test packs an over-long note and asserts both that the link
survives and that the URL still fits its cap.

**The URL was built too early.** `assembleReportBundle` generated it before any
upload existed. The URLs are now built in `zipReportBundle`, from the
`report.md` it just packed — late enough that an edit the user made in the
staging folder reaches the issue, which the earlier shape could not do.

The two are named apart: `manualIssueUrl` (no link, opened when upload fails or
is skipped) and the linked URL from `buildLinkedReportIssueUrl`, built only once
a `shareUrl` exists. Neither can stand in for the other by accident.

A third defect surfaced later, in the seam between them: `uploadReport` caught
the upload and the URL construction in one `try`, so a link too long to fit the
URL cap reported the whole upload as failed — offering a Retry that would
upload a second copy of a report the server already had. They are caught
separately now. Once the upload resolves, the outcome is a success; a URL that
could not be assembled downgrades to `linkPrefilled: false`, and page ③ asks
the user to paste the link instead.

## Privacy

The bundle is **retained** server-side. That is the point: a maintainer opens the
link days later. It differs from every existing Brevilabs upload (`pdf4llm`,
`docs4llm`), which processes and discards.

**In-flow disclosure is the protection.** The upload is user-initiated, named on
page ① before anything is packed, and needs a separate click on page ② against the
real manifest. A user who does not want to send it clicks nothing and uses
`Show in folder`. That is materially different from silent background telemetry,
which is what a blanket retention promise exists to rule out.

Two follow-ups, neither blocking:

- `README.md:337` states unconditionally that "No message content, file uploads,
  or documents are retained on our servers after processing", and
  `docs/troubleshooting-and-faq.md:220` repeats it. Once this ships that sentence
  is inaccurate for a user-initiated report and wants a carve-out naming the
  retention window. A documentation accuracy problem, not a user-harm one.
- The screenshot has no redaction path. Page ① says so, which is the honest
  minimum; a redaction pass, or dropping the screenshot from the upload and
  keeping it on the manual path, are the larger answers if that proves
  insufficient.

## What this deletes

The point of the change, and the reason it is worth doing even before the endpoint
exists.

**Deleted outright — 293 lines:**

| File                               | Lines |
| ---------------------------------- | ----- |
| `src/utils/nativeFileDrag.ts`      | 148   |
| `src/utils/nativeFileDrag.test.ts` | 145   |

**Replaced by something smaller.** The `Attach & submit` block in
`ReportIssueFlow.tsx` is 142 lines of numbered manual instructions — open the
issue, drag the file in, submit — because the user has three things to do by hand.
After this they have one, and the block collapses into an upload row plus a
result. The drag also has 32 references through `ReportIssueFlow.tsx` and 21
through `ReportIssueModal.tsx` that go with it:

- `dragSupported` / `dragFailed` state and the three degraded layouts
- `loadFileDragIcon`, `DragIcon`, and the `dragIcon` field on the modal
- the drag chip and its `dragstart` handler

**Copy that becomes wrong**, and has to move with it:

- `buildReportMarkdown` writes "Drag it into the…" into `report.md`
  (`issueReport.ts:406`); the truncation note asks the reader to paste the full
  report in (`:419-421`).
- `README.md:259` describes the manual attach.
- `docs/agent-mode-and-tools.md` states the zip is never uploaded and documents
  the drag hand-off.

**What is added:** the uploader interface and its mock (52 lines in two new
files), the stepper, upload state and its manifest on page ②, and page ③.

**The net is not a reduction.** This section originally claimed it would be.
Measured against what shipped, production code is **+199 lines** (`+650/-503`
across tracked `src` files, plus 52 untracked). The deletions above all
happened; they are simply outweighed by three pages, an upload state machine,
and the URL split. Worth recording plainly rather than leaving a budget claim
the diff contradicts: what the change buys is the removal of the most
platform-specific code in the feature and of a hand-off users could fail at, not
a smaller codebase.

**No persisted schema changes.** The wizard state is React-local and
`PreparedReport` is never serialised, so there is no settings migration. The new
persistent state lives on the server and wants its own versioning, `createdAt`,
`expiresAt`, and status. `PreparedReport` (`ReportIssueFlow.tsx:34`) does gain
upload fields, and every flow test fixture constructs it.

**Upload does not bring mobile support.** The entry point stays desktop-gated
(`AdvancedSettings.tsx:123`) and the flow still needs Node temp paths and Electron
reveal. Not part of this work's return.

## Defect matrix

Typing: this hits **state-write × failure** (upload state, plus what is left on
disk and on the server), **carried state × boundary events** (the link surviving
rebuild, retry, close), **batch × partial failure** (a multi-source bundle where
one source fails while the whole succeeds), **actor / trust boundary ×
authorisation and retention**, and **concurrency × completion ambiguity**.

### A — lifecycle × what each party holds

| Lifecycle                    | Zip on disk    | Object on server | Link the user holds | Answer                                                                                                                                                                                                                                                    |
| ---------------------------- | -------------- | ---------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not started                  | exists         | none             | none                | —                                                                                                                                                                                                                                                         |
| In flight                    | exists         | partial          | none                | Buttons replaced by a spinner                                                                                                                                                                                                                             |
| Succeeded                    | exists         | one object       | valid               | Page ③                                                                                                                                                                                                                                                    |
| Failed, server has nothing   | exists         | none             | none                | Retry, or the manual path                                                                                                                                                                                                                                 |
| **Failed, server succeeded** | exists         | **one object**   | **none**            | **"Failed" does not imply the server is clean** — the response was lost, not the write. Retry must be idempotent or it orphans a second copy                                                                                                              |
| In flight × rebuild          | being replaced | partial          | none                | **Rebuild is disabled while uploading**, or the upload streams a file being deleted underneath it                                                                                                                                                         |
| In flight × second click     | exists         | two partials     | none                | **Single-flight lock**: the button is disabled for the duration                                                                                                                                                                                           |
| Succeeded × rebuild          | new zip        | old contents     | stale               | **Unreachable by construction** — page ② is gone after upload                                                                                                                                                                                             |
| Modal closed in flight       | exists         | one object       | valid               | Cannot be aborted, so closing does not undo it. On success the prefilled issue still opens — the report is stored either way, and withholding the link would leave an upload the user can neither see nor use. A failure has no surface left to report on |

### B — content axis × timing axis

|                           | Content                                                                              | Timing                            |
| ------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| What enters the bundle    | per-source opt-in; text redacted; `report.md` mandatory; screenshot **not** redacted | chosen on ①, packed on ②          |
| What the user is told     | ①'s notice names public reach and the unredacted screenshot                          | before packing, before upload     |
| What the user can inspect | real manifest with sizes, plus `Show in folder`                                      | on ②, **before** the upload click |
| What leaves the machine   | the whole zip                                                                        | on the upload click on ②          |

The third row is why page ② splits packing from uploading. Packing and uploading
on one click would put the real manifest on page ③ — after the fact.

### C — per-source failure × whole-bundle success

A source can be skipped, failed, or truncated while the bundle uploads fine.
Modelled by `AttachmentOutcome`, and visible on page ② before sending.

### D — actor / trust boundary × authorisation and retention

| Actor                           | Holds                     | Must not be able to            |
| ------------------------------- | ------------------------- | ------------------------------ |
| Reporter                        | zip, `shareUrl`           | — (may revoke, if supported)   |
| Maintainer                      | `shareUrl` from the issue | download without authorisation |
| Anyone reading the public issue | `shareUrl`                | download at all                |
| Brevilabs                       | the object                | retain past the stated window  |

The third row is what forces `shareUrl` to be a reference rather than a
credential.

## Sequencing

This section originally required the endpoint before any UI. That was overruled:
the UI is built and merged first, against a mock, and the endpoint follows. What
remains true is the reason the rule existed, so it is worth being exact about
what the override does and does not license.

**What shipped.** The three pages, the uploader interface, and the deletion of
the drag path, wired to `reportUpload.mock.ts` — which resolves after a delay
with a `shareUrl` on the RFC 2606 `.invalid` TLD. Every success state is
reachable and testable; nothing is actually sent anywhere.

**What that costs.** A mock that always succeeds is not the failure shape the
original rule was written against — it is the opposite one, and it is worse in
one specific way. A stub that always throws routes users into a visible failure;
a stub that always succeeds routes them into an invisible one. The user sees
"Report uploaded", opens an issue carrying a dead link, and submits it believing
the bundle is on a server. If the local zip is later cleaned up, the evidence is
gone with no error ever shown.

**What holds it.** Nothing in the code. This branch must not merge or release
before the endpoint exists — that is a human gate, and it is the whole
protection. The `.invalid` host is the one hedge that survives a mistake: a fake
link can never resolve, and can never be mistaken for a real response.

**Still to build, in order:**

1. The endpoint, far enough to prove the contract end to end: private object,
   authorised maintainer download, an enforced retention window, idempotent
   retry, and rate limiting keyed on `user_id`.
2. A real adapter replacing `reportUpload.mock.ts`. Note this is not purely
   backend work — `makeFormDataRequest` attaches an `Authorization` header
   unconditionally even with `skipLicenseCheck` (`brevilabsClient.ts:222,243`),
   so the multipart path needs an `excludeAuthHeader` option first.
3. Only then, release.

## Prior art

**VS Code's Issue Reporter** is the closest analogue: an Electron app prefilling a
GitHub issue with diagnostic data, which does **not** upload. Past GitHub's URL
character limit it copies everything to the clipboard and asks the user to paste.
Their tracker records how that goes — the clipboard is overwritten silently
(microsoft/vscode#50659, open for years); users do not realise they must paste, so
issues arrive holding only the placeholder (#60237); the limit is easy to blow
with system info alone (#100054).

Two things follow. Upload is the better trade than clipboard, since the pattern we
would otherwise copy is a known long-standing complaint. And the URL-length cap in
`buildIssueUrl` is load-bearing: the URL may carry a link, never a payload.

**Cloudflare R2 presigned URLs** were the alternative transport and are not being
used — going through the existing API means no client-side signing and no
credentials in the plugin. One lesson transfers anyway: a presigned GET embeds its
own authorisation, so handing one to a public issue publishes the object. That is
why `shareUrl` is specified as a reference, not a credential.

## Related

- `1f679e5d` — the Obsidian 1.13 window-teardown fix. Still load-bearing after
  this change: the screenshot step calls `captureBehindOverlay`, and its
  same-window check is what stops dismissing Settings from destroying the
  window the report itself runs in. Do not remove it with the drag.
- `logancyang/obsidian-copilot-preview#250` — frame logs at a predictable temp
  path with default permissions; same privacy axis, different surface
