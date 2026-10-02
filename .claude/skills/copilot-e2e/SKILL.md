---
name: copilot-e2e
description: |
  Exercise a Copilot PR in real Obsidian against a fresh fixture vault and emit
  one ready-gate e2e gate object (JSON) with screenshot evidence. Use when the
  ready gate or a human asks for e2e1 / e2e2 on a PR or branch, or says "run
  e2e on this PR".
allowed-tools:
  - Bash
  - Read
  - Write
---

# `/copilot-e2e`

Inputs: a PR number (default: the current branch's PR) and a mode, `e2e1` or
`e2e2`. `e2e1` may fail so the caller can fix; `e2e2` is pass-only, and a
failure goes to a human.

Driving Obsidian (CLI, `vault=<name>` on every call, screenshots, `dev:errors`)
is documented in [`TESTING_GUIDE.md`](../../../designdocs/agents/TESTING_GUIDE.md).
This skill adds the run procedure around it. Mechanics live in
`scripts/e2e/copilot-e2e.sh`; call it as `E2E=scripts/e2e/copilot-e2e.sh`.

## Procedure

1. **Lock.** `RUN=<pr>-<mode>-$$; $E2E lock $RUN` (exit 75 means another run
   holds it: wait, do not proceed). Release with `$E2E unlock $RUN` on every
   exit path, including failure.
2. **Plan.** Read the PR (`gh pr view <n> --json body,headRefOid`) and its
   linked issue's success criteria. Build a checklist from the issue criteria
   plus the PR's `## What` and `## Verification`: each line is a user action
   and an observable expected result. A PR with no user-visible surface gets no
   checklist; go to step 7 with an `na` reason ("no user-visible surface:
   <why>").
3. **Build and fresh vault.** In the PR's worktree at the head SHA:
   `npm run test:vault`, then `$E2E vault-reset` (replaces the vault's content
   with `scripts/e2e/vault-template/`; keeps the deployed plugin; refuses a
   vault without the `.copilot-e2e-vault` marker), then
   `npm run test:reset-data`. Run the preflight from the testing guide and
   confirm `buildTag` matches the head SHA.
4. **Keys.** Only when the plan needs a live model. Set
   `COPILOT_E2E_SECRETS` to whitespace-separated
   `<apiKeyKeychainId>=bws:<secret-name>` or
   `<apiKeyKeychainId>=keychain:<service>` entries (names come from the
   environment, never from this repo), add a provider referencing that
   `apiKeyKeychainId` in the plugin's `data.json`, then `$E2E inject-keys`.
   This writes into Obsidian's SecretStorage, the plugin's own mechanism. Never
   print, log, or screenshot a value.
5. **Run.** `obsidian vault=<name> dev:errors clear`, then execute each
   checklist line through the CLI (`eval`, `dev:dom`, `command`,
   `plugin:reload`); use computer use only when the CLI cannot reach it. After
   each line take a screenshot (`dev:screenshot`) or a DOM assertion. Use a
   recording (the `screen-recording` skill) only when motion is the point.
   Finish with `dev:errors`; it must be empty.
6. **Evidence.** Never capture settings panes or key fields; navigate away or
   crop before capturing. Every file passes
   `$SKILLS/skills/screen-recording/scripts/scan-secrets.sh <file>` before
   upload, with `SKILLS=~/.cache/brevilabs-skills/current`. If that script is
   not installed, stop and report it; do not upload unscanned files. A hit
   blocks the upload and goes to the human. Upload with
   `$SKILLS/skills/screen-recording/scripts/upload-attachment.sh <file> logancyang/obsidian-copilot`
   and record the returned URL on the checklist line. Dry runs use
   `Brevilabs/obsidian-copilot-private` as the anchor instead.
7. **Output.** Write the checklist as JSON
   (`[{"step","expected","status","evidence":[url]}]`) and run
   `$E2E gate --out <file> --sha <head sha> --checklist <checklist.json> [--errors-clean false] [--video <url>]`,
   or `--na-reason "<reason>"` for `na`. The script derives `status`, rejects
   non-GitHub-attachment evidence, and prints the path of the file holding the
   single gate object. Report that path and the JSON.
8. **Unlock** (see step 1).
