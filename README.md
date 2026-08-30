<h1 align="center">Copilot for Obsidian</h1>

<p align="center"><strong>Agents for your Obsidian vault</strong></p>

<p align="center">Copilot V4 brings opencode, Claude Code, and Codex into Obsidian for research, writing, and knowledge work.</p>

<p align="center">
  <a href="https://obsidian.md/blog/2024-goty-winners/"><img src="./images/llm-integration.svg" width="640" alt="Best LLM Integration Award"></a>
</p>

<p align="center">
  <a href="https://obsidian.md/plugins?id=copilot"><strong>No. 1 Obsidian AI Plugin</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22copilot%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=flat-square" alt="Obsidian downloads" align="absmiddle">
  <img src="https://img.shields.io/github/v/release/logancyang/obsidian-copilot?style=flat-square&sort=semver" alt="Latest release" align="absmiddle">
</p>

<p align="center">
  <img src="./images/copilot-v4-agent-mode.png" alt="Copilot V4 agent organizing research into connected Obsidian notes" width="1200">
</p>

<p align="center">
  <a href="https://obsidian.md/plugins?id=copilot"><strong>Install in Obsidian</strong></a> ·
  <a href="https://www.obsidiancopilot.com/en/pricing">View plans</a> ·
  <a href="./docs/getting-started.md">Get started</a>
</p>

---

## Choose your agent

**Agent** is the main Copilot experience for multi-step work. It can inspect notes, use tools, create Obsidian files, and continue across several turns with permissions you control.

- **opencode (recommended):** Let Copilot download and manage it, then use Copilot-hosted models, your own provider key, or a local model.
- **Claude Code:** Connect an existing installation. Copilot detects common install locations and uses your Claude Code login.
- **Codex:** Connect Codex through the `@agentclientprotocol/codex-acp` adapter and use your existing Codex login.

Already pay for Claude or ChatGPT, or already have model API access? You can bring that access to Copilot without buying a Copilot plan. Provider terms and usage limits still apply.

[Learn how Agent works →](./docs/agent-mode-and-tools.md)

## Set up Copilot

1. [Install Copilot](https://obsidian.md/plugins?id=copilot) from Obsidian Community Plugins.
2. Open **Settings → Copilot → Basic → Agents**.
3. Select **Download opencode**, or connect Claude Code or Codex with **Auto-detect**. Codex requires the `codex-acp` adapter first.
4. Select the **Agent** ribbon icon, or run **Open Copilot Agent Chat Window**.

The [Getting Started guide](./docs/getting-started.md) covers each setup path, including the Codex adapter commands and manual adapter paths.

## Built around your vault

- **Projects:** Give ongoing work its own instructions, reusable context, and chat history. A project works with opencode, Claude, or Codex. [Learn about Projects](./docs/projects.md).
- **Skills shared across agents:** Add a skill once, then enable it for each installed agent. Copilot also includes skills for Obsidian Markdown, Bases, Canvas, and the Obsidian CLI. [Learn about Skills](./docs/agent-mode-and-tools.md#skills-shared-across-agents).
- **Commands:** Save repeatable prompts, run them with `/` in Agent, or expose them in the editor and Command palette. [Create a Command](./docs/custom-commands.md).
- **Quick Ask:** Ask about a selection without leaving the note. Continue the conversation, replace text, insert the answer, or copy it. Quick Ask uses your Quick Chat model. [Set up Quick Ask](./docs/custom-commands.md#quick-ask).
- **Multiple sessions:** Keep separate Agent tabs open for different tasks. With active Plus access, mention multiple installed agents with `@` for one read-only research or review request.

For a short conversation that does not need an agent, use [Quick Chat](./docs/chat-interface.md).

## Use hosted, BYOK, or local models

- **Copilot-hosted:** Add a Copilot license, then choose an available hosted model for opencode or Quick Chat. The model picker and dashboard show current access.
- **Bring your own key:** Add a cloud, local, or OpenAI-compatible provider under **Settings → Copilot → BYOK**. Keys are stored in this device's Obsidian Keychain, not in the vault's `data.json`.
- **Claude and Codex accounts:** These agents use their own CLI login rather than a key from Copilot's BYOK settings.
- **Models reported by opencode:** opencode routes them to their backing provider. Free opencode Zen models show a warning because that provider may log or train on prompts; review its terms before sending sensitive content.

Your chosen route determines where prompts and included context are processed. Read [LLM Providers](./docs/llm-providers.md) for setup and [Copilot Plus and Self-Host](./docs/copilot-plus-and-self-host.md) for privacy and routing details.

## Plans

The Copilot plugin is open source and works without a Copilot license when you use your own agent account, provider key, or local model. Free use includes normal single-agent Agent chats, Projects with Markdown context, custom Skills and Commands, Quick Chat, Quick Ask, and local Miyo search.

Paid access can include Copilot-hosted models and cloud-backed tools. Multi-agent requires active Plus access; check your dashboard for the current entitlement. Model availability and service limits can change, so the [pricing page](https://www.obsidiancopilot.com/en/pricing) and in-app model pickers are the current source of truth.

<p align="center"><a href="https://www.obsidiancopilot.com/en/pricing"><strong>Compare plans →</strong></a></p>

## Trusted by people who think for a living

> "The first tool that truly unifies how I search, organize, and retrieve knowledge without ever leaving Obsidian. My workflow is faster, deeper, and more connected. I can't imagine working without it."
>
> **Jason Zhang**, Investor & Research Analyst

<details>
<summary><strong>More from the community</strong></summary>

> "I drop meeting transcriptions, personal notes, and architecture ideas into my vault. Copilot gives me a personal assistant that finds missing puzzle pieces and surfaces relevant info during live calls, no manual searches."
>
> **Brad Decker**, CTO, Concierge Auctions

> "Since discovering Copilot, my writing process has been completely transformed. Conversing with my own articles and thoughts is the most refreshing experience I've had in decades."
>
> **Mat QV**, Professional Writer

</details>

## Frequently asked questions

<details>
<summary><strong>Can I use Copilot without a paid plan?</strong></summary>

Yes. Connect Claude Code or Codex with its existing account, or use opencode and Quick Chat with your own API key or local model. Your provider may charge for its own usage.

</details>

<details>
<summary><strong>Does Agent work on mobile?</strong></summary>

Agent is a desktop feature because its backends run local processes. Quick Chat, custom Commands, and Quick Ask remain available on mobile.

</details>

<details>
<summary><strong>How is my data handled?</strong></summary>

Your notes remain files in your vault, and local Miyo indexes stay on your device. Prompts and any included context go to the model or service you choose. Copilot-hosted models and hosted features send the required input to Brevilabs for processing. See the [disclosure below](#paid-plan-disclosure) and the [privacy policy](https://www.obsidiancopilot.com/en/privacy).

</details>

## Help and links

[Documentation](./docs/index.md) · [YouTube](https://www.youtube.com/@loganhallucinates) · [Report a bug](https://github.com/logancyang/obsidian-copilot/issues/new?template=bug_report.md) · [Request a feature](https://github.com/logancyang/obsidian-copilot/issues/new?template=feature_request.md) · [Privacy](https://www.obsidiancopilot.com/en/privacy)

## Support the project

If Copilot is useful to you, consider [sponsoring the project on GitHub](https://github.com/sponsors/logancyang) or buying us a coffee.

<p align="center">
  <a href="https://www.buymeacoffee.com/logancyang"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="165"></a>
</p>

### Thank you to our GitHub Sponsors

Special thanks to our top sponsors: @mikelaaron, @pedramamini, @Arlorean, @dashinja, @azagore, @MTGMAD, @gpythomas, @emaynard, @scmarinelli, @borthwick, @adamhill, @gluecode, @rusi, @timgrote, @JiaruiYu-Consilium, @ddocta, @AMOz1, @chchwy, @pborenstein, @GitTom, @kazukgw, @mjluser1, @joesfer, @rwaal, @turnoutnow-harpreet, @dreznicek, @xrise-informatik, @jeremygentles, @ZhengRui, @bfoujols, @jsmith0475, @pagiaddlemon, @sebbyyyywebbyyy, @royschwartz2, @vikram11, @amiable-dev, @khalidhalim, @DrJsPBs, @chishaku, @Andrea18500, @shayonpal, @rhm2k, @snorcup, @JohnBub, @obstinatelark, @jonashaefele, @vishnu2kmohan

## Paid Plan Disclosure

Copilot is a product of Brevilabs LLC and is not affiliated with Obsidian. Visit [obsidiancopilot.com](https://obsidiancopilot.com/) for current plan details.

- An account and payment are required for paid access.
- Hosted models and cloud-backed features require network access.
- **Privacy and data handling:**
  - **Free use:** Messages and note context go to the LLM provider, local endpoint, or CLI agent you configure. Brevilabs does not receive them unless you invoke a Brevilabs-hosted feature.
  - **Paid hosted services:** Brevilabs's backend and its vetted enterprise model providers process the full request. A Copilot-hosted embedding model receives the note text being indexed. Hosted features also receive the inputs they need, such as search queries, URLs, and files used by Quick Chat tools or Agent project context. The privacy policy says request content is processed transiently, not retained, and not used for training.
  - **User ID:** Hosted feature requests include a randomly generated UUID for service delivery, license abuse prevention, and rate limiting. It is not used for tracking, profiling, or analytics.
- See the [privacy policy](https://www.obsidiancopilot.com/en/privacy) for full terms.
- The Copilot plugin frontend is fully open source. The backend services that support hosted features are closed source and proprietary.
- We offer a full refund within 14 days of purchase if you are not satisfied.

## Authors

Brevilabs Team · [logan@brevilabs.com](mailto:logan@brevilabs.com) · [@logancyang](https://twitter.com/logancyang)
