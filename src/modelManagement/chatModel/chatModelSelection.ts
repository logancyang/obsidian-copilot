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
  "atlas cloud": ChatModelProviders.ATLASCLOUD,
};

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

export function findChatBackendEntry(
  entries: readonly EnabledBackendEntry[],
  preferredSelection: string | undefined,
  fallbackToFirst = true
): ResolvedChatBackendEntry | undefined {
  const okEntries = entries.filter(
    (entry): entry is ResolvedChatBackendEntry => entry.state === "ok"
  );
  // Commands must ask for a model instead of silently changing providers. https://github.com/Brevilabs/obsidian-copilot-private/issues/616
  const fallback = fallbackToFirst ? okEntries[0] : undefined;
  if (!preferredSelection) return fallback;

  return (
    okEntries.find((entry) => isChatModelSelectionForEntry(entry, preferredSelection)) ?? fallback
  );
}

export function resolveChatModelSelectionId(
  entries: readonly EnabledBackendEntry[],
  selection: string | undefined,
  fallbackToFirst = true
): string | undefined {
  return findChatBackendEntry(entries, selection, fallbackToFirst)?.configuredModelId;
}
