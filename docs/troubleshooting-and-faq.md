# Troubleshooting Copilot V4

Start in **Settings → Copilot → Basic → Agents** and check the status beside the Agent Chat backend you want to use.

## Agent Chat setup

### opencode shows “Not set up” or “Error”

1. Open **Basic → Agents → opencode**.
2. Open **Configure → Managed by Copilot** and select **Download & install**. If it fails, read the displayed error and retry.
3. If opencode is already installed, open **Configure → My own binary** and select **Auto-detect**. If detection misses it, enter its absolute path and choose **Apply**.

Use **Configure → Managed by Copilot** to reinstall or uninstall it. Setup is complete at **Ready**.

### opencode or Codex shows an update warning, but models are still selectable

Copilot requires opencode **1.18.31 or newer** and Codex ACP **1.12.0 or newer** for both managed and custom installations. Those minimum versions are also the managed download versions in this Copilot release. Saved enabled models stay visible and selectable, but an outdated agent cannot run requests.

1. Select **Configure** in Agent Chat or **Settings → Copilot → Basic → Agents** to open the agent's configuration dialog.
2. For a managed installation, choose the upgrade action or **Download & install**.
3. For a custom installation, update it yourself, then select **Apply** or **Auto-detect** to validate the updated binary. The managed download never replaces a custom Codex adapter, so the Codex dialog offers no upgrade button for one. Updating the Codex CLI alone does not update the ACP adapter.

Opening Configure does not start an upgrade. Chat and Settings keep shared installation progress and errors visible. If installation fails, resolve the reported problem and retry in Configure. Copilot does not upgrade agents automatically or poll for the latest upstream agent release.

### Claude shows “Update required,” cannot be found, or is signed out

- **Update required:** update Claude Code to the minimum version shown by Copilot, then run **Configure Claude → Auto-detect**. For a custom path, update that installation or choose **Clear**.
- **Not found:** run the displayed install command, then choose **Auto-detect**, or enter the absolute path to `claude`.
- **Signed out:** choose **Sign in**. If **Open sign-in page** appears, use it to finish authentication.

Copilot uses your Claude Code login; there is no API key to paste here.

### Codex is installed, but Copilot cannot find it

Copilot connects through `codex-acp`, not the `codex` executable alone. Managed and custom installations require adapter version **1.12.0 or newer**. The managed download is pinned to **1.12.0** in this Copilot release. A custom npm installation must use `@agentclientprotocol/codex-acp` **1.12.0 or newer**, not just a newer Codex CLI. See [Codex installation details](agent-mode-and-tools.md#codex).

1. Open **Basic → Agents → Codex → Configure**.
2. Choose **Download & install** under **Managed by Copilot**. If installation fails, read the error in Configure, fix the reported problem, then retry there. Shared progress and errors remain visible in Settings and Agent Chat.
3. For an adapter you manage yourself, choose **My own binary**, then **Auto-detect** or enter its absolute path and select **Apply**. Use `codex-acp` on macOS/Linux or `codex-acp.exe` on Windows for a native bundle, keeping its companion files in place. For an npm installation on Windows, use the package's `dist\index.js`. Copilot does not update custom Codex binaries.
4. Click **Sign in** and finish authentication in your browser. If it does not open, click **Open sign-in page**. Cancel or retry if needed. Managed Codex includes its runtime; Node.js and npm are not required.

You can also choose **Sign in to Codex** on the Agent Chat status card. For terminal login, run your configured adapter with `cli login` using the same `CODEX_HOME` as Copilot.

See [Getting Started](getting-started.md) for the complete setup flow and [Windows setup for Agent Chat](agent-mode-windows-setup.md) for Windows-specific commands.

## Models, licenses, and API keys

### No models are enabled for Quick Chat

Open **Basic → Agents → Quick Chat**, enable a model, and choose a **Default model**. If none are configured, first add a provider under **Settings → Copilot → BYOK**.

- **Add API key:** edit that provider under **BYOK**.
- **Not offered by agent:** the active agent no longer advertises that saved model. Select one it currently offers.
- A locked Copilot-hosted model requires an active license under **Basic → Copilot License**. **Invalid license key** means that key was not accepted.

Claude and Codex models come from their CLI accounts; BYOK serves opencode and Quick Chat. See [Models](models-and-parameters.md) and [Providers](llm-providers.md).

### Keys disappeared, or “API Key Storage” says “Unavailable”

V4 stores secrets in the Obsidian Keychain.

- **Unavailable:** update Obsidian to 1.11.4 or newer.
- **No API keys found in this device's Obsidian Keychain:** re-enter them. Keys are per device and do not follow a synced vault.
- To remove every stored secret, use **Advanced → API Key Storage → Delete All Keys**.

Do not delete `data.json`: it contains the vault's Keychain namespace. Use the in-app reset; it does not delete Keychain entries.

## Agent Chat is waiting or behaving unexpectedly

### Nothing happens after you send

Look for **Permission required** or **Question from agent**. Review the inputs or diff, then choose an offered option. Another session tab may show an attention indicator.

Permission choices depend on the active agent. **Stop** cancels the current turn, including unanswered requests. Review every persistent permission carefully.

### You cannot switch agents in the current session

An Agent Chat keeps its original backend after work begins. Create an empty chat to choose another. Use **Recent Chats** for earlier work.

### A project message says “Waiting for context”

The message is queued while Copilot prepares saved sources. Fix or remove any source that cannot load. After changing saved context or instructions, start **New Chat**.

See [Projects](projects.md) for what is saved with a project.

### A skill or skill command is missing

In **Settings → Copilot → Skills**, confirm the skill has a valid `SKILL.md` and is enabled for your agent. Toggle the agent off and on to recreate its link.

On Windows, **Windows needs Developer Mode for multi-agent fanout** means you must enable **Settings → Privacy & security → For developers → Developer Mode** (or run Obsidian as administrator), then toggle again. The same repair works when vault sync replaces a link.

Learn more in [Skills across agents](agent-mode-and-tools.md#skills-across-agents).

## Miyo is unavailable or search is not running

Open **Settings → Copilot → Miyo**.

- **Miyo isn't running:** open Miyo, then choose **Retry** beside **Disconnect**.
- **Register this vault with Miyo:** choose **Register & connect** on the same computer. For a remote connection or mobile device, register the vault in Miyo first, then retry.
- **Chat sources are not set up:** this belongs to the separate **Search chat** row and does not block Agent Chat vault search. Configure chat sources only if you want ChatGPT or Claude history search.

Connection alone does not enable Agent Chat search. Under **Powered by Miyo**, turn on **Semantic search for agents**. Copilot installs `miyo-search` for opencode, Claude, and Codex. If Copilot reports a same-name collision, rename or remove the existing Skill and try again.

## Quick Ask does not open or has no model

- **Quick Ask is not available in source mode:** switch the note to Live Preview and try again.
- **No active editor found:** open a Markdown note in an editor pane.
- **No active model configured:** configure and select a default under **Basic → Agents → Quick Chat**.
- **Error generating response. Please try again:** retry once; if it continues, collect a log as described below.

See [Copilot Commands and Quick Ask](custom-commands.md#quick-ask) for selection and note-context behavior.

## Logs and bug reports

Use **Advanced → Debugging & support → Report an issue** for any Copilot problem, Agent Chat or Quick Chat alike. Turn on **Debug Mode** in the same section first and reproduce the problem, so the logs you send actually contain it.

### Filing a report

1. **Describe what went wrong, and tick what to include.** The sources on offer are a screenshot of the Agent Chat pane (only while one is open), the **Agent Mode activity log**, the regular Copilot chat log, and the opencode log when opencode is your backend. Anything you tick that turns out to have nothing to collect is listed on the next page with the reason, so you never have to guess whether it was gathered.
2. **Let Copilot prepare the report.** The review page shows **Preparing report…** until the zip is ready. Copilot briefly hides the dialog to photograph the pane behind it, reads and cleans the logs you asked for, and packs everything into one zip on your own computer — the zip is the only file it writes.
3. **Review what was packed, then upload.** Copilot lists what actually went into the zip, source by source, with the finished file's size and, beside anything skipped or failed, the reason. **Show zip** opens the file in your file manager if you want to look inside. Uploading is a separate click — **Upload & open issue** — and nothing leaves your machine until you press it. **Cancel** here deletes the zip unless you have already chosen **Open issue anyway**.
4. **Finish the issue in your browser.** As soon as the upload lands, Copilot opens a prefilled GitHub issue with the report ID already in the body, closes the dialog, and shows a short notice. If your browser could not be opened, the notice carries the report ID and a link to the issue page instead. Nothing is filed until you press Submit in your browser.

### What gets sent, and what does not

Before anything is written into the zip, Copilot cleans every log and your own description on this device: usernames taken from home-folder paths, email addresses, and recognizable credentials such as API keys and tokens are replaced with visible markers so you can see that something was removed. This is a best-effort pass over the formats Copilot knows, so an unfamiliar secret can still slip through — which is exactly what the review step is for.

**The screenshot is not cleaned at all.** It is a picture, so nothing can be found and removed in it. Look at it before you upload.

A log too large for the report keeps its newest entries rather than being dropped, and the file itself opens with a banner identifying it as a truncated log and naming the original size. Cleaning always runs over the whole log before anything is cut, so a log too large to clean whole (over 64 MB) is left out and listed with that reason.

Only the zip is uploaded, and only to Brevilabs. It carries no license key and no account identity, and it is not tied to your Copilot account. The public GitHub issue carries the report ID and nothing else — there is no download link on it, and nothing on that page can fetch the bundle.

### What the report ID is for

It is the reference a maintainer looks your report up by. It is not a link, not a password, and there is nothing behind it that anyone reading the issue can open. Because it is just a reference, you can also paste it into Discord when you ask for help there, and it points at the same report.

### How long a report is kept

An uploaded report is stored privately and deleted automatically after 60 days. The report ID is in the issue you filed; copy it somewhere else if you may need it after that.

That deletion covers the uploaded copy only. The zip on your own computer is yours; Copilot leaves it alone after an upload or after you choose **Open issue anyway**, so delete it yourself when you are done with it.

### If the upload fails

- **Retry first.** **Retry upload** re-sends the very same file, and it cannot leave you with two copies stored: if the first attempt quietly did land, the retry returns that same report rather than storing another. The error text starts with **Upload failed (HTTP …)** when the server refused the file and says the outcome is unconfirmed when no answer came back; either way a retry is safe.
- **The manual path is always open.** The zip is still on your computer. Use **Show zip** to find it and **Open issue anyway** to file the report by hand — that issue carries no report ID, so attach the zip to it yourself. After choosing **Open issue anyway**, you can close the Copilot dialog without losing the zip, even if your browser did not open.
- **Closing the dialog does not stop an upload.** It finishes in the background; when it lands, a notice shows the report ID and a link to the issue page, and the zip stays where it was.
- **If uploads are turned away because too many were sent recently,** wait a while and try again, or file it by hand. On a shared or office network it may not have been your own uploads that used up the limit.

### Collecting logs by hand

Run **Copilot: Create log file** from the command palette to save the regular chat log into your vault as a note and open it. The Agent Chat log can be opened or cleared under **Advanced → Debugging & support → Agent Mode activity log**.

Logs and screenshots can contain prompts, note contents, paths, and tool inputs. Review them before attaching anything to a public issue.

## What works on mobile?

Agent Chat, including opencode, Claude, Codex, Projects, and Skill execution, is desktop-only. On mobile, use Quick Chat. Agent settings display **Agent settings are available on desktop.** Miyo on mobile requires a remote Miyo connection and manual vault registration in Miyo.

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Copilot Settings](settings.md)
- [Copilot Plans, Privacy, and Self-Hosting](copilot-plus-and-self-host.md)
