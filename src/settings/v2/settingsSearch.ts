/**
 * Settings-search support for Obsidian 1.13+.
 *
 * Obsidian's global settings search indexes the definitions a
 * `PluginSettingTab` returns from `getSettingDefinitions()`. Copilot's
 * settings UI is a React app, so instead of migrating every control to
 * declarative definitions, this module keeps a manifest of the user-facing
 * settings (name, description, aliases, owning tab) that
 * `CopilotSettingTab` turns into searchable definitions, plus the deep-link
 * channel that routes a chosen search result into the React UI (switch tab,
 * scroll the anchored row into view).
 *
 * DOM anchors derive from a setting's display title via
 * `settingsSearchAnchor()` (`@/lib/settingsSearchAnchor`); shared row
 * components stamp the same derived anchor, so a manifest entry and its
 * rendered row stay linked by the title string alone.
 */

/** Tab ids of SettingsMainV2, in display order. */
export const SETTINGS_TAB_IDS = [
  "basic",
  "byok",
  "miyo",
  "skills",
  "command",
  "selfhost",
  "advanced",
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

/** One user-facing setting exposed to Obsidian's settings search. */
export interface SettingsSearchEntry {
  /** The SettingsMainV2 tab that renders this setting. */
  tabId: SettingsTabId;
  /** Display name, as rendered in the settings UI. Also drives the anchor. */
  name: string;
  /** Search-matchable description; mirrors the rendered description text. */
  desc: string;
  /** Extra search terms not present in the name or description. */
  aliases?: readonly string[];
}

/** A pending navigation from a settings-search result into the React UI. */
export interface SettingsDeepLink {
  tabId: SettingsTabId;
  anchor: string;
}

let pendingDeepLink: SettingsDeepLink | null = null;
let deepLinkListener: ((link: SettingsDeepLink) => void) | null = null;

/**
 * Routes a settings-search selection into the React settings UI. If the UI
 * is not mounted yet (Obsidian navigates before React commits), the link is
 * buffered and delivered to the next subscriber.
 * @param link The tab to select and the row anchor to scroll into view.
 */
export function requestSettingsDeepLink(link: SettingsDeepLink): void {
  if (deepLinkListener) {
    deepLinkListener(link);
  } else {
    pendingDeepLink = link;
  }
}

/**
 * Registers the settings UI as the deep-link consumer, immediately flushing
 * any link buffered while the UI was unmounted. Only one consumer exists at
 * a time (the latest mounted settings root).
 * @param listener Called with each deep link to apply to the UI.
 * @returns Unsubscribe callback; clears the listener if still registered.
 */
export function subscribeSettingsDeepLink(listener: (link: SettingsDeepLink) => void): () => void {
  deepLinkListener = listener;
  const buffered = pendingDeepLink;
  if (buffered) {
    pendingDeepLink = null;
    listener(buffered);
  }
  return () => {
    if (deepLinkListener === listener) {
      deepLinkListener = null;
    }
  };
}

/**
 * The stable, named settings of every tab, in tab order. Dynamic per-item
 * rows (configured models, individual custom commands, individual skills)
 * are deliberately absent — only rows with a fixed identity are indexable.
 */
export const SETTINGS_SEARCH_MANIFEST: readonly SettingsSearchEntry[] = [
  // basic
  {
    tabId: "basic",
    name: "Copilot License",
    desc: "Enter your Copilot Plus license key to unlock premium features.",
    aliases: ["license key", "plus", "believer", "supporter"],
  },
  {
    tabId: "basic",
    name: "Default backend",
    desc: "Used when you click + to start a new session and for auto-spawn on mount.",
    aliases: ["agent", "claude code", "codex"],
  },
  {
    tabId: "basic",
    name: "Default model",
    desc: "The model new chats start with. Pick from your enabled Quick Chat models.",
    aliases: ["chat model", "quick chat"],
  },
  {
    tabId: "basic",
    name: "Open Plugin In",
    desc: "Choose where to open the plugin.",
    aliases: ["sidebar", "editor"],
  },
  {
    tabId: "basic",
    name: "Send Shortcut",
    desc: "Keyboard shortcut to send messages.",
    aliases: ["enter", "hotkey"],
  },
  {
    tabId: "basic",
    name: "Copilot folder location",
    desc: "Where Copilot keeps conversations, prompts, memory and more.",
    aliases: ["conversations folder"],
  },
  {
    tabId: "basic",
    name: "Custom vault instructions",
    desc: "Instructions Copilot follows in every chat in this vault.",
    aliases: ["system prompt", "persona"],
  },
  {
    tabId: "basic",
    name: "Autosave Chat as Markdown",
    desc: "Writes each chat to a Markdown note in your vault after every user message and AI response.",
    aliases: ["save chat"],
  },
  {
    tabId: "basic",
    name: "Conversation Filename Template",
    desc: "Customize the format of saved conversation note names.",
    aliases: ["note name"],
  },
  // byok
  {
    tabId: "byok",
    name: "Bring Your Own Key",
    desc: "Set up your own providers and models to use in Copilot.",
    aliases: ["byok", "api key", "provider", "models", "openai", "anthropic"],
  },
  // miyo
  {
    tabId: "miyo",
    name: "Miyo",
    desc: "Runs locally and connects automatically.",
    aliases: ["local ai", "connect", "disconnect"],
  },
  {
    tabId: "miyo",
    name: "Connector",
    desc: "Let ChatGPT / Claude read-write your local files and vault from the cloud.",
    aliases: ["relay", "cloud"],
  },
  {
    tabId: "miyo",
    name: "Remote Miyo server (advanced)",
    desc: "Leave blank for local discovery, or point at a remote Miyo instance.",
    aliases: ["url", "endpoint"],
  },
  {
    tabId: "miyo",
    name: "Semantic search",
    desc: "Understands meaning, not just keywords — finds related notes on-device.",
    aliases: ["embedding", "search skill", "related notes"],
  },
  {
    tabId: "miyo",
    name: "Search scope",
    desc: "Only the current vault, or everything Miyo has indexed.",
    aliases: ["vault scope"],
  },
  {
    tabId: "miyo",
    name: "Search chat",
    desc: "Search your ChatGPT / Claude chats locally.",
    aliases: ["chat history"],
  },
  {
    tabId: "miyo",
    name: "Document Processor",
    desc: "Processes PDF & EPUB locally via Miyo; other formats use Plus cloud.",
    aliases: ["pdf", "epub"],
  },
  // skills
  {
    tabId: "skills",
    name: "Skills",
    desc: "Instruction packets your agents can run, loaded from your skills folders.",
    aliases: ["agent skills"],
  },
  // command
  {
    tabId: "command",
    name: "Custom Commands",
    desc: "Preset prompts you trigger from the editor right-click menu or with a / command in chat.",
    aliases: ["custom prompts", "slash commands"],
  },
  {
    tabId: "command",
    name: "Custom Prompt Templating",
    desc: "Process variables like {activenote}, {foldername}, or {#tag} in prompts.",
    aliases: ["variables"],
  },
  {
    tabId: "command",
    name: "Custom Prompts Sort Strategy",
    desc: "Sort order for slash command menu prompts.",
    aliases: ["sort order"],
  },
  // selfhost
  {
    tabId: "selfhost",
    name: "Enable Self-Host Mode",
    desc: "Route LLMs, embeddings and document understanding through your own endpoints.",
    aliases: ["self host", "offline", "privacy"],
  },
  {
    tabId: "selfhost",
    name: "Web Search Provider",
    desc: "Web search provider used by the agent search skill.",
    aliases: ["firecrawl", "perplexity"],
  },
  {
    tabId: "selfhost",
    name: "Firecrawl API Key",
    desc: "Web search & fetch via Firecrawl.",
  },
  {
    tabId: "selfhost",
    name: "Perplexity API Key",
    desc: "Web search via Perplexity Sonar.",
    aliases: ["sonar"],
  },
  {
    tabId: "selfhost",
    name: "Supadata API Key",
    desc: "YouTube transcripts via Supadata.",
    aliases: ["youtube", "transcript"],
  },
  {
    tabId: "selfhost",
    name: "LLM & embedding models",
    desc: "Add local / self-hosted models as an OpenAI-compatible endpoint in BYOK.",
    aliases: ["local models", "openai compatible"],
  },
  // advanced
  {
    tabId: "advanced",
    name: "API Key Storage",
    desc: "API keys are stored in this device's Obsidian Keychain.",
    aliases: ["keychain", "secrets", "delete all keys"],
  },
  {
    tabId: "advanced",
    name: "Debug Mode",
    desc: "Logs Copilot chat activity to the developer console.",
    aliases: ["console", "logs"],
  },
  {
    tabId: "advanced",
    name: "Create Log File",
    desc: "Save and open the regular Copilot chat log to share when reporting a chat issue.",
    aliases: ["log file"],
  },
  {
    tabId: "advanced",
    name: "Report an Issue",
    desc: "Bundles a screenshot of the Agent Mode chat pane and a recent activity log, then opens a prefilled GitHub issue.",
    aliases: ["github", "bug report"],
  },
  {
    tabId: "advanced",
    name: "Keep an Agent Mode activity log",
    desc: "Records the behind-the-scenes messages between Copilot and the agent.",
    aliases: ["agent log"],
  },
  {
    tabId: "advanced",
    name: "Agent Mode activity log file",
    desc: "Open or clear the log file on disk.",
    aliases: ["open log"],
  },
];
