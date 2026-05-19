import { BREVILABS_MODELS_BASE_URL, ChatModelProviders } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import type { CopilotMode } from "@/agentMode/session/types";
import {
  buildSkillCreationDirective,
  composeDenyList,
  DEFAULT_SKILLS_FOLDER,
  getManagedSkills,
  SkillManager,
} from "@/agentMode/skills";
import { OpencodeBackendDescriptor } from "./descriptor";
import { selectCopilotPrompt } from "./prompts";

/**
 * Map from Copilot's `ChatModelProviders` enum value (as stored in
 * `CustomModel.provider`) to OpenCode's provider id (as it appears in
 * OpenCode's `availableModels` and config). Only providers in this map are
 * routable through OpenCode; everything else (Azure, Bedrock, Ollama,
 * LM Studio, GitHub Copilot, etc.) is filtered out of the picker.
 *
 * Copilot Plus is handled separately because it isn't a built-in OpenCode
 * provider — we register it as a custom `@ai-sdk/openai-compatible` entry
 * pointing at brevilabs and authed via the user's `plusLicenseKey`.
 */
export const OPENCODE_PROVIDER_MAP: Partial<Record<ChatModelProviders, string>> = {
  [ChatModelProviders.ANTHROPIC]: "anthropic",
  [ChatModelProviders.OPENAI]: "openai",
  [ChatModelProviders.GOOGLE]: "google",
  [ChatModelProviders.GROQ]: "groq",
  [ChatModelProviders.MISTRAL]: "mistral",
  [ChatModelProviders.DEEPSEEK]: "deepseek",
  [ChatModelProviders.OPENROUTERAI]: "openrouter",
  [ChatModelProviders.XAI]: "xai",
  [ChatModelProviders.COPILOT_PLUS]: "copilot-plus",
};

/** OpenCode provider id reserved for Copilot Plus's brevilabs proxy. */
const COPILOT_PLUS_PROVIDER_ID = "copilot-plus";

/**
 * Custom OpenCode agent id provisioned via `OPENCODE_CONFIG_CONTENT`. Maps
 * to Copilot's canonical `default` mode (writes/exec allowed, but the user
 * approves each request). The built-in `build` agent doesn't ask.
 */
export const OPENCODE_COPILOT_BUILD_AGENT_ID = "copilot-build";

/** OpenCode's built-in build agent id (full perms, no permission asks). */
export const OPENCODE_BUILTIN_BUILD_AGENT_ID = "build";

/**
 * Shared canonical→native agent-id mapping for OpenCode. Used both at spawn
 * time (`buildOpencodeConfig` sets `default_agent`) and at runtime (the
 * descriptor's `getModeMapping` for `session/set_config_option`). Keeping
 * one source of truth so the spawn-time default and the runtime picker
 * never disagree. Plan mode is intentionally absent — opencode's plan
 * agent has no ACP-visible finalization tool, so we don't expose it.
 */
export const OPENCODE_CANONICAL_MODE_AGENT_IDS: Partial<Record<CopilotMode, string>> = {
  default: OPENCODE_COPILOT_BUILD_AGENT_ID,
  auto: OPENCODE_BUILTIN_BUILD_AGENT_ID,
};

/**
 * Spawns `opencode acp --cwd <vault>` with `OPENCODE_CONFIG_CONTENT`
 * containing decrypted BYOK keys pulled from the existing Copilot settings.
 *
 * Reuses Copilot's top-level `*ApiKey` fields so users don't have to re-enter
 * them in an Agent Mode-specific settings panel.
 */
export class OpencodeBackend implements AcpBackend {
  readonly id = "opencode" as const;
  readonly displayName = "opencode";

  async buildSpawnDescriptor(ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor> {
    const binaryPath = getSettings().agentMode?.backends?.opencode?.binaryPath;
    if (!binaryPath) {
      throw new Error(
        "opencode binary not installed. Open Agent Mode settings and install it before starting a session."
      );
    }

    const config = await buildOpencodeConfig();

    return {
      command: binaryPath,
      args: ["acp", "--cwd", ctx.vaultBasePath],
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      },
    };
  }
}

/**
 * Build the `OPENCODE_CONFIG_CONTENT` payload from current Copilot settings.
 *
 *   - Per-provider `options.apiKey` is set for any BYOK key configured in
 *     Copilot, decrypted in-process.
 *   - Each enabled `activeModel` whose provider is in `OPENCODE_PROVIDER_MAP`
 *     is registered under `provider.<id>.models.<modelName>` so OpenCode
 *     reports it in `NewSessionResponse.models.availableModels`. Built-in
 *     providers (anthropic, openai, …) carry their own models.dev snapshot
 *     so this is largely additive there; for the custom Copilot Plus
 *     provider — and for OpenRouter models the snapshot doesn't cover —
 *     the registration is what makes the model visible at all. The
 *     Agents-tab catalog modal then curates from opencode's reported
 *     `availableModels`.
 *   - The top-level `model` field carries the user's sticky preference so
 *     a fresh session boots with the right default, even before
 *     `unstable_setSessionModel` is called.
 *
 * Exported for unit tests.
 */
export async function buildOpencodeConfig(): Promise<Record<string, unknown>> {
  const s = getSettings();

  type Mapping = { providerId: string; settingsKey: keyof typeof s };
  const mappings: Mapping[] = [
    { providerId: "anthropic", settingsKey: "anthropicApiKey" },
    { providerId: "openai", settingsKey: "openAIApiKey" },
    { providerId: "google", settingsKey: "googleApiKey" },
    { providerId: "groq", settingsKey: "groqApiKey" },
    { providerId: "mistral", settingsKey: "mistralApiKey" },
    { providerId: "deepseek", settingsKey: "deepseekApiKey" },
    { providerId: "openrouter", settingsKey: "openRouterAiApiKey" },
    { providerId: "xai", settingsKey: "xaiApiKey" },
  ];

  const decrypted = await Promise.all(
    mappings.map(async (m) => {
      const raw = s[m.settingsKey];
      if (typeof raw !== "string" || !raw) return null;
      const apiKey = await getDecryptedKey(raw);
      if (!apiKey) return null;
      return { providerId: m.providerId, apiKey };
    })
  );

  type ProviderConfig = {
    npm?: string;
    name?: string;
    options?: { apiKey?: string; baseURL?: string; headers?: Record<string, string> };
    models?: Record<string, Record<string, unknown>>;
  };
  const provider: Record<string, ProviderConfig> = {};
  for (const entry of decrypted) {
    if (entry) provider[entry.providerId] = { options: { apiKey: entry.apiKey } };
  }

  // Copilot Plus speaks OpenAI's wire format but isn't a built-in OpenCode
  // provider. Register it as a custom `@ai-sdk/openai-compatible` entry
  // pointing at brevilabs and authed via the user's `plusLicenseKey`.
  if (typeof s.plusLicenseKey === "string" && s.plusLicenseKey) {
    const licenseKey = await getDecryptedKey(s.plusLicenseKey);
    if (licenseKey) {
      provider[COPILOT_PLUS_PROVIDER_ID] = {
        npm: "@ai-sdk/openai-compatible",
        name: "Copilot Plus",
        options: { baseURL: BREVILABS_MODELS_BASE_URL, apiKey: licenseKey },
      };
    }
  }

  // Register Copilot-configured models under their respective providers so
  // OpenCode treats them as known when reporting `availableModels`. When the
  // top-level provider key is absent, fall back to the per-model `apiKey` so
  // models the user configured with a model-specific key still reach the
  // agent. Without this fallback any such model would be silently dropped.
  const injected: string[] = [];
  for (const model of s.activeModels ?? []) {
    if (!model.enabled) continue;
    if (model.isEmbeddingModel) continue;
    const providerId = OPENCODE_PROVIDER_MAP[model.provider as ChatModelProviders];
    if (!providerId) continue;

    if (!provider[providerId]) {
      const perModel = model.apiKey ? await getDecryptedKey(model.apiKey) : null;
      if (!perModel) {
        logWarn(
          `[AgentMode] skipping ${model.provider}/${model.name}: no API key (set the provider key in Copilot settings or on the model itself)`
        );
        continue;
      }
      provider[providerId] = { options: { apiKey: perModel } };
    }

    if (!provider[providerId].models) provider[providerId].models = {};
    provider[providerId].models[model.name] = {};
    injected.push(`${providerId}/${model.name}`);
  }

  if (injected.length > 0) {
    logInfo(
      `[AgentMode] injected ${injected.length} model(s) into opencode config: ${injected.join(", ")}`
    );
  } else if (Object.keys(provider).length === 0) {
    logInfo(
      "[AgentMode] no BYOK keys found; opencode will rely on its own auth. Set provider keys in Copilot settings to use Agent Mode end-to-end."
    );
  }

  const config: Record<string, unknown> = { provider };

  // Inject a managed `copilot-build` agent so the mode picker can offer the
  // canonical "default" semantic — let the agent edit, but ask first. The
  // built-in `build` agent never asks (used as our `auto` mode); it doesn't
  // cover ask-before-write, hence the custom agent.
  //
  // Both agents also carry a Copilot-authored `prompt` that overrides
  // opencode's provider-default prompt picker (`session/system.ts`). Without
  // this override, Copilot Plus model names (e.g. `copilot-plus-flash`) miss
  // every substring branch and fall through to the generic `default.txt`
  // CLI-coding-agent prompt — wrong domain for an Obsidian vault assistant.
  // opencode's `cfg.agent.<id>` merge is field-wise, so adding `prompt` to
  // the built-in `build` agent leaves its native permissions intact.
  const basePrompt = selectCopilotPrompt(
    s.agentMode?.backends?.opencode?.defaultModel?.baseModelId
  );
  // Append the spawn-time skill-creation directive so agent-authored skills
  // land in the canonical managed folder instead of `.opencode/skills/`.
  // Folder is read live from settings on each spawn — see the Skills
  // Management spec.
  const skillsFolder = s.agentMode?.skills?.folder ?? DEFAULT_SKILLS_FOLDER;
  const skillManagerReady = SkillManager.hasInstance();
  const skillsDirs = skillManagerReady
    ? Object.values(SkillManager.getInstance().getAgentDirsProjectRel())
    : [];
  const prompt = `${basePrompt}\n\n${buildSkillCreationDirective("opencode", skillsFolder, skillsDirs)}`;
  config.agent = {
    [OPENCODE_BUILTIN_BUILD_AGENT_ID]: {
      prompt,
    },
    [OPENCODE_COPILOT_BUILD_AGENT_ID]: {
      mode: "primary",
      permission: { bash: "ask", edit: "ask" },
      prompt,
    },
  };

  // Apply sticky model preference at spawn so the very first turn (before
  // `unstable_setSessionModel` lands) uses the user's pick. The persisted
  // shape is `{ baseModelId, effort }` where `baseModelId` is opencode's
  // `<provider>/<model>` form — append the effort suffix when present.
  const defaultModel = s.agentMode?.backends?.opencode?.defaultModel;
  if (defaultModel?.baseModelId) {
    config.model = defaultModel.effort
      ? `${defaultModel.baseModelId}/${defaultModel.effort}`
      : defaultModel.baseModelId;
  }

  // Apply sticky mode preference at spawn via OpenCode's `default_agent` so
  // the first turn already runs in the user's chosen agent — closes the
  // cold-start gap where the `mode` configOption isn't yet registered.
  // Falls back to canonical `default` (ask-before-write `copilot-build`);
  // otherwise OpenCode would land on its no-ask built-in `build` agent.
  const selectedMode = s.agentMode?.backends?.opencode?.selectedMode ?? "default";
  config.default_agent =
    OPENCODE_CANONICAL_MODE_AGENT_IDS[selectedMode] ?? OPENCODE_COPILOT_BUILD_AGENT_ID;

  // Synthesize deny rules for managed skills that OpenCode would
  // cross-discover (via `.claude/skills/` and `.agents/skills/`) but are
  // not enabled for OpenCode in their `metadata.copilot-enabled-agents`.
  // Read SkillManager live at spawn time — same pattern as the
  // skill-creation directive. If SkillManager isn't initialised yet (plugin
  // still booting; OpenCode session spawned before the Skills tab has
  // hydrated), fall back to an empty deny list — the next reconciliation
  // pass + session restart closes the eventual-consistency window.
  //
  // Note: we intentionally do NOT set `OPENCODE_DISABLE_EXTERNAL_SKILLS` or
  // `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`. We want OpenCode to walk the
  // cross-discovery paths so the per-name `permission.skill.<name> = "deny"`
  // entries below can take effect.
  if (!skillManagerReady) {
    // SkillManager initialises asynchronously from `main.ts onload`. If
    // OpenCode spawns before that finishes, we ship an empty deny list
    // for this session — the next OpenCode spawn (after SkillManager
    // hydrates) gets the correct one.
    logInfo(
      "[AgentMode] SkillManager not yet initialised at OpenCode spawn — shipping empty deny list; next session will pick it up."
    );
  }
  const managedSkills = skillManagerReady ? getManagedSkills() : [];
  const denyNames = composeDenyList(
    managedSkills,
    OpencodeBackendDescriptor.id,
    OpencodeBackendDescriptor.crossDiscoveredAgents
  );
  if (denyNames.length > 0) {
    // Be additive: opencode's config schema allows `permission` as a
    // top-level key with sub-fields (`skill`, `tool`, `write`, …). Preserve
    // any existing `permission.*` settings the user may have provided
    // through other surfaces.
    const existingPermission = config.permission as Record<string, unknown> | undefined;
    const existingSkillMap = existingPermission?.skill as Record<string, string> | undefined;
    const mergedSkillMap: Record<string, string> = { ...(existingSkillMap ?? {}) };
    for (const name of denyNames) {
      // User-provided entries win — if the user explicitly allowed a skill
      // we'd otherwise deny, respect their override.
      if (!(name in mergedSkillMap)) mergedSkillMap[name] = "deny";
    }
    config.permission = {
      ...(existingPermission ?? {}),
      skill: mergedSkillMap,
    };
    logInfo(
      `[AgentMode] opencode deny list: ${denyNames.length} cross-discovered skill(s) denied (${denyNames.join(", ")})`
    );
  }

  return config;
}
