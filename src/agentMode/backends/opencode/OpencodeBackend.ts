import { ChatModelProviders } from "@/constants";
import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import type { CopilotSettings } from "@/settings/model";
import { isSelfHostedProvider } from "@/modelManagement";
import { isCatalogProviderDefaultEndpoint } from "@/utils/providerBaseUrl";
import type { BackendConfigRegistry, ProviderRegistry } from "@/modelManagement";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import type { CopilotMode } from "@/agentMode/session/types";
import { composeDenyList, getManagedSkills, SkillManager } from "@/agentMode/skills";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { buildCopilotPlusEnv } from "@/agentMode/backends/shared/copilotPlusEnv";
import { OpencodeBackendDescriptor } from "./descriptor";
import { mapProviderToOpencodeId } from "./opencodeModelResolve";

/**
 * Maps Copilot's `ChatModelProviders` to OpenCode's provider id. Used for the
 * picker's wire-codec provider-grouping; config injection derives provider ids
 * from the data model via `mapProviderToOpencodeId` instead.
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

/** Registries `buildOpencodeConfig` needs; injected so it stays unit-testable with plain mocks. */
export interface OpencodeModelDeps {
  providerRegistry: ProviderRegistry;
  backendConfigRegistry: BackendConfigRegistry;
}

/**
 * Spawns `opencode acp --cwd <vault>` with an `OPENCODE_CONFIG_CONTENT` payload
 * built from the user's enabled BYOK models. The registries are injected by the
 * descriptor from `plugin.modelManagement`.
 */
export class OpencodeBackend implements AcpBackend {
  readonly id = "opencode" as const;
  readonly displayName = "opencode";

  readonly #deps: OpencodeModelDeps;

  constructor(deps: OpencodeModelDeps) {
    this.#deps = deps;
  }

  async buildSpawnDescriptor(ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor> {
    const binaryPath = getSettings().agentMode?.backends?.opencode?.binaryPath;
    if (!binaryPath) {
      throw new Error(
        "opencode binary not installed. Open Agent Mode settings and install it before starting a session."
      );
    }

    const config = await buildOpencodeConfig(getSettings(), this.#deps);
    const envOverrides = getSettings().agentMode?.backends?.opencode?.envOverrides ?? {};
    // Builtin Copilot Plus skill scripts read the license from the env.
    const plusEnv = await buildCopilotPlusEnv();

    return {
      command: binaryPath,
      args: ["acp", "--cwd", ctx.vaultBasePath],
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
        ...plusEnv,
        // User overrides last — they can replace OPENCODE_CONFIG_CONTENT
        // intentionally if they need to point opencode at a different config.
        ...envOverrides,
      },
    };
  }
}

/** Mutable opencode provider config entry built into `OPENCODE_CONFIG_CONTENT`. */
type ProviderConfig = {
  npm?: string;
  name?: string;
  options?: { apiKey?: string; baseURL?: string; headers?: Record<string, string> };
  models?: Record<string, Record<string, unknown>>;
};

/**
 * Build the `OPENCODE_CONFIG_CONTENT` payload from the enabled opencode models.
 * Each non-native (BYOK / Plus) provider is registered with its keychain key
 * and its models; native (agent-origin) providers are skipped since opencode
 * already hosts them. The top-level `model` field carries the user's sticky
 * preference so a fresh session boots with the right default.
 *
 * Takes settings + registries as parameters (no singletons) so it stays
 * unit-testable.
 */
export async function buildOpencodeConfig(
  s: CopilotSettings,
  deps: OpencodeModelDeps
): Promise<Record<string, unknown>> {
  const { providerRegistry, backendConfigRegistry } = deps;

  const provider: Record<string, ProviderConfig> = {};
  const injected: string[] = [];

  for (const entry of backendConfigRegistry.resolveEnabled("opencode")) {
    if (entry.state !== "ok") continue;
    const mapping = mapProviderToOpencodeId(entry.provider);
    if (!mapping) continue;
    // opencode hosts native (agent-origin) providers itself, so never register them.
    if (mapping.native) continue;

    // opencode resolves catalog providers (those with a models.dev
    // `catalogProviderId`) natively — it knows their npm SDK and default base
    // URL, so we hand it only the apiKey (plus a baseURL when the user
    // overrode one). Everything else reaching here — custom OpenAI-compatible
    // endpoints (Ollama, LM Studio, proxies) and Copilot Plus — has no catalog
    // identity and must be registered explicitly as `@ai-sdk/openai-compatible`
    // pointed at its own baseURL.
    const origin = entry.provider.origin;
    const catalogProviderId = origin.kind === "byok" ? origin.catalogProviderId : undefined;
    const hasCatalogIdentity = !!catalogProviderId;
    // Whether a missing key should drop the provider is a separate question:
    // self-hosted endpoints commonly run key-less. Detect that from the baseUrl
    // host so it stays correct even if a local runner gains a catalog id.
    const isSelfHosted = isSelfHostedProvider(entry.provider);

    let providerConfig = provider[mapping.id];
    if (!providerConfig) {
      const apiKey = await providerRegistry.getApiKey(entry.provider.providerId);
      // Catalog BYOK / Plus providers are useless without a key; self-hosted
      // endpoints commonly run key-less, so don't drop them for a missing key.
      if (!apiKey && !isSelfHosted) {
        logInfo(
          `[AgentMode] skipping ${mapping.id}/${entry.configuredModel.info.id}: no API key in keychain`
        );
        continue;
      }
      const rawBaseURL = entry.provider.baseUrl;
      // A non-catalog provider with no baseURL is unroutable — opencode has no
      // registry default to fall back on.
      if (!hasCatalogIdentity && !rawBaseURL) {
        logInfo(
          `[AgentMode] skipping ${mapping.id}/${entry.configuredModel.info.id}: ${origin.kind} provider has no baseUrl`
        );
        continue;
      }
      // The AI SDK treats `baseURL` as the complete prefix (the versioned
      // models.dev form), but stored values are often host-only — the
      // configure dialog's Google seed, or a user trimming `/v1beta` to fix
      // legacy chat (#152). When the value is just the provider's canonical
      // endpoint in some spelling, drop it and let opencode's registry
      // default apply: that is always the correct form. Anything else is a
      // genuine proxy/gateway override and is forwarded verbatim.
      const baseURL =
        hasCatalogIdentity &&
        rawBaseURL &&
        isCatalogProviderDefaultEndpoint(catalogProviderId, rawBaseURL)
          ? undefined
          : rawBaseURL;
      // Omit apiKey/baseURL when falsy: an empty-string key reaches
      // `@ai-sdk/openai-compatible` as `Authorization: Bearer ` (silent 401),
      // and an empty baseURL would clobber opencode's registry default.
      providerConfig = {
        ...(hasCatalogIdentity
          ? {}
          : { npm: "@ai-sdk/openai-compatible", name: entry.provider.displayName }),
        options: {
          ...(apiKey ? { apiKey } : {}),
          ...(baseURL ? { baseURL } : {}),
        },
      };
      provider[mapping.id] = providerConfig;
    }

    if (!providerConfig.models) providerConfig.models = {};
    // Carry the model's known modalities into the config. opencode resolves a
    // model's capabilities as `injected ?? models.dev-catalog ?? default`, and
    // `unsupportedParts` strips image/file parts whenever `input.image` is
    // false. For catalog providers this stays in agreement with opencode's own
    // catalog; for providers opencode has no catalog entry for (Copilot Plus,
    // self-hosted OpenAI-compatible) the default is `false`, so a genuinely
    // multimodal model would have its images silently stripped. Injecting the
    // modalities we already know prevents that.
    const { info } = entry.configuredModel;
    const modelConfig: Record<string, unknown> = {};
    if (info.modalities) {
      modelConfig.modalities = info.modalities;
      if (info.modalities.input?.includes("image")) modelConfig.attachment = true;
    }
    providerConfig.models[info.id] = modelConfig;
    injected.push(`${mapping.id}/${info.id}`);
  }

  if (injected.length > 0) {
    logInfo(
      `[AgentMode] injected ${injected.length} model(s) into opencode config: ${injected.join(", ")}`
    );
  } else if (Object.keys(provider).length === 0) {
    logInfo(
      "[AgentMode] no enabled BYOK models found; opencode will rely on its own auth. Add and enable models for opencode in Copilot settings to use Agent Mode end-to-end."
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
  //
  // The prompt is the shared composed payload: the Copilot base framing (unless
  // the user disabled it), the pill-syntax directive, and the user's custom
  // prompt. the host restarts opencode on prompt changes via
  // `restartOnSystemPromptChange`.
  const skillManagerReady = SkillManager.hasInstance();
  const prompt = buildAgentSystemPrompt();
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

  // Always spawn in canonical `default` (ask-before-write `copilot-build`).
  // Mode selection is never persisted — every fresh session starts in ask
  // mode, so we pin the spawn-time `default_agent` to the canonical default
  // here. Otherwise OpenCode would land on its no-ask built-in `build` agent.
  config.default_agent = OPENCODE_COPILOT_BUILD_AGENT_ID;

  // Synthesize deny rules for managed skills that OpenCode would
  // cross-discover (via `.claude/skills/` and `.agents/skills/`) but are
  // not enabled for OpenCode in their `metadata.copilot-enabled-agents`.
  // Read SkillManager live at spawn time. If SkillManager isn't initialized
  // yet (plugin still booting; OpenCode session spawned before the Skills tab
  // has hydrated), fall back to an empty deny list — the next reconciliation
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
