import { ClaudeBackendDescriptor } from "@/agentMode/backends/claude/descriptor";
import { CodexBackendDescriptor } from "@/agentMode/backends/codex/descriptor";
import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { buildPickerCatalog, pickerCatalogSource } from "@/agentMode/session/host/pickerCatalog";
import type {
  BackendDescriptor,
  EffortOption,
  InstallState,
  ModelEntry,
  ModelSelection,
} from "@/agentMode/session/types";
import { DEFAULT_SETTINGS } from "@/constants";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

interface FakeModels {
  catalogById?: Record<string, ModelEntry[] | null>;
  preloadById?: Record<string, "pending" | "ready" | "error" | "absent">;
  effortById?: Record<string, Record<string, EffortOption[]>>;
  selectionById?: Record<string, ModelSelection>;
}

function fakeModels(opts: FakeModels = {}) {
  const managerListeners = new Set<() => void>();
  const cacheListeners = new Set<() => void>();
  const models = {
    getCachedModelCatalog: (id: string) => {
      const available = opts.catalogById?.[id];
      return available === undefined ? null : { availableModels: available };
    },
    getEffortCatalog: (id: string) => opts.effortById?.[id] ?? null,
    getPreloadStatus: (id: string) => opts.preloadById?.[id] ?? "absent",
    getDefaultSelection: (id: string) => opts.selectionById?.[id] ?? null,
    subscribe: (listener: () => void) => {
      managerListeners.add(listener);
      return () => managerListeners.delete(listener);
    },
    subscribeModelCache: (listener: () => void) => {
      cacheListeners.add(listener);
      return () => cacheListeners.delete(listener);
    },
  } as unknown as AgentSessionManager;
  return { models, managerListeners, cacheListeners };
}

function descriptor(overrides: Partial<BackendDescriptor> = {}): BackendDescriptor {
  return {
    id: "opencode",
    displayName: "OpenCode",
    selfHostable: true,
    routesCopilotModels: false,
    getInstallState: () => ({ kind: "ready", source: "managed" }),
    subscribeInstallState: () => () => {},
    ...overrides,
  } as unknown as BackendDescriptor;
}

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  agentMode: { ...DEFAULT_SETTINGS.agentMode, activeBackend: "claude" },
  copilotPlusCatalog: {
    models: [{ id: "copilot-plus-flash", displayName: "Copilot Plus Flash", description: "Fast" }],
    defaultEnabledIds: ["copilot-plus-flash"],
  },
} as CopilotSettings;

const SECRET = "SECRET";

function provider(
  providerId: string,
  providerType: Provider["providerType"],
  origin: Provider["origin"]
): Provider {
  return {
    providerId,
    providerType,
    displayName: providerId,
    baseUrl: `https://user:${SECRET}-url-password@${providerId}.example/v1?key=${SECRET}-url-query`,
    apiKeyKeychainId: `${SECRET}-keychain-${providerId}`,
    extras: { headers: { Authorization: `Bearer ${SECRET}-header` }, organization: SECRET },
    origin,
    addedAt: 1,
  };
}

const PROVIDERS: Provider[] = [
  provider("anthropic", "anthropic", { kind: "byok", catalogProviderId: "anthropic" }),
  provider("google", "google", { kind: "byok", catalogProviderId: "google" }),
  provider("openrouter", "openai-compatible", { kind: "byok", catalogProviderId: "openrouter" }),
  provider("my-endpoint", "openai-compatible", { kind: "byok" }),
  provider("claude", "anthropic", { kind: "agent", agentType: "claude" }),
  provider("codex", "openai-compatible", { kind: "agent", agentType: "codex" }),
  provider("opencode", "openai-compatible", { kind: "agent", agentType: "opencode" }),
  provider("copilot-plus", "openai-compatible", { kind: "copilot-plus" }),
];

function configuredModel(providerId: string, modelId: string): ConfiguredModel {
  return {
    configuredModelId: `${providerId}:${modelId}`,
    providerId,
    info: { id: modelId, displayName: `${modelId} name`, description: `${modelId} description` },
    configuredAt: 1,
  };
}

const CONFIGURED_MODELS = PROVIDERS.map((row) => configuredModel(row.providerId, "model-a"));

function secretSettings(providers: Provider[]): CopilotSettings {
  const byId = Object.fromEntries(providers.map((row) => [row.providerId, row]));
  const enabled = (agent: string) =>
    CONFIGURED_MODELS.filter((model) => byId[model.providerId]?.origin.kind !== "agent")
      .map((model) => model.configuredModelId)
      .concat(`${agent}:model-a`);
  const env = { ANTHROPIC_API_KEY: `${SECRET}-env`, OPENAI_BASE_URL: `https://${SECRET}.env` };
  return {
    ...SETTINGS,
    plusLicenseKey: `${SECRET}-license`,
    entitlementToken: `${SECRET}-entitlement`,
    openAIApiKey: `${SECRET}-openai`,
    openAIOrgId: `${SECRET}-org`,
    anthropicApiKey: `${SECRET}-anthropic`,
    googleApiKey: `${SECRET}-google`,
    openRouterAiApiKey: `${SECRET}-openrouter`,
    groqApiKey: `${SECRET}-groq`,
    openAIProxyBaseUrl: `https://${SECRET}.proxy`,
    miyoServerUrl: `https://${SECRET}.miyo`,
    firecrawlApiKey: `${SECRET}-firecrawl`,
    activeModels: [
      {
        name: "legacy",
        provider: "openai",
        enabled: true,
        apiKey: `${SECRET}-legacy-key`,
        baseUrl: `https://${SECRET}.legacy`,
        openAIOrgId: `${SECRET}-legacy-org`,
      },
    ],
    agentMode: {
      ...SETTINGS.agentMode,
      byok: { anthropic: `${SECRET}-byok`, openai: `${SECRET}-byok`, google: `${SECRET}-byok` },
      claudeCli: { path: `/${SECRET}/claude` },
      backends: {
        claude: { envOverrides: env },
        codex: { envOverrides: env, binaryPath: `/${SECRET}/codex` },
        opencode: { envOverrides: env, binaryPath: `/${SECRET}/opencode` },
      },
      deviceProfiles: { device: { claude: { envOverrides: env }, claudeCliPath: `/${SECRET}` } },
    },
    providers: byId,
    configuredModels: CONFIGURED_MODELS,
    backends: {
      opencode: { enabledModels: enabled("opencode") },
      claude: { enabledModels: enabled("claude") },
      codex: { enabledModels: enabled("codex") },
    },
  };
}

function withInstallState(base: BackendDescriptor, installState: InstallState): BackendDescriptor {
  return { ...base, getInstallState: () => installState };
}

describe("pickerCatalog", () => {
  describe("buildPickerCatalog()", () => {
    it("lists each agent in the given order under the default agent, with its install kind, preload status and saved selection", () => {
      const { models } = fakeModels({
        preloadById: { claude: "pending" },
        selectionById: { claude: { baseModelId: "opus", effort: "high" } },
      });

      const catalog = buildPickerCatalog(
        [
          descriptor({ id: "opencode", displayName: "OpenCode" }),
          descriptor({
            id: "claude",
            displayName: "Claude",
            getInstallState: () => ({
              kind: "incompatible",
              source: "custom",
              currentVersion: "1.0.0",
              minVersion: "2.0.0",
              message: "Update /usr/local/bin/claude",
            }),
          }),
        ],
        models,
        SETTINGS
      );

      expect(catalog.defaultAgent).toBe("claude");
      expect(
        catalog.agents.map(({ id, displayName, installKind, preload, defaultSelection }) => ({
          id,
          displayName,
          installKind,
          preload,
          defaultSelection,
        }))
      ).toEqual([
        {
          id: "opencode",
          displayName: "OpenCode",
          installKind: "ready",
          preload: "absent",
          defaultSelection: null,
        },
        {
          id: "claude",
          displayName: "Claude",
          installKind: "incompatible",
          preload: "pending",
          defaultSelection: { baseModelId: "opus", effort: "high" },
        },
      ]);
      expect(JSON.stringify(catalog)).not.toContain("/usr/local/bin/claude");
    });

    it("carries the enabled models, the models the agent reports without their provider, the agent's effort levels and the models its own config blocks", () => {
      const reported: ModelEntry = {
        baseModelId: "openrouter/a",
        name: "A",
        description: "Reported A",
        provider: "openrouter",
        effortOptions: [{ value: "high", label: "High" }],
      };
      const { models } = fakeModels({
        catalogById: { opencode: [reported] },
        effortById: { opencode: { "openrouter/b": [{ value: "low", label: "Low" }] } },
      });
      const blocked = {
        baseModelIds: new Set(["openrouter/b"]),
        reason: "Blocked",
        hint: "Check config",
      };

      const [agent] = buildPickerCatalog(
        [
          descriptor({
            getEnabledModelEntries: () => [
              { baseModelId: "openrouter/a", name: "A", credentialState: "ok", isFree: true },
              { baseModelId: "openrouter/b", name: "B", credentialState: "missing_key" },
            ],
            getBlockedModels: () => blocked,
          }),
        ],
        models,
        SETTINGS
      ).agents;

      expect(agent.enabledModels).toEqual([
        { baseModelId: "openrouter/a", name: "A", credentialState: "ok", isFree: true },
        { baseModelId: "openrouter/b", name: "B", credentialState: "missing_key" },
      ]);
      expect(agent.modelCatalog).toEqual({
        availableModels: [
          {
            baseModelId: "openrouter/a",
            name: "A",
            description: "Reported A",
            effortOptions: [{ value: "high", label: "High" }],
          },
        ],
      });
      expect(agent.effortCatalog).toEqual({ "openrouter/b": [{ value: "low", label: "Low" }] });
      expect(agent.blockedModels).toEqual({
        baseModelIds: ["openrouter/b"],
        reason: "Blocked",
        hint: "Check config",
      });
    });

    it("tells an agent with no model catalog yet apart from one whose catalog lists no models", () => {
      const { models } = fakeModels({ catalogById: { claude: null } });

      const [none, empty] = buildPickerCatalog(
        [descriptor({ id: "opencode" }), descriptor({ id: "claude" })],
        models,
        SETTINGS
      ).agents;

      expect(none.modelCatalog).toBeNull();
      expect(empty.modelCatalog).toEqual({ availableModels: null });
    });

    it("previews the locked Copilot Plus model only on an agent that routes Copilot models while no Copilot Plus provider is set up", () => {
      const { models } = fakeModels();
      const descriptors = [
        descriptor({ id: "opencode", routesCopilotModels: true }),
        descriptor({ id: "claude", routesCopilotModels: false }),
      ];
      const licensed = {
        ...SETTINGS,
        providers: {
          plus: provider("plus", "openai-compatible", { kind: "copilot-plus" }),
        },
      } as CopilotSettings;

      const unlicensedAgents = buildPickerCatalog(descriptors, models, SETTINGS).agents;
      const licensedAgents = buildPickerCatalog(descriptors, models, licensed).agents;

      expect(unlicensedAgents.map((agent) => agent.lockedPreview)).toEqual([
        [
          {
            name: "copilot-plus-flash",
            provider: "copilot-plus",
            displayName: "Copilot Plus Flash",
            subtitle: "Fast",
            disabledReason: "Copilot license required",
          },
        ],
        [],
      ]);
      expect(licensedAgents.map((agent) => agent.lockedPreview)).toEqual([[], []]);
    });

    it("warns on an agent that is not self-hostable only while Self-Host Mode is on", () => {
      const { models } = fakeModels();
      const descriptors = [
        descriptor({ id: "opencode", selfHostable: true }),
        descriptor({ id: "claude", selfHostable: false }),
      ];

      const off = buildPickerCatalog(descriptors, models, SETTINGS).agents;
      const on = buildPickerCatalog(descriptors, models, {
        ...SETTINGS,
        enableSelfHostMode: true,
      }).agents;

      expect(off.map((agent) => agent.selfHostWarning)).toEqual([false, false]);
      expect(on.map((agent) => agent.selfHostWarning)).toEqual([false, true]);
    });

    it.each([
      ["with a Copilot Plus provider", PROVIDERS],
      [
        "without a Copilot Plus provider, so the locked preview is built",
        PROVIDERS.filter((row) => row.origin.kind !== "copilot-plus"),
      ],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/612 carries no API key, token, keychain id, header, environment value, binary path or provider URL from settings for every provider shape, %s",
      (_label, providers) => {
        const settings = secretSettings(providers);
        const { models } = fakeModels({
          catalogById: { opencode: [], claude: [], codex: [] },
          preloadById: { opencode: "ready", claude: "ready", codex: "ready" },
        });
        const descriptors = [
          withInstallState(OpencodeBackendDescriptor, { kind: "ready", source: "managed" }),
          withInstallState(ClaudeBackendDescriptor, { kind: "error", message: `${SECRET}-error` }),
          withInstallState(CodexBackendDescriptor, {
            kind: "incompatible",
            source: "custom",
            currentVersion: `${SECRET}-version`,
            minVersion: "1",
            message: `${SECRET}-message`,
          }),
        ];

        const catalog = buildPickerCatalog(descriptors, models, settings);

        expect(catalog.agents.map((agent) => agent.enabledModels?.[0]?.name)).toEqual([
          "model-a name",
          "model-a name",
          "model-a name",
        ]);
        expect(JSON.stringify(catalog)).not.toContain(SECRET);
      }
    );
  });

  describe("pickerCatalogSource()", () => {
    beforeEach(() => setSettings(SETTINGS));

    it("reads the catalog from the current settings, and keeps the same catalog object until something in it changes", () => {
      const source = pickerCatalogSource(
        [descriptor({ id: "claude", selfHostable: false })],
        fakeModels().models
      );

      const first = source.read();
      const again = source.read();
      setSettings({ enableSelfHostMode: true, selfHostSearchProvider: "exa" });
      const changed = source.read();

      expect(again).toBe(first);
      expect(changed).not.toBe(first);
      expect(changed.agents[0].selfHostWarning).toBe(getSettings().enableSelfHostMode);
    });

    it("tells its listener about a settings change, a chat manager change, a model cache change and each agent's install state change, until unsubscribed", () => {
      const installListeners = [new Set<() => void>(), new Set<() => void>()];
      const subscribeInstallState = (listeners: Set<() => void>) => (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      const { models, managerListeners, cacheListeners } = fakeModels();
      const source = pickerCatalogSource(
        [
          descriptor({
            id: "opencode",
            subscribeInstallState: subscribeInstallState(installListeners[0]),
          }),
          descriptor({
            id: "claude",
            subscribeInstallState: subscribeInstallState(installListeners[1]),
          }),
        ],
        models
      );
      const onChange = jest.fn();

      const unsubscribe = source.subscribe(onChange);
      setSettings({ enableSelfHostMode: true });
      for (const listener of [managerListeners, cacheListeners, ...installListeners].flatMap(
        (set) => [...set]
      )) {
        listener();
      }
      const calls = onChange.mock.calls.length;
      unsubscribe();
      setSettings({ enableSelfHostMode: false });

      expect(calls).toBe(5);
      expect(onChange).toHaveBeenCalledTimes(5);
      expect(
        [managerListeners, cacheListeners, ...installListeners].map((set) => set.size)
      ).toEqual([0, 0, 0, 0]);
    });
  });
});
