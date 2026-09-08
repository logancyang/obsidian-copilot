---
name: openartifacts
description: Publish, update, list, fetch, or unshare OpenArtifacts documents with rendered review before publication.
metadata:
  hermes:
    category: productivity
    tags: [publishing, markdown, artifacts]
---

# OpenArtifacts

## Shared publishing rules

Host adapters follow these rules and replace the standalone CLI
instructions below with their own execution, authentication, document identity,
and approval UI. Never run standalone commands when a host adapter supplies them.

Before every publish or update:

1. Prepare the requested page, preserving the source content. Themes are optional;
   a missing theme must not block publishing. HTML is accepted unchanged, including
   CSS, scripts, forms, frames, and external resources.
2. Present a protected local browser preview before publishing. The review copy
   must block page scripts, network requests, and navigation. This shows the static
   appearance; interactive behavior and external resources are unavailable during
   review. Never open the unrestricted source HTML as a fallback. Showing source,
   a path, or a summary does not count as a rendered preview. If the protected
   preview cannot be presented, stop; never publish to obtain a preview.
3. Wait for the user's explicit approval of the displayed page. The initial publish
   request and sign-in approval do not replace review. Hosts may enforce approval
   in an existing confirmation dialog. Never simulate the user's confirmation.
4. Publish the original reviewed HTML, without the preview's restrictions or shell.
   If the content changes, generate and present another preview and obtain fresh
   approval. Host branding may be added by the publishing integration; OpenArtifacts
   serving decorations need not appear in the local preview.

Preserve source identity so repeat publishing updates the same document. Keep the
prepared artifact on cancellation or failure so review can be reopened. Hosts may
remove temporary staged copies after confirmed success or explicit discard, but
must retain the original source document. Return only the successful publisher's
public URL. A pending review is not a successful publish.

Report actual failures without guessing causes, removing styling, bypassing review,
or blindly retrying. If an update returns `not_found`, stop; do not create a replacement
without the user's explicit request. For `quota_exceeded`, report whether to wait or
remove an unused document. For `limit_reached`, show the supplied limit and upgrade
link, and retry only after the user confirms the limit changed. Do not read credential
files, print tokens, or ask the user to copy credentials.

## Standalone CLI

This section applies only when no host adapter supplies execution instructions.
Use `openartifacts` when installed, otherwise `npx --yes openartifacts@latest`.

- Preview Markdown or HTML locally: `openartifacts preview <file>`
- Publish Markdown or HTML after review: `openartifacts publish <file>`
- List documents: `openartifacts list`
- Fetch current HTML: `openartifacts get <docId>`
- Withdraw a document: `openartifacts unshare <docId>`
- List machine tokens: `openartifacts tokens`
- Revoke one: `openartifacts revoke <tokenId>`
- Sign in again after an `unauthorized` response: `openartifacts login`


Run `openartifacts preview <file> > <separate-review.html>`. Never overwrite the
source. The command runs without authentication and prints the reviewed HTML's
SHA-256 to stderr. Open the protected review file in a user-visible browser and
wait for explicit approval. If `preview` is unavailable, use a release supporting
it or stop. After approval, run
`openartifacts publish <original-file> --reviewed-sha256 <printed-hash>`.
A changed source is rejected before authentication or upload; preview it again.
Keep the original source path so repeat publishing preserves document identity.

The first authenticated command may wait for browser sign-in approval. Relay both
sign-in URLs and the user code printed by the CLI, then keep waiting. Browser
sign-in is separate from approval of the rendered page.

Markdown uses ordinary Markdown rendering; Obsidian wikilinks, embeds, and callouts
are not expanded. If the user explicitly requests a replacement after `not_found`,
run `openartifacts unshare <oldDocId>` to forget the stale local mapping, then repeat
preview, approval, and publishing. Never take that recovery path automatically.
