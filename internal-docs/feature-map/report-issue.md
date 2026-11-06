# Report an issue

The `Report an issue` dialog: the user describes what went wrong, picks diagnostics to attach, reviews the zip, and uploads it to the Copilot team with a prefilled GitHub issue.

## Sub-features

- report-open: `Report an issue` from `More actions` in the [chat controls](chat-controls.md), from Settings → Advanced, or `Review & report` on a feedback card in [decision cards](decision-cards.md).
- report-describe: `What went wrong?` takes the user's description. Opened from a chat, it starts with the chat's agent, model, and session; from a feedback card, with the agent's draft; from Settings, empty.
- report-attachments: choose `Screenshot of the Obsidian window`, `Agent activity log`, `Copilot log`, and, for OpenCode, `OpenCode log`. Opened from a chat or a feedback card, every attachment starts ticked.
- report-notice: `Before you upload` says what is redacted, that screenshots are not, and that reports are private and deleted after 60 days.
- report-review: `Prepare report` lists the `Report contents`, each file with its size, and the zip; `Show zip` reveals the zip; `Cancel` discards it.
- report-upload: `Upload & open issue` uploads the report and opens a GitHub issue in the browser with its report ID.

## How to get to it (user POV)

- `More actions` → `Report an issue` in the [chat controls](chat-controls.md), once the chat has a message.
- Settings → Copilot → Advanced → Debugging & support → `Report an issue`.
- `Review & report` on a `Report this to the Copilot team?` card in [decision cards](decision-cards.md).

## Driving it

- Open from a chat: in a chat with messages, choose `More actions` → `Report an issue`. The dialog opens with `Evidence: backend <agent> · model <model> · session <id> · <time>` under `What went wrong?`, and `Screenshot of the Obsidian window`, `Agent activity log`, and `Copilot log` ticked.
- Open from Settings: choose `Report an issue` in Settings → Advanced. `What went wrong?` is empty.
- Open from a feedback card: choose `Review & report`. `What went wrong?` holds the agent's draft: title, what happened, what the user said, and steps.
- Notice: the dialog shows `Before you upload` above `Cancel` and `Prepare report`.
- Describe and review: type a description and choose `Prepare report`. `Report contents` lists report.md, screenshot.png, copilot-log.md, and acp-frames.ndjson.txt with sizes, then the zip, with `Cancel`, `Show zip`, and `Upload & open issue`.
- Show zip: choose `Show zip`. The file manager opens at the zip.
- Cancel: choose `Cancel` on the review screen. The dialog closes.
- Upload: choose `Upload & open issue`. "Uploading — this can't be canceled…" shows, then the browser opens a prefilled GitHub issue with the report ID, and a notice reads "Report uploaded. Finish the issue in your browser."

## Gotchas

- Closing the dialog on the review screen deletes the prepared zip. Only a zip that is uploading stays on disk.
- A report sent from a feedback card turns that card into `Report sent to the Copilot team`. A report sent from `More actions` or Settings leaves the card as it was.
