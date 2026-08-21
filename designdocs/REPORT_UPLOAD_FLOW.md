# Issue Report Upload Flow

How "Report an issue" hands a diagnostic bundle to a maintainer: the plugin packs
a zip, uploads it privately, and writes the returned **report ID** into a
prefilled GitHub issue. The user clicks Submit in their browser and is done. The
bundle itself never appears on the issue — maintainers resolve the ID against the
report store; nothing on the public page can download it.

This replaces a native OS drag. The UI shipped first against a mock uploader;
the real adapter (`src/utils/reportUpload.brevilabs.ts`) has since replaced it
and the mock is deleted.

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

## Transport

A dedicated adapter (`createReportUploader` in
`src/utils/reportUpload.brevilabs.ts`) posts the zip's raw bytes with
`Content-Type: application/zip`. The request carries exactly four headers — the
content type, a per-installation ID, an idempotency key, and the plugin version —
and the adapter's tests pin that set with an exact match, so nothing extra can
creep in.

**Deliberately not routed through `BrevilabsClient`.** Both of its request
helpers attach an `Authorization` header or a `user_id`, and this path must send
neither: a diagnostic report is not a licensed API call, and tying one to the
user's licence is exactly what the flow's privacy copy promises it does not do.
Reporting a bug is not a premium feature either — gating it would silence
exactly the users most likely to hit a rough edge.

**The zip is uncompressed (STORE).** The endpoint rejects any compressed entry,
so `zipReportBundle` packs with `level: 0`. The 24 MB bundle budget therefore
maps 1:1 onto the packed size — no compression absorbs an overrun — and the
shared 25 MB ceiling (the endpoint's, and GitHub's attachment limit on the
manual fallback path) is checked against the packed result.

**The per-installation ID is its own identifier**
(`src/utils/reportInstallId.ts`): a UUIDv4 minted once into `localStorage`,
which Obsidian never syncs. Not `getDeviceId()` (its fallbacks are not UUIDs,
which the endpoint rejects) and not `settings.userId` (which rides on licensed
API calls — reusing it would let a report be joined to a paid account, and it is
vault-scoped besides). Reports are therefore not tied to any account identity;
they are not fully anonymous either — the service necessarily sees the install
ID and the connection — and the copy says neither more nor less.

**There is no progress and no cancellation.** Everything goes through Obsidian's
`requestUrl`, and `RequestUrlParam` has no `signal` and no progress callback. So
the UI shows an indeterminate spinner that says the upload cannot be canceled,
not a percentage — inventing one from elapsed time would be a lie with a
progress bar around it. There is, however, a **deadline**: after four minutes
the adapter stops waiting and reports an uncertain outcome, so a TCP black hole
cannot pin the flow on "Uploading…" forever. That is not a cancellation — the
underlying request keeps running, and if it did land, retrying the same attempt
returns the stored copy's ID rather than storing a second one.

## The upload attempt: bytes and idempotency key travel as a pair

The endpoint deduplicates retries by an `Idempotency-Key` header. The invariant
that matters is **one set of bytes, one key**: a retry must re-send the exact
bytes the key was minted for, and new bytes must always arrive under a new key —
or the server answers the new upload with the old stored bundle, silently.

That invariant is enforced by construction, not by checking. `zipReportBundle`
mints the key in the same return value that carries the packed bytes
(`ReportUploadAttempt { body, idempotencyKey }`), and `PreparedReport` holds the
pair whole:

- **Retry upload** re-sends the same attempt — safe by definition, and safe in
  the strong sense: if a "failed" upload actually landed (the response was lost,
  not the write), the retry returns the stored copy's ID instead of storing a
  second one.
- **Rebuild zip** replaces the whole `PreparedReport`, so new bytes and a new
  key are inseparable. A rebuild that fails leaves the old attempt untouched.
- The uploader takes the attempt object, not a path — a file on disk can change
  under a key that still names the old contents; in-memory bytes cannot. This is
  also what keeps the adapter free of Node imports, so it lives in `src/utils`
  without touching the ESLint node-modules allowlist and is safe to load on
  mobile.

Closing the modal and reopening it packs a fresh report and mints a fresh key.
Accepted residual: if a previous upload actually landed but its response was
lost and the user starts over, the server stores a second copy and a second slot
of the upload allowance is spent; both age out with the retention window.
Persisting the key across sessions was rejected — a stale key reused for new
bytes is the silent-misreport failure above, strictly worse.

## Failure classification: `retryable` gates the Retry button

Upload failures are not one bucket. `UploadOutcome`'s failure half carries a
structured `retryable`, set by the adapter (`ReportUploadError`), and the review
page withholds the Retry button when it is false:

| Class                | Examples                                                                                                      | Retryable | Why                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| Local, nothing sent  | install ID unavailable, plugin version invalid                                                                | no        | Refused before the request, so the upload allowance is not spent; the fix is the manual path, not a resend |
| Definitive rejection | 400 / 413 / 415 / 422 / 429                                                                                   | no        | The identical bytes fail identically — while still spending a slot of the upload allowance                 |
| Uncertain outcome    | network error mid-flight, upload deadline elapsed, unreadable 2xx response, 408/425, a bare 3xx, 5xx / outage | yes       | The report may or may not be stored; the idempotency key makes re-sending safe either way                  |
| Confirmed success    | 2xx with a fully well-formed receipt                                                                          | —         | Page ③                                                                                                     |

Two rules the copy obeys everywhere: never claim a failed request "did not count"
(the allowance is spent before validation, and a lost response is not a lost
write), and never quote which limit tripped a 429 (the client cannot know).

Error text is fixed local copy plus the status code — never the response body,
which a proxy or captive portal can fill with arbitrary or echoed content, and
never the transport's own message, which can carry local paths. A sentinel test
pins that nothing from an error response reaches the user or the log.

## The flow

Three pages in one modal, with a read-only stepper at the top.

```
┌ ① What to include ─── ② Pack & review ─── ③ Submit ┐
```

The stepper indicates position only — clicking back would open a whole re-edit
state space for a bundle that has already been packed or sent.

### ① What to include

Description textarea, the source checkboxes, and the consent notice, then
`[Pack the report]`.

The notice is maintainer-approved verbatim copy and must not be reworded:

> Copilot redacts common sensitive data from diagnostic text on your device
> before upload. Review it before sending; screenshots are not automatically
> redacted. Reports are private and deleted after 60 days.

Every text source passes through `redactLogText`; **the screenshot is raw PNG** —
no redaction pass exists for pixels, which is why the copy singles it out.

`report.md` is not one of the checkboxes: it is mandatory and always included,
carrying the description, the environment block, and the per-source outcomes.

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
`docs/agent-mode-and-tools.md` tells users to check the unredacted screenshot
before sending, so removing that opportunity would regress documented behaviour.

`Rebuild zip` lives here and **only** here. Once the bundle is uploaded this page
is gone, so rebuild-after-upload is unreachable by construction. That single
constraint deletes a whole class of states: a stale reference pointing at
replaced contents, an orphaned remote object, a user stripping sensitive content
locally while the old copy is still stored.

While uploading, the row set stays put and a spinner replaces the button row,
saying the upload cannot be canceled. Failure stays on this page — the error,
`[Retry upload]` **only when the failure is retryable**, `Show in folder`, and an
escape hatch worded so it is unmistakable: the issue it opens carries **no**
report ID and the user must attach the zip themselves.

### ③ Submit

What was uploaded, the report ID (copyable), when the stored report expires, and
`[Open the issue]`.

This page earns its click. The ID needs somewhere to live if the browser never
surfaces the page or the user closes the tab, and the page carries the one
clarification that prevents a false sense of completion:

> The report ID is already written into the issue. Nothing is filed until you
> press Submit in your browser.

The expiry line says "Report expires _date_" — scheduled, not already happened —
and promises nothing about how a maintainer retrieves the report, because that
mechanism is not this UI's to describe. It also names Discord, because filing an
issue is not the only way people ask for help, and the ID is the whole handle:
pasted into a support conversation it points a maintainer at the same report.

## The uploader interface

```ts
export interface ReportUploadAttempt {
  readonly body: ArrayBuffer;
  readonly idempotencyKey: string;
}

export interface ReportUploadResult {
  reportId: string; // opaque; only ever read from the server's response
  expiresAt: string; // required — the endpoint always returns it
}

export type ReportUploader = (attempt: ReportUploadAttempt) => Promise<ReportUploadResult>;
```

A function type, not an interface with one method: one operation, no state. No
`signal` and no `onProgress`, because the transport supports neither — an
interface that advertises capabilities the implementation cannot honour is how a
UI ends up promising a Cancel button that does nothing.

`reportId` is **only ever read from the response**, never derived or invented
client-side: only the server's receipt says the report was actually stored, and
an ID produced any other way would let the UI display "uploaded" for a report
that is not. The adapter validates the whole receipt strictly — ID shape,
explicit `received: true`, parseable `expiresAt` — because a proxy, captive
portal, or deploy mid-rollout can answer 200 with something else entirely, and
an "upload succeeded" page quoting `undefined` is worse than a failure the user
can retry. Unknown extra fields are ignored, so the server can add fields
without breaking older clients.

**Injected at the composition root**, as a **required** `ReportIssueModalParams`
field, constructed in exactly one place (`AdvancedSettings.tsx`). The install-ID
dependency is a getter resolved on the upload click, so its failure (unusable
storage) surfaces on the action that needs it as a refusal to upload — never as
a broken modal, and never as a non-UUID placeholder on the wire.

## The issue URL is built after upload

The obvious implementation has two defects. Both are fixed; this records what
they were, because both are easy to reintroduce.

**The reference would be truncated first.** Over-long bodies were cut with
`body.slice(0, keep)` — from the **end**. A reference appended to the body is
the first thing a long description pushes out. The report ID now sits in a
prefix `buildIssueUrl` never touches, with truncation applied only to the body
below it, and a test packs an over-long note and asserts both that the ID
survives and that the URL still fits its cap.

**The URL was built too early.** `assembleReportBundle` generated it before any
upload existed. The URLs are now built in `zipReportBundle`, from the
`report.md` it just packed — late enough that an edit the user made in the
staging folder reaches the issue, which the earlier shape could not do.

The two are named apart: `manualIssueUrl` (no ID, opened when upload fails or is
skipped) and the linked URL from `buildLinkedReportIssueUrl`, built only once a
`reportId` exists. Neither can stand in for the other by accident.

A historical third defect died with the link: when the prefix carried a
variable-length `shareUrl`, a URL too long to assemble had a `linkPrefilled:
false` fallback asking the user to paste it. A fixed-width ID in the prefix
cannot exceed the cap, so that fallback — its state field, its second done-page
layout, and its tests — is deleted rather than kept against nothing.

## Privacy

The bundle is **retained** server-side for 60 days, privately. That is the
point: a maintainer looks it up days later by its ID. It differs from every
existing Brevilabs upload (`pdf4llm`, `docs4llm`), which processes and discards
— which is why the README's privacy section carries an explicit
diagnostic-report carve-out instead of a blanket no-retention claim.

**In-flow disclosure is the protection.** The upload is user-initiated, named on
page ① before anything is packed, and needs a separate click on page ② against
the real manifest. A user who does not want to send it clicks nothing and uses
`Show in folder`. That is materially different from silent background telemetry.

**The public issue carries only the ID.** Nothing on the issue can download the
bundle; there is no download link to leak, and the ID is not a credential.

**Local files are the user's.** The staging folder and the zip deliberately
outlive the modal once the review step is reached — they are the review surface.
The server-side deletion never touches them, and the docs say so explicitly.

One follow-up, not blocking: the screenshot has no redaction path. Page ① says
so, which is the honest minimum; a redaction pass, or dropping the screenshot
from the upload and keeping it on the manual path, are the larger answers if
that proves insufficient.

## What this deletes

The point of the change, and the reason it was worth doing even before the
endpoint existed.

**Deleted outright — 293 lines:**

| File                               | Lines |
| ---------------------------------- | ----- |
| `src/utils/nativeFileDrag.ts`      | 148   |
| `src/utils/nativeFileDrag.test.ts` | 145   |

**Replaced by something smaller.** The `Attach & submit` block in
`ReportIssueFlow.tsx` was 142 lines of numbered manual instructions — open the
issue, drag the file in, submit — because the user had three things to do by
hand. After this they have one, and the block collapses into an upload row plus
a result. The drag's `dragSupported` / `dragFailed` states, three degraded
layouts, icon plumbing, and `dragstart` handler go with it.

**Deleted with the real contract:** `reportUpload.mock.ts`, the
`linkPrefilled` fallback and its second done-page layout, and the UI's own
tolerance for a missing or unparseable expiry (the adapter now guarantees it).

**The net is not a reduction.** Production code grew by roughly two hundred
lines against the drag version: three pages, an upload state machine, the
adapter, and the install-ID module outweigh the deletions. What the change buys
is the removal of the most platform-specific code in the feature and of a
hand-off users could fail at, not a smaller codebase.

**No persisted schema changes.** The wizard state is React-local and
`PreparedReport` is never serialised, so there is no settings migration. The
only new client-side persistence is the install ID in `localStorage`.

**Upload does not bring mobile support.** The entry point stays desktop-gated
and the flow still needs Node temp paths and Electron reveal. The adapter and
install-ID modules are nonetheless import-safe on mobile (no Node
dependencies), so the settings tab that constructs the uploader loads there.

## Defect matrix

Typing: this hits **state-write × failure** (upload state, plus what is left on
disk and on the server), **carried state × boundary events** (the attempt
surviving rebuild, retry, close), **batch × partial failure** (a multi-source
bundle where one source fails while the whole succeeds), **actor / trust
boundary × authorisation and retention**, and **concurrency × completion
ambiguity**.

### A — lifecycle × what each party holds

| Lifecycle                    | Zip on disk    | Object on server | ID the user holds | Answer                                                                                                                                                                                                                                                  |
| ---------------------------- | -------------- | ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not started                  | exists         | none             | none              | —                                                                                                                                                                                                                                                       |
| In flight                    | exists         | partial          | none              | Buttons replaced by a spinner that says it cannot be canceled                                                                                                                                                                                           |
| Succeeded                    | exists         | one object       | valid             | Page ③                                                                                                                                                                                                                                                  |
| Failed, server has nothing   | exists         | none             | none              | Retry (same attempt), or the manual path                                                                                                                                                                                                                |
| **Failed, server succeeded** | exists         | **one object**   | **none**          | **"Failed" does not imply the server is clean** — the response was lost, not the write. Retry re-sends the same idempotency key, so the server answers with the stored copy instead of a second object                                                  |
| Definitive rejection         | exists         | none             | none              | No Retry — identical bytes fail identically while spending allowance. Rebuild (new attempt) or the manual path                                                                                                                                          |
| In flight × rebuild          | being replaced | partial          | none              | **Rebuild is disabled while uploading**; the attempt's bytes are in memory anyway, so a mid-flight disk change cannot corrupt the upload                                                                                                                |
| In flight × second click     | exists         | two partials     | none              | **Single-flight lock**: the button is disabled for the duration                                                                                                                                                                                         |
| Succeeded × rebuild          | new zip        | old contents     | stale             | **Unreachable by construction** — page ② is gone after upload                                                                                                                                                                                           |
| Modal closed in flight       | exists         | one object       | valid             | Cannot be aborted, so closing does not undo it. On success the prefilled issue still opens — the report is stored either way — and the ID rides into the browser-failure Notice, which may be its last surviving carrier. A failure has no surface left |
| Modal closed, then reopened  | new bundle     | possibly two     | none              | New pack, new attempt, new key — accepted residual (see the attempt section): a lost-response duplicate ages out with the retention window                                                                                                              |

### B — content axis × timing axis

|                           | Content                                                                                            | Timing                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| What enters the bundle    | per-source opt-in; text redacted; `report.md` mandatory; screenshot **not** redacted               | chosen on ①, packed on ②          |
| What the user is told     | ①'s verbatim consent copy: on-device redaction, unredacted screenshots, private + 60-day retention | before packing, before upload     |
| What the user can inspect | real manifest with sizes, plus `Show in folder`                                                    | on ②, **before** the upload click |
| What leaves the machine   | the whole zip                                                                                      | on the upload click on ②          |

The third row is why page ② splits packing from uploading. Packing and uploading
on one click would put the real manifest on page ③ — after the fact.

### C — per-source failure × whole-bundle success

A source can be skipped, failed, or truncated while the bundle uploads fine.
Modelled by `AttachmentOutcome`, and visible on page ② before sending.

### D — actor / trust boundary × authorisation and retention

| Actor                           | Holds                    | Must not be able to                                                       |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| Reporter                        | zip, report ID           | —                                                                         |
| Maintainer                      | report ID from the issue | be impersonated by the ID alone: the ID is a lookup key, not a credential |
| Anyone reading the public issue | report ID                | download anything at all                                                  |
| Brevilabs                       | the object               | retain past the stated window                                             |

The third row is what forces the issue to carry an ID rather than any URL: there
is no public download surface for a leaked reference to open.

## Sequencing (historical)

The UI shipped first against a mock uploader on an RFC 2606 `.invalid` host,
behind a human do-not-merge gate — a stub that always succeeds routes users into
an invisible failure, so the gate was the whole protection. That phase is over:
the endpoint exists, the real adapter replaced the mock, and the gate is lifted.
What this branch still needs before release is ordinary verification — the test
suites, the component gallery states, and one real end-to-end upload against the
live endpoint, which a unit suite cannot substitute for.

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
`buildIssueUrl` is load-bearing: the URL may carry an ID, never a payload.

**Presigned download URLs** were the alternative reference shape and are not
used — a presigned GET embeds its own authorisation, so handing one to a public
issue publishes the object. That is why the issue carries an opaque ID with no
download surface behind it, rather than any URL.

## Related

- `1f679e5d` — the Obsidian 1.13 window-teardown fix. Still load-bearing after
  this change: the screenshot step calls `captureBehindOverlay`, and its
  same-window check is what stops dismissing Settings from destroying the
  window the report itself runs in. Do not remove it with the drag.
- `logancyang/obsidian-copilot-preview#250` — frame logs at a predictable temp
  path with default permissions; same privacy axis, different surface
