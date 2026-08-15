# Copilot Plus and Self-Host

Copilot V4 does not require a Copilot subscription when you bring your own
model access. Paid access can include Copilot-hosted models and services.
Self-Host Mode is a separate option for licenses that include it; it helps you
choose and identify your own infrastructure, but it is not a network firewall.

## What stays free

You can use these without a Copilot license:

- **Agent with opencode** and a provider key or local model added under
  **Settings → Copilot → BYOK**.
- **Agent with Claude or Codex** when you already have the corresponding CLI
  and account or subscription.
- **Quick Chat** with a model you add under **BYOK**.
- Normal single-agent Agent chats, projects that use Markdown context, custom skills,
  custom commands, and the shared cross-agent skills manager.
- **Miyo** for local semantic search and local PDF or EPUB processing.

Your model provider, Claude account, or Codex account may still charge for its
own usage. A ChatGPT or Claude subscription is different from an API key: use
the Agent setup for a CLI subscription, and **BYOK** for API access.

## What paid access adds

Enter your key under **Settings → Copilot → Basic → Copilot License**, then
select **Apply**. Available features depend on the plan shown in settings.

Paid access can include Copilot-hosted models and cloud-backed tools.
Multi-agent requires active Plus access; check your dashboard for the current
entitlement.

Depending on your license, paid access can add:

- **Copilot-hosted models** in Quick Chat and opencode. No separate model
  provider key is needed. The current model lists in **Basic → Agents → Quick
  Chat** and **Basic → Agents → opencode** are the source of truth.
- The **copilot plus** Quick Chat mode, with cloud tools and supported
  attachments according to your license.
- Cloud-backed Agent skills for web search and fetch, PDF reading, YouTube
  transcripts, and X posts. Copilot shares these skills with opencode, Claude,
  and Codex through the same Skills system.
- Hosted preparation of supported project files, web pages, and YouTube
  transcripts.
- **Multi-agent answers** with active Plus access. Mention more than one installed
  agent with `@` to run a read-only research or review task in parallel.

The model lineup and service limits can change, so this guide does not keep a
fixed list or quota. See the dashboard and the model pickers for current access.

## Where your data goes

The route you choose determines who receives the conversation:

- With a **Copilot-hosted model**, Brevilabs's backend and its vetted enterprise
  model providers process the full request.
- With a **cloud BYOK provider**, the configured provider receives the prompt.
- With a **local or self-hosted BYOK endpoint**, Copilot sends the prompt to
  that endpoint.
- With a **model reported by opencode**, opencode routes the request to its
  backing provider. Free opencode Zen models show a warning because that
  provider may log or train on prompts.
- With **Claude or Codex**, their CLI and account handle model traffic under
  that provider's terms.
- When you invoke a hosted skill, Brevilabs receives the input needed for it,
  such as a search query, URL, or document. A Copilot-hosted embedding model
  receives the note text being indexed.

Copilot does not upload your whole vault simply because Agent is open. However,
an agent can read a file and include its contents or tool results in the model
conversation, so use a local model when that material must stay on your
machine.

The [privacy policy](https://www.obsidiancopilot.com/en/privacy) says hosted
request content is processed transiently, not retained, and not used for
training.

Provider keys and the Copilot license key are stored in this device's Obsidian
Keychain, not in the vault's `data.json`.

## Self-Host Mode

Open **Settings → Copilot → Self-Host** and turn on **Enable Self-Host Mode**.
The toggle unlocks only when your signed license entitlement includes
Self-Host; the settings tab labels it a **Lifetime license** feature.

When enabled, you can:

- Choose **Firecrawl** or **Perplexity Sonar** under **Web Search Provider** and
  supply your own key.
- Add a **Supadata API Key** for YouTube transcripts.
- Add local or self-hosted LLM and embedding endpoints under **BYOK**.
- See cloud agents and models flagged and listed after local or self-hosted
  options.

Self-Host Mode does **not** make every route local. Claude, Codex,
Copilot-hosted models, and cloud BYOK providers remain selectable and still
send data to their services. Firecrawl, Perplexity, and Supadata are also
external services. The warnings help you see these routes; they do not block
them.

You do not need Self-Host Mode to use a local BYOK model or Miyo.

## Miyo and document processing

Miyo is configured separately under **Settings → Copilot → Miyo**. Connect the
desktop app to add local semantic search and choose its scope.

Under **Document Processor**:

- **Plus** sends supported documents to Copilot's hosted document service.
- **Miyo** processes PDFs and EPUBs through Miyo. If Miyo is unavailable,
  Copilot stops with an error instead of silently falling back to the cloud.
- Other document formats still use the Plus service.

A remote Miyo server sends content to the server address you configured rather
than keeping it on the current computer. Binary files, web URLs, and YouTube
URLs saved as **Agent project context** use Copilot's hosted project service
regardless of the **Document Processor** choice. For a project that must make no
Brevilabs requests, keep those sources out of saved context. Use Markdown
context plus local tools or Miyo, and use a local model if prompts must also
remain on-device.

## Related

- [Agents in Copilot V4](agent-mode-and-tools.md) — Set up opencode, Claude, or Codex
- [LLM Providers](llm-providers.md) — Choose between hosted, BYOK, local, and CLI models
- [Projects](projects.md) — Understand project context and file processing
