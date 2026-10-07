import { parseVersionFromStdout, verifyOpencodeBinary } from "./OpencodeBinaryManager";
import { assertBinaryCompatible } from "@/agentMode/backends/shared/binaryCompatibility";
import { OPENCODE_MIN_VERSION } from "./ui/opencodeVersion";
import { ChatModelProviders } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import type { CopilotSettings } from "@/settings/model";
import { providerNeedsResolvedApiKey } from "@/modelManagement";
import { isCatalogProviderDefaultEndpoint } from "@/utils/providerBaseUrl";
import type { BackendConfigRegistry, ProviderRegistry } from "@/modelManagement";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import type { CopilotMode } from "@/agentMode/session/types";
import { composeDenyList, getManagedSkills, SkillManager } from "@/agentMode/skills";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  buildBuiltinSkillEnv,
  sanitizeBuiltinSkillEnvOverrides,
} from "@/agentMode/backends/shared/builtinSkillEnv";
import { OpencodeBackendDescriptor } from "./descriptor";
import { copilotPlusModelId, mapProviderToOpencodeId } from "./opencodeModelResolve";
import { opencodeServerFailureCause } from "./opencodeServerFailure";
import type { PlanUsageReading } from "@/agentMode/session/planUsage";
import { CopilotPlusUsageReader } from "@/agentMode/backends/shared/copilotPlusUsage";
import type { SelfHostWebSearchAgentChannel } from "@/LLMProviders/selfHostServices";
import type { Config } from "@opencode/schema/config";

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

const OPENCODE_COPILOT_BUILD_AGENT_ID = "copilot-build";

const OPENCODE_BUILTIN_BUILD_AGENT_ID = "build";

export const OPENCODE_CANONICAL_MODE_AGENT_IDS: Partial<Record<CopilotMode, string>> = {
  default: OPENCODE_COPILOT_BUILD_AGENT_ID,
  auto: OPENCODE_BUILTIN_BUILD_AGENT_ID,
};

export interface OpencodeModelDeps {
  providerRegistry: ProviderRegistry;
  backendConfigRegistry: BackendConfigRegistry;
  clientVersion?: string;
  getCacheRoot?: () => string | undefined;
  getSelfHostWebSearchChannel?: () => Promise<Readonly<SelfHostWebSearchAgentChannel>>;
}

export class OpencodeBackend implements AcpBackend {
  readonly id = "opencode" as const;
  readonly displayName = "opencode";

  readonly #deps: OpencodeModelDeps;

  readonly #copilotPlus = new CopilotPlusUsageReader();

  constructor(deps: OpencodeModelDeps) {
    this.#deps = deps;
  }

  async readPlanUsage(): Promise<PlanUsageReading> {
    return this.#copilotPlus.readPlanUsage();
  }

  // A user on their own key reaches this backend too and must see no cap meters.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/193
  planUsageAppliesTo(wireModelId: string | null | undefined): boolean {
    return copilotPlusModelId(wireModelId) !== null;
  }

  async readContextWindow(wireModelId: string | null | undefined): Promise<number | null> {
    return this.#copilotPlus.readContextWindow(copilotPlusModelId(wireModelId));
  }

  failureCauseFromLog(stderrLine: string): string | null {
    return opencodeServerFailureCause(stderrLine);
  }

  async buildSpawnDescriptor(ctx: {
    vaultBasePath: string;
    vaultName?: string;
  }): Promise<AcpSpawnDescriptor> {
    const settings = getSettings();
    const binaryPath = settings.agentMode?.backends?.opencode?.binaryPath;
    if (!binaryPath) {
      throw new Error(
        "opencode binary not installed. Open Agent Mode settings and install it before starting a session."
      );
    }

    // Persisted versions can lag a custom executable replaced outside Copilot. https://github.com/Brevilabs/obsidian-copilot-private/issues/535
    const runtimeVersion =
      parseVersionFromStdout((await verifyOpencodeBinary(binaryPath)).stdout) ?? "";
    const source = settings.agentMode?.backends?.opencode?.binarySource ?? "managed";
    assertBinaryCompatible(
      { kind: "installed", version: runtimeVersion, source },
      OPENCODE_MIN_VERSION,
      this.displayName
    );

    const cacheRoot = normalizeCacheRoot(this.#deps.getCacheRoot?.());
    const envOverrides = sanitizeBuiltinSkillEnvOverrides(
      settings.agentMode?.backends?.opencode?.envOverrides
    );
    const configOverride = envOverrides.OPENCODE_CONFIG_CONTENT;
    delete envOverrides.OPENCODE_CONFIG_CONTENT;
    let configContent =
      configOverride ?? JSON.stringify(await buildOpencodeConfig(settings, this.#deps, cacheRoot));
    if (settings.enableSelfHostMode === true && configOverride !== undefined) {
      // An explicit config override must not reopen agent-native web tools while
      // Self-Host mode promises that queries stay on the configured route.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/558
      let overriddenConfig: Record<string, unknown>;
      try {
        const parsed = JSON.parse(configOverride) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        overriddenConfig = parsed as Record<string, unknown>;
      } catch {
        throw new Error("opencode OPENCODE_CONFIG_CONTENT must be a JSON object.");
      }
      const legacyKeys = OPENCODE_1_PERMISSION_KEYS.filter(
        (key) => overriddenConfig[key] !== undefined
      );
      if (legacyKeys.length > 0) {
        throw new Error(
          `opencode OPENCODE_CONFIG_CONTENT uses OpenCode 1 keys (${legacyKeys.join(", ")}); ` +
            "Self-Host Mode requires the OpenCode 2 `permissions` and `agents` keys."
        );
      }
      overriddenConfig.permissions = appendNativeWebDenies(overriddenConfig.permissions);
      for (const agent of agentConfigs(overriddenConfig.agents)) {
        agent.permissions = appendNativeWebDenies(agent.permissions);
      }
      configContent = JSON.stringify(overriddenConfig);
    }
    if (cacheRoot && configOverride !== undefined) {
      logWarn(
        "[AgentMode] opencode envOverrides.OPENCODE_CONFIG_CONTENT replaces the generated config; " +
          "the context-cache external_directory allow rule is dropped — opencode will prompt on every " +
          "snapshot read. Remove that override to restore silent cache access."
      );
    }
    const selfHostSearchChannel =
      settings.enableSelfHostMode === true
        ? await this.#deps.getSelfHostWebSearchChannel?.()
        : undefined;
    if (settings.enableSelfHostMode === true && !selfHostSearchChannel) {
      throw new Error("Copilot self-host web search channel is unavailable.");
    }

    const builtinSkillEnv = await buildBuiltinSkillEnv(
      this.#deps.clientVersion,
      ctx.vaultBasePath,
      ctx.vaultName,
      selfHostSearchChannel
    );

    return {
      command: binaryPath,
      // The private server inherits stderr only when ACP enables log printing.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/561
      args: ["acp", "--print-logs"],
      // OpenCode uses the process directory for project discovery; its ACP
      // command has no --cwd flag. https://github.com/Brevilabs/obsidian-copilot-private/issues/555
      cwd: ctx.vaultBasePath,
      env: {
        ...process.env,
        ...builtinSkillEnv,
        // OpenCode's level filters its file log and stderr together, and its
        // server logs request-failure causes at INFO, so WARN hid every cause.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/650
        OPENCODE_LOG_LEVEL: "INFO",
        ...envOverrides,
        OPENCODE_CONFIG_CONTENT: configContent,
      },
    };
  }
}

function normalizeCacheRoot(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function agentConfigs(agents: unknown): Record<string, unknown>[] {
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return [];
  return Object.values(agents).filter(
    (agent): agent is Record<string, unknown> =>
      !!agent && typeof agent === "object" && !Array.isArray(agent)
  );
}

// OpenCode 2 uses the last matching native rule.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/558
function appendNativeWebDenies(permissions: unknown): unknown[] {
  return [...(Array.isArray(permissions) ? permissions : []), ...NATIVE_WEB_DENIES];
}

type OpencodeConfig = typeof Config.Info.Encoded;
export type GeneratedOpencodeConfig = OpencodeConfig &
  Required<Pick<OpencodeConfig, "providers" | "agents">>;
type ProviderConfig = NonNullable<OpencodeConfig["providers"]>[string];
type ModelConfig = NonNullable<ProviderConfig["models"]>[string];
type ModelVariant = NonNullable<ModelConfig["variants"]>[number];
type PermissionRule = NonNullable<OpencodeConfig["permissions"]>[number];

// Prompt steering cannot keep Self-Host queries local: opencode's native web tools contact its own services directly.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/165
const NATIVE_WEB_DENIES: readonly PermissionRule[] = [
  { action: "websearch", resource: "*", effect: "deny" },
  { action: "webfetch", resource: "*", effect: "deny" },
];

const OPENCODE_1_PERMISSION_KEYS = ["permission", "tools", "agent", "mode"] as const;

export async function buildOpencodeConfig(
  s: CopilotSettings,
  deps: OpencodeModelDeps,
  cacheRoot?: string
): Promise<GeneratedOpencodeConfig> {
  const { providerRegistry, backendConfigRegistry } = deps;

  const providers: Record<string, ProviderConfig> = {};
  const modelsByProvider: Record<string, Record<string, ModelConfig>> = {};
  const injected: string[] = [];

  for (const entry of backendConfigRegistry.resolveEnabled("opencode")) {
    if (entry.state !== "ok") continue;
    const mapping = mapProviderToOpencodeId(entry.provider);
    if (!mapping) continue;
    if (mapping.native) continue;

    const origin = entry.provider.origin;
    const catalogProviderId = origin.kind === "byok" ? origin.catalogProviderId : undefined;
    const hasCatalogIdentity = !!catalogProviderId;

    let models = modelsByProvider[mapping.id];
    if (!models) {
      const apiKey = await providerRegistry.getApiKey(entry.provider.providerId);
      // Runtime auth follows the persisted provider contract and keychain state,
      // not hostname shape. A dangling keychain pointer must fail closed.
      // https://github.com/logancyang/obsidian-copilot/issues/2895
      if (!apiKey && providerNeedsResolvedApiKey(entry.provider)) {
        logInfo(
          `[AgentMode] skipping ${mapping.id}/${entry.configuredModel.info.id}: no API key in keychain`
        );
        continue;
      }
      const rawBaseURL = entry.provider.baseUrl;
      if (!hasCatalogIdentity && !rawBaseURL) {
        logInfo(
          `[AgentMode] skipping ${mapping.id}/${entry.configuredModel.info.id}: ${origin.kind} provider has no baseUrl`
        );
        continue;
      }
      const baseURL =
        hasCatalogIdentity &&
        rawBaseURL &&
        isCatalogProviderDefaultEndpoint(catalogProviderId, rawBaseURL)
          ? undefined
          : rawBaseURL;
      models = {};
      modelsByProvider[mapping.id] = models;
      providers[mapping.id] = {
        package: hasCatalogIdentity ? undefined : "aisdk:@ai-sdk/openai-compatible",
        name: hasCatalogIdentity ? undefined : entry.provider.displayName,
        settings: {
          ...(apiKey ? { apiKey } : {}),
          ...(baseURL ? { baseURL } : {}),
        },
        headers:
          origin.kind === "copilot-plus" && deps.clientVersion
            ? { "X-Client-Version": deps.clientVersion }
            : undefined,
        models,
      };
    }

    const { info } = entry.configuredModel;
    // Unknown custom models must start text-only. OpenCode 2 replaces a model's
    // capabilities wholesale, so a catalog model keeps its native entry unless
    // Copilot knows every field rather than inheriting guessed defaults.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/557
    const declaresCapabilities =
      !hasCatalogIdentity ||
      (info.modalities?.input && info.modalities.output && info.toolCall !== undefined);
    // OpenCode's native catalog owns BYOK variants. Otherwise only a published
    // list is trusted: a guessed level either fails the turn or is silently
    // ignored, so a model with no list stays at its default effort.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/557
    const levels = info.reasoning ? (info.reasoningEfforts ?? []) : [];
    models[info.id] = {
      // An injected Plus model falls back to OpenCode's 200k default without its published context.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/644
      limit:
        origin.kind === "copilot-plus" && info.limits?.context
          ? { context: info.limits.context }
          : undefined,
      capabilities: declaresCapabilities
        ? {
            tools: info.toolCall ?? true,
            input: info.modalities?.input ?? ["text"],
            output: info.modalities?.output ?? ["text"],
          }
        : undefined,
      variants: hasCatalogIdentity
        ? undefined
        : levels.map(
            (level): ModelVariant => ({ id: level, settings: { reasoningEffort: level } })
          ),
    };
    injected.push(`${mapping.id}/${info.id}`);
  }

  if (injected.length > 0) {
    logInfo(
      `[AgentMode] injected ${injected.length} model(s) into opencode config: ${injected.join(", ")}`
    );
  } else if (Object.keys(providers).length === 0) {
    logInfo(
      "[AgentMode] no enabled BYOK models found; opencode will rely on its own auth. Add and enable models for opencode in Copilot settings to use Agent Mode end-to-end."
    );
  }

  const permissions: PermissionRule[] = [
    // OpenCode's ACP bridge cancels every native question (session form) before
    // Copilot can show them, so the turn ends as if the user pressed Stop:
    // https://github.com/anomalyco/opencode/blob/04f4b0610c79e3692f3b91bd7e4489c2c7010e4b/packages/cli/src/acp/event.ts#L178-L183
    // Remove this deny once OpenCode forwards questions as ACP elicitations
    // (https://github.com/anomalyco/opencode/issues/38121) and Copilot renders
    // them (https://github.com/Brevilabs/obsidian-copilot-private/issues/551).
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/559
    { action: "question", resource: "*", effect: "deny" },
  ];

  const selfHost = s.enableSelfHostMode === true;
  if (selfHost) permissions.push(...NATIVE_WEB_DENIES);

  const skillManagerReady = SkillManager.hasInstance();
  const system = buildAgentSystemPrompt(OpencodeBackendDescriptor.id);

  const cacheRules: PermissionRule[] = cacheRoot
    ? [{ action: "external_directory", resource: `${cacheRoot}/**`, effect: "allow" }]
    : [];

  if (!skillManagerReady) {
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
    for (const name of denyNames) {
      permissions.push({ action: "skill", resource: name, effect: "deny" });
    }
    logInfo(
      `[AgentMode] opencode deny list: ${denyNames.length} cross-discovered skill(s) denied (${denyNames.join(", ")})`
    );
  }

  return {
    providers,
    // OpenCode's variant plugin guesses effort levels from model ids (glm-5.2
    // gains `max`) and merges them over configured variants, which cannot be
    // disabled individually. Only published levels are trusted, so drop it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/557
    plugins: ["-opencode.variant"],
    // Without a configured provider, native web search asks the user to pick
    // one through OpenCode's form service, and OpenCode's ACP bridge cancels
    // every form, so each search ends as "Web search cancelled". "random" is
    // OpenCode's own keyless rotation across its built-in providers.
    // https://github.com/anomalyco/opencode/issues/38121
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/599
    websearch: { provider: "random" },
    permissions,
    agents: {
      [OPENCODE_BUILTIN_BUILD_AGENT_ID]: {
        system,
        permissions: cacheRules.length > 0 ? cacheRules : undefined,
      },
      [OPENCODE_COPILOT_BUILD_AGENT_ID]: {
        mode: "primary",
        system,
        permissions: [
          { action: "shell", resource: "*", effect: "ask" },
          { action: "edit", resource: "*", effect: "ask" },
          // Native web search contacts third-party providers, so the ask-first
          // agent asks through an ordinary ACP permission request. Agent rules
          // follow top-level ones and the last match wins, so Self-Host leaves
          // this out to keep its top-level deny decisive.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/599
          ...(selfHost ? [] : [{ action: "websearch", resource: "*", effect: "ask" } as const]),
          ...cacheRules,
        ],
      },
    },
    default_agent: OPENCODE_COPILOT_BUILD_AGENT_ID,
  };
}
