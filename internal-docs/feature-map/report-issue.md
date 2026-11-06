# Report an issue

Sending the team a report with diagnostics from inside Copilot.

## Sub-features

- report-open: `Report an issue` from `More actions` in the [chat controls](chat-controls.md), from Settings → Advanced, or `Review & report` on a feedback card in [decision cards](decision-cards.md).
- report-describe: `What went wrong?` takes the user's description, filled in with the chat's details when opened from a chat.
- report-attachments: choose `Screenshot of the Obsidian window`, `Agent activity log`, `Copilot log`, and, for OpenCode, `OpenCode log`.
- report-review: `Prepare report` lists the `Report contents`; `Show zip` reveals the file.
- report-upload: `Upload & open issue` uploads the report and opens a GitHub issue in the browser with its report ID.
- report-retry: when the upload fails, `Retry upload` or `Open issue anyway`.
- report-desktop-only: on mobile, "Reporting an issue is available on desktop only."

Only the sub-features are mapped so far, and they may not cover everything this feature does. To map the rest, follow [`FEATURE_MAP_GUIDE.md`](../FEATURE_MAP_GUIDE.md).
