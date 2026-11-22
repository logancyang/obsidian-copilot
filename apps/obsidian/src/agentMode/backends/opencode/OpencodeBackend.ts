import { parseVersionFromStdout, verifyOpencodeBinary } from "./OpencodeBinaryManager";
import { assertBinaryCompatible } from "@/agentMode/backends/shared/binaryCompatibility";
import { OPENCODE_MIN_VERSION } from "./ui/opencodeVersion";
import { readOpencodeCopilotTools } from "./opencodeCopilotToolCalls";
import { ChatModelProviders } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import type { App } from "obsidian";
import { getSettings } from "@/settings/model";
import type { CopilotSettings } from "@/settings/model";
import { providerNeedsResolvedApiKey } from "@/modelManagement";
import { isCatalogProviderDefaultEndpoint, opencodeSdkBaseUrl } from "@/utils/providerBaseUrl";
import { agentShellPath } from "@/utils/loginShellPath";
import type { BackendConfigRegistry, ProviderRegistry } from "@/modelManagement";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import type { BackendConfigOption, CopilotMode, SessionAgent } from "@/agentMode/session/types";
import { composeDenyList, getManagedSkills, SkillManager } from "@/agentMode/skills";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { COPILOT_CHAT_PROMPT } from "@/agentMode/session/copilotChatPrompt";
import { pythonUtf8Env } from "@/agentMode/backends/shared/pythonUtf8Env";
import {
  buildBuiltinSkillEnv,
  sanitizeBuiltinSkillEnvOverrides,
} from "@/agentMode/backends/shared/builtinSkillEnv";
import { OpencodeBackendDescriptor } from "./descriptor";
import { copilotPlusModelId, mapProviderToOpencodeId } from "./opencodeModelResolve";
import type { PlanUsageReading } from "@/agentMode/session/planUsage";
import { CopilotPlusUsageReader } from "@/agentMode/backends/shared/copilotPlusUsage";
import type { SelfHostWebSearchAgentChannel } from "@/LLMProviders/selfHostServices";
import type { Config } from "@opencode/schema/config";
import { installOpencodeCopilotPlugin } from "./opencodeCopilotPlugin";
import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import {
  createAgentsFolder,
  customAgentModeId,
  putAgentEntries,
  readCustomAgentModeId,
  startAgentEntries,
} from "./opencodeCustomAgents";

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

export const OPENCODE_MODE_CONFIG_OPTION_ID = "mode";

export const OPENCODE_CANONICAL_MODE_AGENT_IDS: Partial<Record<CopilotMode, string>> = {
  default: OPENCODE_COPILOT_BUILD_AGENT_ID,
  auto: OPENCODE_BUILTIN_BUILD_AGENT_ID,
};

export interface OpencodeModelDeps {
  app: App;
  providerRegistry: ProviderRegistry;
  backendConfigRegistry: BackendConfigRegistry;
  clientVersion?: string;
  getCopilotPluginDir?: () => string;
  getSelfHostWebSearchChannel?: () => Promise<Readonly<SelfHostWebSearchAgentChannel>>;
  readCopilotReadOnlyToolNames?: () => Promise<ReadonlyArray<string>>;
  customAgentsFile?: string;
}

interface CustomAgentsTarget {
  file: string;
  configContent: string;
}

export class OpencodeBackend implements AcpBackend {
  readonly id = "opencode" as const;
  readonly displayName = "opencode";
  readonly readCopilotTools = readOpencodeCopilotTools;

  readonly #deps: OpencodeModelDeps;

  readonly #copilotPlus = new CopilotPlusUsageReader();

  #customAgents: CustomAgentsTarget | null = null;

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

  async buildSpawnDescriptor(ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor> {
    const settings = getSettings();
    const binaryPath = settings.agentMode?.backends?.opencode?.binaryPath;
    if (!binaryPath) {
      throw new Error(
        "OpenCode isn't installed. Install it in Settings → Copilot → Basic → Agents, then start a new chat."
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

    const envOverrides = sanitizeBuiltinSkillEnvOverrides(
      settings.agentMode?.backends?.opencode?.envOverrides
    );
    const configOverride = envOverrides.OPENCODE_CONFIG_CONTENT;
    delete envOverrides.OPENCODE_CONFIG_CONTENT;
    const pluginDir =
      this.#deps.getCopilotPluginDir &&
      (await installOpencodeCopilotPlugin(this.#deps.getCopilotPluginDir()));
    let configContent =
      configOverride ?? JSON.stringify(await buildOpencodeConfig(settings, this.#deps, pluginDir));
    if (configOverride !== undefined && (pluginDir || settings.enableSelfHostMode === true)) {
      let overriddenConfig: Record<string, unknown>;
      try {
        const parsed = JSON.parse(configOverride) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        overriddenConfig = parsed as Record<string, unknown>;
      } catch {
        throw new Error("opencode OPENCODE_CONFIG_CONTENT must be a JSON object.");
      }
      if (pluginDir) {
        // ACP-added MCP servers need the same direct-call policy even with a user's custom configuration.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/875
        const plugins = (overriddenConfig.plugins as OpencodeConfig["plugins"]) ?? [];
        overriddenConfig.plugins = [...new Set([...plugins, pluginDir])];
      }
      if (settings.enableSelfHostMode === true) {
        overriddenConfig.permissions = appendNativeWebDenies(overriddenConfig.permissions);
        for (const agent of agentConfigs(overriddenConfig.agents)) {
          agent.permissions = appendNativeWebDenies(agent.permissions);
        }
      }
      configContent = JSON.stringify(overriddenConfig);
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
      selfHostSearchChannel
    );
    // A user's own OPENCODE_CONFIG keeps working; custom agents then cannot run on OpenCode.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/937
    const ownsConfigFile =
      envOverrides.OPENCODE_CONFIG === undefined && process.env.OPENCODE_CONFIG === undefined;
    this.#customAgents =
      ownsConfigFile && this.#deps.customAgentsFile
        ? { file: this.#deps.customAgentsFile, configContent }
        : null;
    if (this.#customAgents) {
      startAgentEntries(this.#customAgents.file);
      // Custom agents must never stop OpenCode from starting for a chat that does not use them.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/937
      await createAgentsFolder(this.#customAgents.file).catch((e: unknown) =>
        logWarn("[AgentMode] could not create the OpenCode custom agents folder", e)
      );
    }

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
        PATH: await agentShellPath(),
        ...pythonUtf8Env(),
        ...builtinSkillEnv,
        // OpenCode's level filters its file log and stderr together, and its
        // server logs request-failure causes at INFO, so WARN hid every cause.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/650
        OPENCODE_LOG_LEVEL: "INFO",
        ...envOverrides,
        ...(this.#customAgents ? { OPENCODE_CONFIG: this.#customAgents.file } : {}),
        OPENCODE_CONFIG_CONTENT: configContent,
      },
    };
  }

  // OpenCode runs a custom agent as one of its own agents, defined in the watched OPENCODE_CONFIG file and chosen with the session's mode.
  // A chat whose agent cannot load leaves that agent's mode, since a mode whose agent is gone from the file hangs the next turn.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/937
  async selectAgentMode(
    agent: SessionAgent | null,
    configOptions: readonly BackendConfigOption[] | null
  ): Promise<{ configId: string; value: string } | null> {
    const current = configOptions?.find(
      (option) => option.id === OPENCODE_MODE_CONFIG_OPTION_ID
    )?.currentValue;
    const running = typeof current === "string" ? readCustomAgentModeId(current) : null;
    if (!agent) {
      if (!running) return null;
      return {
        configId: OPENCODE_MODE_CONFIG_OPTION_ID,
        value: running.auto ? OPENCODE_BUILTIN_BUILD_AGENT_ID : OPENCODE_COPILOT_BUILD_AGENT_ID,
      };
    }
    const target = this.#customAgents;
    if (!target) {
      throw new Error("Copilot Teammates can't run on OpenCode while OPENCODE_CONFIG is set.");
    }
    const spawnAgents = (JSON.parse(target.configContent) as OpencodeConfig).agents ?? {};
    const define = (baseId: string, auto: boolean): [string, unknown] => {
      const base = spawnAgents[baseId] ?? {};
      return [
        customAgentModeId({ slug: agent.slug, variant: agent.variant, auto }),
        {
          ...base,
          mode: "primary",
          // The base entry also tells a Copilot chat it is Copilot, so an agent's entry starts from the shared prompt instead of the base's text.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/986
          system: [buildAgentSystemPrompt(this.id, this.#deps.app), agent.prompt]
            .filter(Boolean)
            .join("\n\n"),
        },
      ];
    };
    await putAgentEntries(
      target.file,
      Object.fromEntries([
        define(OPENCODE_COPILOT_BUILD_AGENT_ID, false),
        define(OPENCODE_BUILTIN_BUILD_AGENT_ID, true),
      ])
    );
    const auto = running?.auto ?? current === OPENCODE_BUILTIN_BUILD_AGENT_ID;
    return {
      configId: OPENCODE_MODE_CONFIG_OPTION_ID,
      value: customAgentModeId({ slug: agent.slug, variant: agent.variant, auto }),
    };
  }
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

export async function buildOpencodeConfig(
  s: CopilotSettings,
  deps: OpencodeModelDeps,
  copilotPluginDir?: string
): Promise<GeneratedOpencodeConfig> {
  const { providerRegistry, backendConfigRegistry } = deps;

  const providers: Record<string, ProviderConfig> = {};
  const modelsByProvider: Record<string, Record<string, ModelConfig>> = {};
  const injected: string[] = [];
  const nativeRunnable: string[] = [];

  for (const entry of backendConfigRegistry.resolveEnabled("opencode")) {
    if (entry.state !== "ok") continue;
    const mapping = mapProviderToOpencodeId(entry.provider);
    if (!mapping) continue;
    if (mapping.native) {
      nativeRunnable.push(entry.configuredModel.info.id);
      continue;
    }

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
          : opencodeSdkBaseUrl(catalogProviderId, rawBaseURL);
      models = {};
      modelsByProvider[mapping.id] = models;
      providers[mapping.id] = {
        // OpenCode prefers a provider's env var (DEEPSEEK_API_KEY) over this key, so a stale one fails every turn.
        // https://github.com/logancyang/obsidian-copilot/issues/3837
        env: apiKey ? [] : undefined,
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
      // A model OpenCode's catalog does not know falls back to its 200k default without the
      // context Copilot Plus publishes or the user's endpoint reports.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/644
      // https://github.com/logancyang/obsidian-copilot/issues/3840
      limit:
        !hasCatalogIdentity && info.limits?.context ? { context: info.limits.context } : undefined,
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
    // session_move points the session's working directory away from the vault.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/665
    { action: "opencode_session_move", resource: "*", effect: "deny" },
  ];

  const selfHost = s.enableSelfHostMode === true;
  if (selfHost) permissions.push(...NATIVE_WEB_DENIES);

  const readOnlyCopilotTools = (await deps.readCopilotReadOnlyToolNames?.()) ?? [];
  const skillManagerReady = SkillManager.hasInstance();
  // A Copilot chat runs on these entries, so they carry its part the way an agent's entry carries the agent's.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/986
  const system = [
    buildAgentSystemPrompt(OpencodeBackendDescriptor.id, deps.app),
    COPILOT_CHAT_PROMPT,
  ]
    .filter(Boolean)
    .join("\n\n");

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

  // `session/new` cannot name a model, so without this every session opens on an OpenCode free
  // model the user never enabled before Copilot switches it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/766
  const runnable = [...injected, ...nativeRunnable];
  const savedDefault = s.agentMode?.backends?.opencode?.defaultModel?.baseModelId;
  const startupModel = runnable.find((id) => id === savedDefault) ?? runnable[0];

  return {
    ...(startupModel ? { model: startupModel } : {}),
    providers,
    // OpenCode's variant plugin guesses effort levels from model ids (glm-5.2
    // gains `max`) and merges them over configured variants, which cannot be
    // disabled individually. Only published levels are trusted, so drop it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/557
    plugins: ["-opencode.variant", ...(copilotPluginDir ? [copilotPluginDir] : [])],
    // Without a configured provider, native web search asks the user to pick
    // one through OpenCode's form service, and OpenCode's ACP bridge cancels
    // every form, so each search ends as "Web search cancelled". "random" is
    // OpenCode's own keyless rotation across its built-in providers.
    // https://github.com/anomalyco/opencode/issues/38121
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/599
    websearch: { provider: "random" },
    permissions,
    agents: {
      [OPENCODE_BUILTIN_BUILD_AGENT_ID]: { system },
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
          // OpenCode runs MCP tools without asking, even from its execute tool, so the ask-first
          // agent asks before every Copilot tool not marked read-only, as Claude and Codex do.
          // Its action for a tool is `<server>_<tool>` with other characters than [A-Za-z0-9_-] as `_`.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
          { action: `${COPILOT_MCP_SERVER_NAME}_*`, resource: "*", effect: "ask" },
          ...readOnlyCopilotTools.map(
            (name): PermissionRule => ({
              action: `${COPILOT_MCP_SERVER_NAME}_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
              resource: "*",
              effect: "allow",
            })
          ),
        ],
      },
    },
    default_agent: OPENCODE_COPILOT_BUILD_AGENT_ID,
  };
}
