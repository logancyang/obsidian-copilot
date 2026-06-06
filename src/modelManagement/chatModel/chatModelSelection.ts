import { ChatModelProviders } from "@/constants";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

import {
  CATALOG_ID_TO_CHAT_PROVIDER,
  mapProviderTypeToChatModelProvider,
} from "./configuredModelToCustomModel";

export type ResolvedChatBackendEntry = Extract<EnabledBackendEntry, { state: "ok" }>;

const DISPLAY_NAME_TO_LEGACY_PROVIDER: Record<string, ChatModelProviders> = {
  ollama: ChatModelProviders.OLLAMA,
  "lm studio": ChatModelProviders.LM_STUDIO,
  "openai format": ChatModelProviders.OPENAI_FORMAT,
  cohere: ChatModelProviders.COHEREAI,
  siliconflow: ChatModelProviders.SILICONFLOW,
};

/**
 * Legacy selections used `wireModelId|ChatModelProviders`; keep them resolvable
 * during migration. A model may have been persisted under different provider
 * spellings depending on how it was selected, so enumerate every plausible form.
 */
function getLegacyChatModelKeys(entry: ResolvedChatBackendEntry): readonly string[] {
  const providers = new Set<ChatModelProviders>([
    mapProviderTypeToChatModelProvider(entry.provider),
  ]);
  if (entry.provider.origin.kind === "copilot-plus") {
    providers.add(ChatModelProviders.COPILOT_PLUS);
  }
  if (entry.provider.origin.kind === "byok" && entry.provider.origin.catalogProviderId) {
    const catalogProvider = CATALOG_ID_TO_CHAT_PROVIDER[entry.provider.origin.catalogProviderId];
    if (catalogProvider) providers.add(catalogProvider);
  }
  const displayProvider = DISPLAY_NAME_TO_LEGACY_PROVIDER[entry.provider.displayName.toLowerCase()];
  if (displayProvider) providers.add(displayProvider);

  return [...providers].map((provider) => `${entry.configuredModel.info.id}|${provider}`);
}

export function isChatModelSelectionForEntry(
  entry: ResolvedChatBackendEntry,
  selection: string
): boolean {
  return entry.configuredModelId === selection || getLegacyChatModelKeys(entry).includes(selection);
}

/**
 * Resolve a persisted chat selection. New writes are configured-model IDs, while legacy
 * `name|provider` keys remain readable for settings, project files, and command frontmatter.
 */
export function findChatBackendEntry(
  entries: readonly EnabledBackendEntry[],
  preferredSelection: string | undefined
): ResolvedChatBackendEntry | undefined {
  const okEntries = entries.filter(
    (entry): entry is ResolvedChatBackendEntry => entry.state === "ok"
  );
  if (!preferredSelection) return okEntries[0];

  return (
    okEntries.find((entry) => isChatModelSelectionForEntry(entry, preferredSelection)) ??
    okEntries[0]
  );
}

/** Return the configured-model ID represented by either a new or legacy selection. */
export function resolveChatModelSelectionId(
  entries: readonly EnabledBackendEntry[],
  selection: string | undefined
): string | undefined {
  return findChatBackendEntry(entries, selection)?.configuredModelId;
}
