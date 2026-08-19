/**
 * Reconciles the Copilot Plus provider with the user's current Plus state.
 *
 * Plus has no model-list endpoint, so the model set is a hardcoded snapshot
 * (`COPILOT_PLUS_MODELS`). `syncCopilotPlusProvider` is the single bridge the
 * plugin host calls on Plus sign-in / sign-out (and once on load): it
 * registers the Plus provider when signed in (with a key) and unregisters it
 * otherwise. Both `register`/`unregister` are idempotent, so calling this on
 * every relevant settings change is safe.
 */

import { BREVILABS_MODELS_BASE_URL, ChatModels } from "@/constants";
import { logError } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { CopilotSettings } from "@/settings/model";

/**
 * The Copilot Plus models the brevilabs relay exposes. Hardcoded — there's no
 * relay catalog to fetch, so this mirrors the curated public lineup served by
 * `models.brevilabs.com/v1/models`. Wire ids must match what the relay accepts;
 * opencode routes them as `copilot-plus/<id>` (see `mapProviderToOpencodeId`).
 *
 * `COPILOT_PLUS_DEFAULT_ENABLED_MODELS` names the few enabled by default; the
 * rest ship available-but-off in the chat + opencode pickers for the user to
 * toggle on.
 *
 * `reasoning: true` marks the models the relay accepts an effort level for (it
 * matches the models service's `supports_reasoning`). The chat + agent pickers
 * read this (via `configuredModelToCustomModel` → `ModelCapability.REASONING`)
 * to surface the effort selector. These models do NOT reason unless the user
 * picks an effort, so flash stays fast by default. Kimi K2.6 (Azure) is the one
 * model without effort support, so it's left unflagged.
 */
export const COPILOT_PLUS_MODELS: readonly ModelInfo[] = Object.freeze([
  {
    id: ChatModels.COPILOT_PLUS_FLASH,
    displayName: "Copilot Plus Flash",
    description: "The default model: fastest responses and the most quota.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_KIMI_K2_6,
    displayName: "Kimi K2.6",
    description: "Good for long-running reasoning tasks.",
    toolCall: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_GLM_5_2,
    displayName: "GLM-5.2",
    description: "A long-horizon frontier open model that beats some of the best closed models.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_KIMI_K2_7_CODE,
    displayName: "Kimi K2.7 Code",
    description: "Optimized for coding tasks.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_DEEPSEEK_V4_PRO,
    displayName: "DeepSeek V4 Pro",
    description: "A top-tier model for the hardest reasoning and agentic tasks.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_DEEPSEEK_V4_FLASH_0731,
    displayName: "DeepSeek V4 Flash 0731",
    description: "The newest DeepSeek V4 Flash snapshot: fast, cheap, and broadly capable.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_MIMO_V2_5,
    displayName: "MiMo V2.5",
    description: "Cost-effective and capable for everyday use.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
  },
  {
    id: ChatModels.COPILOT_PLUS_MINIMAX_M2_7,
    displayName: "MiniMax M2.7",
    description: "A compact, efficient model for lightweight tasks.",
    toolCall: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
  },
]);

/**
 * Wire ids auto-enrolled (toggled on) by default when the Plus provider is
 * registered. Everything else in `COPILOT_PLUS_MODELS` is added but left
 * unenrolled, so users opt into the extra models themselves. Passed to
 * `registerPlusProvider` as `autoEnrollModelIds`.
 *
 * Three models are enabled by default to give users immediate access to
 * representative capabilities: fastest responses (Flash), top-tier reasoning
 * (DeepSeek V4 Pro), and long-horizon frontier open model (GLM-5.2).
 */
export const COPILOT_PLUS_DEFAULT_ENABLED_MODELS: readonly string[] = Object.freeze([
  ChatModels.COPILOT_PLUS_FLASH,
  ChatModels.COPILOT_PLUS_DEEPSEEK_V4_PRO,
  ChatModels.COPILOT_PLUS_GLM_5_2,
]);

/**
 * Whether a settings change requires re-reconciling the Plus provider:
 * a sign-in / sign-out (`isPaidUser` flip) or a key rotation while signed in.
 *
 * This is the settings subscriber's trigger, extracted so the one settings
 * write that must NOT read as sign-out is testable: Reset Settings preserves
 * `isPaidUser` alongside the license key, and this predicate staying false is
 * what keeps the destructive `unregisterPlusProvider` cascade (provider row,
 * configured models, backend refs, provider keychain entry) from firing on a
 * signed-in user's reset.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/259
 *
 * @param prev - Settings before the change.
 * @param next - Settings after the change.
 */
export function plusSyncNeeded(
  prev: Pick<CopilotSettings, "isPaidUser" | "plusLicenseKey">,
  next: Pick<CopilotSettings, "isPaidUser" | "plusLicenseKey">
): boolean {
  return (
    prev.isPaidUser !== next.isPaidUser ||
    (!!next.isPaidUser && prev.plusLicenseKey !== next.plusLicenseKey)
  );
}

/**
 * Register or unregister the Plus provider to match Plus state. Best-effort:
 * a failure is logged, not thrown, since this runs as background reconciliation
 * off a settings change.
 *
 * `licenseKey` is already hydrated from Obsidian Keychain by the settings
 * persistence boundary.
 */
export async function syncCopilotPlusProvider(
  api: ModelManagementApi,
  isPaidUser: boolean,
  licenseKey: string | undefined
): Promise<void> {
  try {
    if (isPaidUser && licenseKey) {
      await api.setup.copilotPlus.registerPlusProvider({
        providerType: "openai-compatible",
        displayName: "Copilot",
        baseUrl: BREVILABS_MODELS_BASE_URL,
        apiKey: licenseKey,
        models: COPILOT_PLUS_MODELS,
        autoEnrollModelIds: COPILOT_PLUS_DEFAULT_ENABLED_MODELS,
      });
    } else {
      await api.setup.copilotPlus.unregisterPlusProvider();
    }
  } catch (err) {
    logError("[modelManagement] Copilot Plus provider sync failed", err);
  }
}
