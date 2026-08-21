# Copilot Plans, Privacy, and Self-Hosting

Copilot's core Agent Chat is free. You can use it with your own API keys, local models, a Claude Code subscription, or a ChatGPT plan through Codex. A Copilot paid plan is optional and adds managed models or services when you do not want to assemble everything yourself.

This guide explains the practical difference between the plans, who supplies each model, and where your data goes. See the [live pricing page](https://www.obsidiancopilot.com/en/pricing) for current prices, allowances, and promotions.

## Choose a plan by what you need

| Plan          | Best for                                                    | What it adds                                                                                                                        |
| ------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Free**      | You already have model access or want a local setup         | Agent Chat, Projects, Quick Ask, Copilot Commands, BYOK, local models, and custom Skills                                            |
| **Lite**      | You want Copilot-hosted models without configuring API keys | Hosted models with plan allowances and optional credits                                                                             |
| **Plus**      | You want Copilot's complete hosted research workflow        | Higher hosted allowance, multi-agent answers, premium web and document tools, capture Skills, and Symposium publishing              |
| **Supporter** | You want a long-term local-first setup and early access     | Lifetime Self-Host Mode and Miyo, two years of Plus, preview access, and ongoing credit-purchase benefits shown on the pricing page |

Existing Believer customers keep their original benefits. The plugin may show **Lifetime** for a Believer or Supporter license because both grant the same long-term self-host entitlement inside Copilot.

## Free

Free is the complete do-it-yourself path. It requires no Copilot account, license key, or credit card.

You can use:

- **Agent Chat with opencode** and an API provider or local OpenAI-compatible endpoint configured under **Settings → Copilot → BYOK**.
- **Agent Chat with Claude** through your existing Claude Code installation and subscription.
- **Agent Chat with Codex** through `codex-acp` and your existing Codex CLI or ChatGPT login.
- **Quick Chat and Quick Ask** with a BYOK model.
- **Projects**, **Copilot Commands**, custom Skills, and Skills shared across opencode, Claude, and Codex.
- The separately available Miyo desktop app and CLI for local semantic search and local-first knowledge ownership.

Free does not mean every model is free. Anthropic, OpenAI, Google, OpenRouter, or another provider may charge your account. A local model uses your own computer instead.

## Lite

Lite adds Copilot-hosted models. Enter the Copilot license key once, then eligible models appear in the opencode and Quick Chat model lists without separate provider setup.

Lite is a good fit when you want managed model access but do not need Copilot's collaboration and premium research features. Usage is subject to the current plan allowances. You can purchase Copilot credits from the dashboard when you need additional hosted usage.

Lite does not include:

- Multi-agent answers
- Premium web search and PDF processing
- Copilot's hosted YouTube and X capture Skills
- Symposium publishing
- Self-Host Mode

Your own BYOK, Claude, Codex, local model, Commands, Projects, Quick Ask, and custom Skills continue to work independently of the Lite allowance.

## Plus

Plus includes everything in Lite with a higher hosted-model allowance. It also unlocks the full Copilot service layer:

- **Multi-agent answers** that ask installed agents in parallel and have the current agent summarize their findings.
- **Premium web and PDF tools** for research and document understanding.
- Built-in **YouTube and X capture Skills**.
- **Symposium publishing** for supported outputs.

Plus is for people who want Copilot to provide both the model access and the research services. It does not include Self-Host Mode.

## Supporter

Supporter is the ownership-focused lifetime option. Its current benefits include:

- Lifetime **Self-Host Mode**
- Two years of **Plus**
- Lifetime **Miyo**
- Preview access to supported new features
- The credit-purchase bonus described on the live pricing page

After the included Plus period ends, the lifetime Self-Host and Miyo benefits remain. Hosted Copilot models still require an active plan or purchased credits.

## Understand who supplies the model

The label in the model picker tells you which service handles the conversation:

| Model source                | How access works                                               | Who processes the prompt                                        |
| --------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| **Copilot-hosted**          | Lite, Plus, or included Supporter access                       | Brevilabs and the enterprise model provider used for that model |
| **Cloud BYOK**              | Your API key under BYOK                                        | The provider and endpoint you configured                        |
| **Local BYOK**              | Ollama, LM Studio, or another local OpenAI-compatible endpoint | Your local endpoint                                             |
| **opencode-reported model** | Authentication managed by opencode                             | The provider behind that opencode model                         |
| **Claude**                  | Claude Code login or environment                               | Anthropic under your Claude account                             |
| **Codex**                   | Codex CLI login through `codex-acp`                            | OpenAI under your Codex or ChatGPT account                      |

A Claude or ChatGPT subscription is not an API key. Use the Claude or Codex Agent Chat setup for those subscriptions. Use BYOK only when you have API access or an OpenAI-compatible endpoint.

## Understand service data routes

The selected model is only one possible route. A feature may call another service for the part of the task you asked it to perform:

- A **Copilot-hosted Skill** sends the search query, URL, or document needed by that Skill to Brevilabs.
- **Plus document processing** sends the supported document to Copilot's hosted processor.
- In **Agent Chat**, **Miyo document processing** runs through the local Miyo CLI, so PDF and EPUB parsing stays on this computer even when search uses a remote Miyo server.
- In **Quick Chat**, **Miyo document processing** uses the connected Miyo service. A configured remote Miyo server processes the document there rather than on this computer.
- Saved **project context** that needs web, YouTube, or binary-file conversion can use Copilot's hosted project service. The Miyo Document Processor choice does not change that project route.
- An agent can read a local note and include relevant text in the prompt sent to the selected model. Opening Agent Chat alone does not upload the whole vault.

For a workflow that does not send task content to Brevilabs, use direct Markdown context, local tools or local Miyo, and a local model. Disable Copilot's cloud-backed Skills for every agent you use. Do not add web pages, YouTube links, or binary files as saved project context when their hosted conversion is outside your intended boundary.

The [privacy policy](https://www.obsidiancopilot.com/en/privacy) describes how Copilot's hosted requests are processed. Your model provider and Miyo server have their own boundaries and terms.

## Self-Host Mode is a guide, not a firewall

Supporter and eligible legacy licenses can open **Settings → Copilot → Self-Host** and enable **Self-Host Mode**.

When it is on, Copilot:

- Lets you supply Firecrawl or Perplexity credentials for web search.
- Lets you supply a Supadata key for YouTube transcripts.
- Directs you to BYOK for local or self-hosted model endpoints.
- Flags and sorts cloud agents and models below local or self-hosted choices.

It does not disable the cloud. Claude, Codex, Copilot-hosted models, cloud BYOK providers, Firecrawl, Perplexity, and Supadata can still send data to their services when you select them. The warnings make those routes visible so you can decide.

You do not need Self-Host Mode to use a local BYOK model or local Miyo. Those are available independently.

## Add or change a license

1. Open **Settings → Copilot → Basic**.
2. Paste your license key under **Copilot License**.
3. Select **Apply**.
4. Review the hosted models enabled under **Basic → Agents → opencode** and **Basic → Agents → Quick Chat**.

Use the [Copilot dashboard](https://www.obsidiancopilot.com/en/dashboard) for current plan, allowance, and credit details. Removing a Copilot license does not remove your BYOK providers or vendor subscriptions.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Model Sources and BYOK](llm-providers.md)
- [Miyo: Local-First Search and AI Ownership](vault-search-and-indexing.md)
- [Settings: Basic](settings.md#basic)
- [Settings: Self-Host](settings.md#self-host)
