# Agent Chat

Agent Chat is the default Copilot experience on desktop. It gives an AI agent a working view of your vault so it can answer questions, use tools, and make permissioned changes while you follow the work in chat.

Agent Chat follows a growing response until you scroll up to read earlier messages. Select the round down-arrow near the bottom of the chat, or scroll to the end, to follow new output again.

Quick Chat remains available for lightweight conversation and is the main chat experience on mobile. For multi-step work, Projects, Skills, or file changes, start with Agent Chat.

Your sent messages display Markdown formatting, including headings, lists, code blocks, links, and image embeds. Copy and Edit keep the original Markdown text. Links and image embeds in saved chats resolve from the conversation note, even when another note is open.

## Choose an agent

Open [**Settings → Copilot → Basic → Agents**](settings.md#basic). Configure at least one agent, then choose the **Default backend** for new chats.

| Agent        | Best starting point                             | Where model access comes from                                              |
| ------------ | ----------------------------------------------- | -------------------------------------------------------------------------- |
| **opencode** | Recommended for most people                     | Copilot-hosted models, your API providers, or local OpenAI-compatible APIs |
| **Claude**   | You already use Claude Code                     | Your Claude Code installation and Anthropic account                        |
| **Codex**    | You already use the Codex CLI and Codex account | Your Codex CLI login through the `codex-acp` adapter                       |

For opencode and Codex, **Managed by Copilot** uses the version Copilot tests. **My own binary** remains available, but other versions may not work correctly with Copilot. The Configure dialog reminds you of this when you choose your own binary.

A one-agent chat can work without a Copilot license when you bring your own model access. An eligible paid plan adds Copilot-hosted models and cloud-backed features. [Compare Copilot plans](copilot-plus-and-self-host.md).

### opencode

opencode is the most flexible choice because it can use Copilot-hosted, BYOK, and local models.

1. In the **opencode** tab, open **Configure**, choose **Managed by Copilot**, then click **Download & install**. Progress shows elapsed time while connecting, downloaded bytes during transfer, then extraction, verification, and activation.
2. If you already installed it, choose **My own binary** in **Configure**, then select **Auto-detect** or enter the absolute path and click **Apply**.
3. Enable the models you want to see and choose a **Default model**.

Managed installs download and verify a pinned OpenCode release directly. You do not need to install npm, Bun, Node, or a separate archive tool. Copilot accepts your own OpenCode 2.0.21 or newer binary.

If OpenCode's internal service stops responding, Copilot refreshes it. The failed turn explains the problem; send the message again when the agent is ready. If OpenCode cannot reopen the conversation, Copilot starts a new chat. If the service fails before it answers any chat, Copilot stops retrying and shows the error; check the Copilot log for the cause.

There are three ways to provide model access:

- **Copilot-hosted:** add your license under **Basic → Copilot License**. Models included with your plan appear automatically.
- **Your API key:** open [**Settings → Copilot → BYOK**](settings.md#byok), add a provider, and configure its models. Copilot stores supported secrets in the Obsidian Keychain.
- **Local:** add an OpenAI-compatible endpoint from software such as Ollama or LM Studio under **BYOK**.

### Claude

The Claude backend runs through Claude Code on your computer:

1. Open **Basic → Agents → Claude → Configure**.
2. Select **Auto-detect**, or enter the absolute path to the `claude` executable.
3. Select **Sign in** if Claude Code is not already authenticated, then finish in your browser. If the page does not open, select **Open sign-in page**. You can cancel and try again.
4. Enable the models you want and choose a default.

Claude Code stores the credentials on your computer. Copilot checks its sign-in status when the login finishes. To run the login command yourself, use **Sign in using a terminal instead**.

Claude models and billing come from your Claude Code account. Models added under **BYOK** do not join the Claude model list.

### Codex

The Codex backend uses `@agentclientprotocol/codex-acp`, which includes a compatible Codex CLI:

Managed Codex downloads use the adapter version pinned by Copilot. Copilot uses the system `tar -xf` command to unpack the runtime on all supported desktop platforms:

| Platform | Download format | Extraction                                                         |
| -------- | --------------- | ------------------------------------------------------------------ |
| Linux    | `.tar.gz`       | System `tar`, compatible with GNU tar.                             |
| macOS    | `.zip`          | Built-in `tar`, which uses bsdtar and supports ZIP extraction.     |
| Windows  | `.zip`          | Built-in `tar.exe`, which uses bsdtar and supports ZIP extraction. |

The archive format and extraction command are separate: bsdtar can unpack ZIP files, while GNU tar does not support ZIP. See [bsdtar's supported formats](https://github.com/libarchive/libarchive/blob/master/tar/bsdtar.1) and [Windows tar documentation](https://learn.microsoft.com/en-us/windows/tar/). Windows includes `tar.exe` starting with Windows 10 version 1803. If installation reports that `tar` is missing, install it and retry; on macOS or Windows, use bsdtar so ZIP extraction works.

For an existing or manually installed `@agentclientprotocol/codex-acp` adapter, Copilot checks compatibility and reports any required update in **Configure**. The adapter version and bundled Codex CLI version are separate.

1. Open **Basic → Agents → Codex → Configure**.
2. Choose **Download & install** under **Managed by Copilot**. Copilot shows elapsed time while connecting, downloaded bytes during transfer, then labels extraction, verification, and activation while it prepares Codex. It keeps your current installation until the replacement is ready. You do not need Node.js or npm.
3. Click **Sign in**, finish authentication in your browser, and return to Obsidian. If the browser does not open, click **Open sign-in page**. You can cancel or retry sign-in. Existing credentials are reused when you use the same Codex profile.
4. If you prefer your own adapter, use **My own binary** to Auto-detect it or enter its absolute path. You remain responsible for upgrades to that binary.
5. Enable the models you want and choose a default.

The **Authentication** section shows your signed-in ChatGPT email and plan when Codex provides them. Select **Sign out** beside the account to switch accounts. API-key authentication and accounts without an email show the signed-in badge without an email. An installed agent shows **Sign in required** until it is authenticated.

You can also choose **Sign in** on the Agent Chat status card. For terminal login, run your configured adapter with `cli login` using the same `CODEX_HOME` as Copilot.

Switching to your own Codex binary removes unused managed downloads. Your custom binary and account credentials remain on your computer. Cancel is available during downloads; configuration changes finish before another action can start.

If your adapter is below the supported minimum, select **Configure** in Settings to manage it. Agent Chat also offers **Upgrade**, with shared progress and errors. Copilot uses the login stored by the bundled Codex CLI. Models added under **BYOK** do not join the Codex model list.

For Windows-specific installation help, see [Windows setup for Agent Chat](agent-mode-windows-setup.md).

### Start a chat

Select the **Agent Chat** ribbon icon or run **Open Copilot Agent Chat Window** from the command palette. From an open note, select the Copilot icon beside the note's view controls to open Agent Chat with that note attached to your next message. If Agent Chat is already open, the icon brings it into view; otherwise, it opens in the right sidebar. If the default agent is missing, its custom binary is outdated or unusable, or it is not signed in, Copilot opens **Select your agent** with the reason and a **Configure** action. You can also choose another working agent and select **Start chat**. If an agent is still starting, wait for that launch to finish before starting another agent. **Configure** remains available while you wait. If you already have a chat open, Copilot keeps the conversation and your unsent draft visible and shows a warning above the chat.

An empty Agent Chat shows a fixed hint: "Ask anything • @ to add context • / for commands".

Agent Chat groups consecutive tool calls and reasoning into a compact activity row. The row reports the total tool commands, distinct files read or edited, and recorded reasoning time. Open it to inspect every step.

Copilot checks for updates in the background when the plugin loads, including when Obsidian starts. If a newer version is available, a notice offers **View release notes** once per release. This is remembered separately from dismissing the Agent Chat home banner. You can keep using or close Obsidian while the check runs. Copilot reads the version from the published release’s manifest, and Settings and Agent Chat share that check.

Copilot also checks for the latest release whenever you create a new Agent Chat tab with **+**, so you can discover updates without reloading the plugin. When a newer Copilot release is available, the global Agent Chat home shows an update banner along the bottom of the pane. The banner stays above the home tabs when space is tight. Select **See what’s new** to read the release notes, or dismiss the banner for that release. When the release has a demo video, the banner also shows its thumbnail; select it to watch the video. Project homes and active conversations do not show it.

The release notes open with the newest release. If you skipped earlier stable releases, their notes follow below it, newest first, so you can catch up on every change since your installed version. The dialog shows up to ten releases and leaves out prereleases. If GitHub’s release list can’t be loaded, only the newest release appears.

## Models, effort, and permissions

Each agent has its own model list. The models shown in one agent do not automatically appear in another.

- Set the model and effort used by new chats under [**Settings → Copilot → Basic → Agents**](settings.md#basic).
- Use the controls beside the composer to change the model or effort for the current chat.
- Before the first message, choosing a model from another installed agent switches the empty chat to that agent. Once a conversation has started, it stays with its agent.
- **Effort** appears only when the selected agent and model support it. Higher effort can improve difficult reasoning but may take longer and use more of your account allowance.
- Models with effort controls always use a concrete effort. A supported saved effort is kept; otherwise Copilot chooses the lowest supported effort and updates the saved default. Models without effort controls omit effort. **Agent default** clears the saved model preference; the new session shows the agent's model and its resolved effort.
- Reloading an agent keeps each open chat's model and effort. If that model is no longer enabled for the agent, or is still waiting for its API key, the chat falls back to your saved default, or to one of your enabled models.

The permission picker shows only choices supported by the current agent:

| Choice   | What it does                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------- |
| **Safe** | Allows edits under the agent's approval rules                                                        |
| **Plan** | Drafts a plan and waits for your approval before editing when the current agent supports this choice |
| **Auto** | Reduces approval prompts according to the current agent's automatic permission rule                  |

opencode supports **Safe** and **Auto**. Claude supports **Safe**, **Plan**, and **Auto**. Codex shows the choices supported by the installed adapter. Claude also has an **Auto mode permissions** setting that controls how much Auto may approve.

With Codex, **Safe** uses the adapter's **Ask for approval** preset. It can edit files in the working directory; the adapter asks before editing external files or using the internet. **Auto** uses automatic review within the same workspace-write sandbox, without enabling full access. **Plan** uses Auto's approval preset while Codex drafts a plan and waits for your approval. Once you approve it, Codex continues in **Auto** mode to implement the plan.

When Codex presents a plan, you can **Approve** it, **Reject** it, or type feedback in the plan card. Feedback starts a new chat turn so Codex can revise the plan; review the new proposal before approving it. If you ask Codex to save the plan to a note, approve the revised plan to let it create the note.

When an action needs approval, Agent Chat displays a **Permission required** card with the proposed change or tool input. Choose one of the temporary or persistent allow or deny options offered by that agent. The one-time allow is highlighted. Hover an "always" option to see what it covers and how long it lasts: Claude names its rule and the settings file it saves to, and Codex and opencode say when they save a rule for later chats. Claude offers "Allow always" only when it has a rule to save. Stopping the turn cancels unanswered requests.

When Claude or Codex asks a set of questions, answer the current tab and select **Next**. On the final tab, **Submit** becomes available after every question has an answer. You can use the tabs to review or skip ahead. **Cancel** dismisses the entire request. If Codex withdraws or times out the question, its card disappears.

Codex can ask questions while the permission picker is on **Safe**, **Plan**, or **Auto**. You do not need to switch to Plan to answer a question.

OpenCode does not show question cards yet. If it asks a clarifying question in chat, answer in the message box.

Permission and question cards stay in a scrolling action area above the message box until you answer them, even while the response continues streaming.

Your vault or project is the agent's working directory, not a security sandbox. Auto or bypass permissions can reach other files and services available to the agent or your account. Use **Safe** for unfamiliar work and review persistent permissions carefully.

## Context and history

Agent Chat keeps each conversation separate:

- Select **+** for another session. Each tab keeps its own history, draft, attachments, and queued follow-ups.
- Select **New Chat** to reset the current tab.
- Select **Stop** to cancel the current turn. Queued follow-ups return to the message box, with their notes, web pages, agent mentions, and images, so you can edit or resend them. Queued content comes before the current draft, and custom commands return as their expanded text.
- Use **Recent Chats** from the Agent Chat home screen, or **Chat History** inside a conversation, to resume saved work. The **Recent Chats** list can be scrolled or searched.
- Hover a chat in **Recent Chats** and select **Pin chat** to keep it at the top of the list, above a divider. The most recently pinned chat comes first, and pinned chats keep their order when you use them or change how history is sorted. Select **Unpin chat** to return it to its usual place. The pin is saved in the chat's Markdown note, so it lasts across restarts and appears in both the global and the Project list. Pinning a chat that has no note yet saves it as a note first, even when autosave is off. **Chat History** inside a conversation ignores pins.
- The bar above the composer holds **New Chat**, **Chat History**, and **More Actions** (⋯). **More Actions** has **Copy chat link**, **Add to bookmarks**, **Report error**, and, when autosave is off, **Save chat as note**. **Copy chat link** and **Add to bookmarks** stay dimmed until you send the chat's first message.
- To bookmark the open chat in Obsidian's **Bookmarks** pane, select **More Actions** above the composer and choose **Add to bookmarks**. To bookmark a chat without opening it, hover it in **Recent Chats**, select **More actions** (or right-click the row), and choose **Add to bookmarks**. The bookmark uses the chat's title, and clicking it opens the chat in Agent Chat. A chat that has no note yet is saved as one first, even when autosave is off. Choose **Remove from bookmarks** to remove it. Deleting the chat from **Recent Chats** also removes its bookmark, while renaming the chat keeps the bookmark's title. While the **Bookmarks** core plugin is turned off, **Add to bookmarks** is dimmed, with an info icon explaining why. Selecting it opens **Settings → Core plugins** filtered to **Bookmarks** so you can turn it on.
- Select **More Actions** above the composer and choose **Report error** to open **Report an issue** for the current chat, with its screenshot and agent details ready. See [Reporting from Agent Chat](troubleshooting-and-faq.md#reporting-from-agent-chat).
- Select **More actions** above the composer and choose **Copy chat link** to copy an `obsidian://` link to the current conversation. Paste it into another note to reopen the chat in the same vault. The link points to the conversation's Markdown note, so Copilot saves the note first if it does not exist yet, including when autosave is off. The link keeps working after the note is renamed. To copy a link without opening the chat, hover it in **Recent Chats**, select **More actions**, and choose **Copy chat link**. A chat that has no note yet is saved as one first.
- Properties you add to an Agent chat note stay when Copilot saves the chat again. Copilot updates only the properties it manages: the agent, session, project, token usage, and tags.
- A spinner marks a chat while its agent is responding. When the response stops but the session remains live, a small blue dot appears on the bottom-right corner of the chat icon. Hover the row and select **Close session** to release that session. Saved history stays available to reopen, and other chats keep running. If the agent does not support closing individual sessions or release fails, the chat stays marked live with an error.
- Deleting an Agent chat removes Copilot's chat note and its entry in Copilot's chat history. Claude Code, Codex, and opencode may keep their own copy of the conversation on your computer. Copilot does not delete or change those files, so you can still resume the chat in that agent's own tool. The confirmation and the notice after the delete both say this. Deleting an open chat closes it and stops any reply in progress.
- Add the active note, selected text, other notes, folders, a Copilot Web Viewer tab, or supported images. You can also mention a note with `[[Note title]]`.
- Hover the context ring beside the send controls to see how much of the model's context window is in use. The ring stays empty until the agent reports usage, and a stopped response keeps the last reported reading. If the connected account reports usage limits, the same panel shows the available limit and reset time.

You can send an image without adding text, for example when the agent asks for a screenshot. Choose a model that supports images.

Attachments apply to the next message. For instructions and context that should be reused, create a [Project](projects.md) or add rules to [`AGENTS.md`](system-prompts.md). See [Context and Mentions](context-and-mentions.md) for every context option.

Uploaded images are embedded in saved conversation notes. Copilot stores the image files under `<Copilot folder>/copilot-conversations/attachments/`, not in your vault attachment folder, and saves each unique image once per conversation. Identical images in the same conversation reuse the saved attachment, including when it has been deleted. Later saves preserve attachment links updated by Obsidian or an attachment organizer; deleting a saved attachment leaves a missing image instead of recreating the file.

Type `/` to insert an enabled Skill or [Copilot command](custom-commands.md). For a quick question or rewrite beside the current selection, use [Quick Ask](custom-commands.md#quick-ask).

### Compact a long chat

When a conversation grows long, choose **/compact** at the start of an empty message to have the agent summarize it and free up room in its context window. The `/` menu offers **/compact** only at the start of a message, and it replaces any Skill or command named exactly `compact`. Anything you type after `/compact` is sent with it, so an agent that accepts compaction instructions, such as Claude, can use them.

- Attached notes, web pages, images, and agent mentions are not sent with `/compact`. Project context waits for your next regular message.
- A queued `/compact` runs as its own turn instead of joining other queued messages. If you stop the current turn, the other queued messages return to the message box without it.

Agents also compact on their own when the context window fills up. Either way, the chat shows the progress in line with the conversation:

| Status                                                       | Meaning                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Compacting conversation…**                                 | The agent is summarizing the chat after **/compact**                                                 |
| **Context is full, compacting…**                             | The agent started compacting on its own                                                              |
| **Context compacted** or **Context compacted automatically** | The summary is done. When the agent reports them, the token counts before and after follow the label |
| **Couldn't compact**                                         | Compaction failed. The reason appears with the row or below it                                       |
| **Compaction cancelled**                                     | You stopped the turn before compaction finished                                                      |
| **Nothing to compact yet**                                   | The chat is too short to summarize                                                                   |

When a finished compaction reports its new size, the context ring drops to that size instead of keeping the reading from before it.

Reopening a Codex or opencode chat from chat history shows its past compactions again, each in the place it happened. A compaction that never finished shows as **Compaction cancelled**. Reopening does not change the context ring.

### When a reply stops early

A model can only write so much in one reply. When a reply runs out of room partway through a step, such as writing a long note, that step never runs. Its row shows as failed instead of spinning, and Copilot asks the agent once, in the same reply, to continue in smaller steps. Copilot never continues a turn you stopped or one the model refused, and it continues only once per message.

If the reply still stops early, it ends with a **Stopped early** notice that names the cause: the model hit its output limit, the agent hit its step limit, or the model's safety system stopped it. The last step may not have run. Send another message to continue.

Any step the agent left unfinished when its turn ended shows as failed, including in chats you reopen from history.

## Review what a turn changed

When a turn finishes after the agent has edited your vault, a **Files changed** card closes that turn. It lists one row per note, with the number of added and removed lines, and a **new** or **deleted** badge for notes the agent created or removed. The card totals the changes in its header and scrolls when a turn touched many files.

Select a row to open that note's before and after as a single tab. Removed text is struck through, added text is highlighted, and everything else reads as the note normally does, so you can see the exact wording the agent changed without leaving Obsidian. The tab is read-only and never writes to your vault; use **Open note** in its header to open the note itself and edit it there. Files that are not notes, such as canvases, are shown as a plain line-by-line comparison.

In a long note, a narrow strip along the left edge of the tab shows where the changes are. The strip stands for the whole note, with one mark for each change at its position in the note: green where text was added, red where it was removed, and blue where both happened. Select a mark to jump to that change.

The header shows which change you are at, such as "1 of 6". Use the up and down arrows beside it to move to the previous or next change; moving past the last change returns to the first. The **Go to next change in file diff** and **Go to previous change in file diff** commands do the same, so you can assign them hotkeys in Obsidian's settings.

Selecting the same row again returns you to the tab that is already open. This review is part of the current session only: closing Obsidian or reloading the plugin drops the cards and the diff tabs, and earlier turns show no card when you reopen a saved conversation.

The card covers the notes an agent changed with its editing tools. Changes an agent makes by running a shell command, such as deleting a note with `rm`, are not listed. Treat the card as a review aid rather than a complete audit of the turn.

## Multi-agent answers

With active Plus access, type `@`, open **Agents**, and mention one or more other installed agents in the same prompt. Copilot sends the same question, that turn's attachments, and a bounded slice of the visible conversation to each mentioned agent. With one other agent mentioned, only that agent responds and its answer is shown directly. With two or more, they answer in parallel and the current agent summarizes their answers without producing a separate answer of its own.

This is useful for research, second opinions, and reviews. Mentioning only the current agent behaves like a normal turn.

Each answer appears in its own tab. A direct one-agent turn shows only that agent. A turn with two or more answerers opens with **Summary** first. If one answerer fails in a multi-agent turn, Copilot keeps the successful answers and summarizes what completed.

Multi-agent answers are designed for read-only research, not edits. Copilot denies explicit vault edit, delete, and move tools, along with tools it cannot classify. Retrieval Skills can still run their own scripts under the agent's permissions, so multi-agent answers are not a security sandbox. Use only trusted Skills, and use a regular single-agent turn when you want files changed.

The default model and effort saved for each mentioned agent are used for its answer. If a multi-agent summary fails, its tab shows the error and any partial summary; the individual answers remain available. If an agent is not installed or ready, configure it before adding it to the prompt.

## Skills across agents

Skills are reusable instruction packets built around a `SKILL.md` file. One Skill can be made available to opencode, Claude, and Codex without maintaining three copies.

1. Open [**Settings → Copilot → Skills**](settings.md#skills).
2. Find a Skill and toggle the opencode, Claude, or Codex icons for the agents that should use it.
3. Type `/` in Agent Chat to choose it, or describe the task and let the agent select an enabled Skill.

Shared Skills live under `<Copilot folder>/skills/`. Copilot links them into the native folders used by each agent: `.opencode/skills/`, `.claude/skills/`, and `.agents/skills/`. Skills already present in those native folders also appear in the settings list.

The **Built-in Skills** table contains Copilot's bundled skills with read-only previews. Turn off a whole skill to remove its generated files, or turn off an individual agent to exclude it. These choices survive restarts and updates. Copilot generates built-in skills only when an available agent can use them. Setting up another agent enables eligible built-ins for that agent unless you previously opted out. Your own skills remain editable in **Your Skills**.

Custom Skills and built-in Obsidian Skills are free. Active Plus access adds cloud-backed Skills for web research, YouTube transcripts, X posts, and OpenArtifacts.

The web search and web fetch Skills (`copilot-web-search` and `copilot-web-fetch`) start turned off in new installs, so agents use their own web tools. Turn them on in **Built-in Skills** to route those requests through Copilot instead.

While **Miyo document processing** is on, which is the default, **Built-in Skills** also lists `miyo-parse`. It parses a PDF or EPUB on your computer with the local Miyo command-line tool and does not need Plus access. If Miyo cannot parse a file, the agent tells you and reads the file with its own tools. Turning **Miyo document processing** off removes the Skill, and agents read documents with their own tools.

Built-in skill preferences record only the skills and agents that are turned off. New skills use the defaults, and content updates keep your saved choices. Copilot fully manages built-in skill folders. Updating a built-in skill replaces its entire folder; removing it deletes the folder. Both operations remove any files you added inside it. Keep custom skills and files in separate folders. When a skill is retired, Copilot also clears its saved preferences. A renamed skill starts with fresh defaults. If file permissions prevent removal, Copilot reports the failure and keeps your disabled preference. After you restore access, Copilot retries cleanup when skills refresh or the plugin reloads.

In Self-Host Mode with OpenCode selected, Agent Chat's built-in web-search Skill uses the search provider selected under **Settings → Copilot → Self-Host**. Provider credentials stay inside Obsidian rather than being passed to OpenCode, and the feature does not require Obsidian's command line interface. Copilot disables OpenCode's native web-search and web-fetch tools so they cannot bypass that route. Full-page web fetching is unavailable through OpenCode in Self-Host Mode because the supported search providers do not share a page-fetch interface; Agent Chat can still use the configured provider's search results. If the web-search Skill is turned off, turn on `copilot-web-search` in **Built-in Skills** to give OpenCode web search in Self-Host Mode.

If you set a custom `OPENCODE_CONFIG_CONTENT` for OpenCode, Self-Host Mode adds final deny rules for the native web tools in its top-level and per-agent `permissions`. Other permission rules in your custom configuration remain in their original order. Self-Host Mode does not start OpenCode with a custom configuration that uses the OpenCode 1 `permission`, `tools`, `agent`, or `mode` keys; write those settings as OpenCode 2 `permissions` and `agents` instead.

On Windows, creating the folder links may require **Developer Mode** or administrator access. If a sync service replaces a link, toggle that Skill off and on for the affected agent to recreate it.

## Applying a settings change

Agents read their configuration when they start: API keys, enabled models, instructions, and skills. A change you make while a chat is open does not reach the agent already running. Agent Chat says so with a **config has changed** notice and a **Reload** action, and the chat keeps working in the meantime.

The notice names the agent that needs to reload. Changing Claude's enabled models does not ask you to reload OpenCode. Settings an agent can apply without restarting do not need a reload notice.

Choose **Reload** when you want the change to take effect. The agent restarts and reopens every chat using that agent, keeping each chat’s history and anything you had typed but not sent. During a running turn the reload waits for that turn to finish. If the agent cannot reopen a conversation, that tab starts a fresh chat and the old one remains under Recent Chats. If a chat failed to start, correct its settings and choose **Retry** to apply them.

Turning on Self-Host Mode never waits: it restarts the agent straight away, so no later step in the conversation can browse outside the new boundary. Changes to Miyo's **Search scope** and to the Miyo folders ticked under **Current vault** apply to the agent's next search, with no reload.

## Related

- [Getting Started](getting-started.md)
- [Models, Effort, and Permissions](models-and-parameters.md)
- [Projects](projects.md)
- [Instructions for Agent Chat and Quick Chat](system-prompts.md)
- [Copilot Commands and Quick Ask](custom-commands.md)
- [Copilot Plans, Privacy, and Self-Hosting](copilot-plus-and-self-host.md)

### Publishing from Agent Chat

Copilot ships an `openartifacts-publish` skill to Claude Code, Codex, and OpenCode. Publishing needs a Copilot Plus license key in Copilot settings. Copilot passes that key to the agent process, and the skill's bundled wrapper script sends it to `api.openartifacts.ai` over HTTPS. The wrapper needs only the shell tools already on your system: `sh`, `curl`, and `awk` on macOS and Linux, PowerShell on Windows.

Ask the agent to publish a Markdown note or an existing HTML file. For Markdown, it renders the note to HTML, using the note's file name without `.md`, converted to title case, as both the browser title and a visible heading above the note body. If the note already starts with the same heading, Copilot keeps that heading instead of adding a duplicate. If you explicitly ask for no title, Copilot does not add the visible heading but keeps the browser title. Long titles wrap on narrow screens instead of being cut off. Copilot writes the complete page under `.openartifacts/handoffs/` in your vault, gives you a clickable link to it (or the plain path when a link cannot be made), and stops. For HTML, it preserves the existing file and passes that exact file to OpenArtifacts without converting, rewriting, copying, or deleting it; because only that file is uploaded, the agent warns before publishing if any relative local resource in an HTML attribute or CSS URL will not load. Click the link to open the HTML file in your browser and see the page as it will be uploaded; OpenArtifacts adds its own top bar, with a Share button, and a footer byline when it serves the page. For a new page, Markdown or HTML, the review message also asks who should be able to open it: reply **publish** for anyone with the link, or name people, for example **publish for alice@acme.com**, to share it only with them. If your request already said who, the agent confirms that instead of asking. It never guesses an email address, and updating a page that is already published never asks and keeps who can open it. Reply that it should publish, or describe changes and the agent revises the generated Markdown handoff or waits for you to update and review the original HTML again. The agent never publishes in the same turn that produced the HTML.

After publishing a Markdown note, the agent saves the link in the note's `openartifacts` property, so publishing the note again updates the same page and the regular **Publish file to OpenArtifacts** command recognizes it as published. Notes published under the older `symposium` property keep working and move to `openartifacts` the next time they are published. If a property already holds something other than an OpenArtifacts link, the agent asks before touching it. Ask the agent to withdraw a page to take it down; it confirms first and removes only note properties whose links match the withdrawn page afterwards. For HTML, keep and supply the returned OpenArtifacts link when asking the agent to withdraw the page later; republishing the HTML creates a new link.

### Sharing a page with only some people

Private sharing is included with every plan that can publish to OpenArtifacts: Plus and Supporter, including existing Believer licenses. If your plan cannot publish, nothing is published, public or private, and the agent points you to Copilot Settings. If your plan lapses after you share a page, private pages stay private and invited people keep access. You can still see who has access, remove people, decline requests, and make a page public, but making a page private or adding a person tells you private sharing needs a paid plan, and nothing is changed.

When you name people, the agent publishes the page privately and adds each address. Only you and those people can open it, and they sign in with the address that was invited. When OpenArtifacts sends invite emails, the agent says the invitation was emailed; otherwise it asks you to send them the link. It ends with a **Manage who can open it** link to a page where you can change who has access. Sign in there with the OpenArtifacts account linked to your Copilot account. **Open** in the Share with OpenArtifacts dialog opens your page without signing in. If the server does not support private documents, the agent tells you and does not publish the page publicly.

You can also ask the agent later to make a page private or public, add or remove a person, or show who has access and who has asked to open it. It changes one address at a time, and approves or declines a request only when you say so. Making a public page private warns that people who opened it while it was public may have kept a copy. Switching back to **Anyone with the link** keeps the list of invited people.

### The Share with OpenArtifacts dialog

The **Publish file to OpenArtifacts** command opens the **Share with OpenArtifacts** dialog.

- **Link access** chooses **Anyone with the link** or **Only those invited**. Choose it before the first publish, or change it later from a published note's dialog. To invite people or answer requests, use the **Share** button on the published page.
- **Copy link** (**Copy** right after you publish or update) copies the page link, and **Open** opens the page for you without a sign-in.

If your plan cannot publish to OpenArtifacts, the dialog shows **OpenArtifacts access required** and nothing is published, whichever **Link access** you chose. If your plan has lapsed, choosing **Only those invited** shows the plan message with an **Upgrade** link and changes nothing; **Anyone with the link** keeps working. If OpenArtifacts does not support private documents yet, the dialog says so, and **Update**, **Delete**, **Copy link**, and **Open** keep working.

If your Copilot license is not linked to an OpenArtifacts account, the first new page you publish, from the dialog or the agent, adds one line offering to link it, with a **Link account** link. Linking gets you an email when people you share with comment or ask for access. Copilot shows this once per vault, whichever way you publish, and records that in `.openartifacts/link-offer-shown`; delete that file to see the offer again.

Copilot also includes **research-memo** as an optional theme. For a named theme, the skill checks `.openartifacts/themes/<name>.md` in your vault, then `themes/<name>.md` alongside the installed skill. If neither exists, the agent continues with readable defaults. A missing theme never blocks publishing.

### Upgrading an agent

When an installed agent needs a supported version, select **Configure** in Basic → Agents. Agent Chat offers **Upgrade** if Copilot can upgrade that installation. Both surfaces show the same progress and failures, including upgrades started in Configure. If an upgrade fails, retry in Configure or use **Retry** in Agent Chat. A failed custom-path selection is reported in Configure and does not turn the upgrade action into a path-validation retry.

Image-only messages appear as "Image attachment" in the queue. Sessions with only images use the same fallback title in tabs and Recent Chats until a text or agent-generated title is available.

### Managed runtime updates

When Copilot loads, managed Codex and OpenCode runtimes update to the version shipped with Copilot before that agent starts. Agent Chat shows download progress, then opens a new chat when the agent is ready. Other agents remain usable during the download. A failed download leaves the previous supported runtime available and retries on a later load after 24 hours. Configure lets you retry immediately or select your own binary, which Copilot does not update automatically.

Codex and OpenCode show **Upgrade required** when the installed runtime is below the minimum supported by Copilot. An unsuccessful update keeps that installation unavailable until you upgrade it; only an older runtime that still meets the minimum remains usable. Configure lets you retry immediately. A new minimum requirement permits a fresh automatic update attempt even if a previous attempt was postponed. Custom binaries require a manual update.
