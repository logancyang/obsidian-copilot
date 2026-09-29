import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { createCatalogSource } from "@/agentMode/session/host/catalogSource";
import {
  buildHost,
  FakeManager,
  makeTestSession,
  settle,
} from "@/agentMode/session/host/hostTestHarness";
import type { BackendDescriptor } from "@/agentMode/session/types";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import { opencodeEnabledModelEntries } from "./opencodeModelResolve";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));

const SENTINELS = [
  "SENTINEL-APIKEY",
  "SENTINEL-KEYCHAIN",
  "SENTINEL-BASEURL",
  "SENTINEL-ORG",
  "SENTINEL-ENV",
  "SENTINEL-PATH",
  "SENTINEL-ERROR",
];

const FORBIDDEN_KEYS = [
  "apiKey",
  "apiKeyKeychainId",
  "baseUrl",
  "openAIOrgId",
  "envOverrides",
  "binaryPath",
];

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysOf(child, into);
    }
  }
  return into;
}

const provider = (providerId: string, overrides: Partial<Provider> = {}): Provider => ({
  providerId,
  providerType: "openai-compatible",
  displayName: providerId,
  origin: { kind: "byok", catalogProviderId: "openrouter" },
  baseUrl: "https://SENTINEL-BASEURL.example/v1",
  requiresApiKey: true,
  apiKeyKeychainId: "SENTINEL-KEYCHAIN",
  addedAt: 0,
  ...overrides,
});

const configured = (
  configuredModelId: string,
  providerId: string,
  id: string
): ConfiguredModel => ({
  configuredModelId,
  providerId,
  info: { id, displayName: id },
  configuredAt: 0,
});

function seededSettings(): CopilotSettings {
  return {
    backends: {
      opencode: { enabledModels: ["byok", "keyless"] },
      claude: { enabledModels: ["opus"] },
    },
    configuredModels: [
      configured("byok", "p-byok", "qwen/qwen3-max"),
      configured("keyless", "p-keyless", "llama"),
      configured("opus", "p-claude", "claude-opus"),
    ],
    providers: {
      "p-byok": provider("p-byok"),
      "p-keyless": provider("p-keyless", { apiKeyKeychainId: null }),
      "p-claude": provider("p-claude", { origin: { kind: "agent", agentType: "claude" } }),
    },
    activeModels: [
      {
        name: "gpt-4o",
        provider: "openai",
        enabled: true,
        apiKey: "SENTINEL-APIKEY",
        openAIOrgId: "SENTINEL-ORG",
        baseUrl: "https://SENTINEL-BASEURL.example",
      },
    ],
    enableSelfHostMode: false,
    agentMode: {
      activeBackend: "opencode",
      backends: {
        opencode: {
          binaryPath: "/Users/SENTINEL-PATH/bin/opencode",
          envOverrides: { OPENAI_API_KEY: "SENTINEL-ENV" },
        },
      },
    },
  } as unknown as CopilotSettings;
}

function descriptors(): BackendDescriptor[] {
  const install = () => ({ kind: "error" as const, message: "SENTINEL-PATH spawn SENTINEL-ERROR" });
  return [
    {
      id: "opencode",
      displayName: "opencode",
      selfHostable: true,
      routesCopilotModels: false,
      getEnabledModelEntries: (settings: CopilotSettings) => [
        ...opencodeEnabledModelEntries(settings),
      ],
      getInstallState: install,
    },
    {
      id: "claude",
      displayName: "Claude Code",
      selfHostable: false,
      routesCopilotModels: false,
      getEnabledModelEntries: (settings: CopilotSettings) => [
        ...agentOriginEnabledModelEntries(settings, "claude", (wireId) => ({
          selection: { baseModelId: wireId },
        })),
      ],
      getInstallState: install,
    },
  ] as unknown as BackendDescriptor[];
}

describe("pickerCatalog credentials", () => {
  it("keeps every credential, URL, path and error text out of both serialized host scopes https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
    const settings = seededSettings();
    const manager = new FakeManager();
    const { session } = makeTestSession("s1", "opencode");
    manager.add(session);
    const catalog = createCatalogSource({
      descriptors: () => descriptors(),
      getSettings: () => settings,
      subscribeSettings: () => () => {},
      subscribeInstallState: () => () => {},
      needsSelfHostWarning: () => false,
      manager: {
        getCachedModelCatalog: () => ({
          availableModels: [
            {
              baseModelId: "openrouter/qwen/qwen3-max",
              name: "Qwen",
              provider: "openrouter",
              effortOptions: [],
            },
          ],
        }),
        getEffortCatalog: () => null,
        getPreloadStatus: () => "ready",
        getDefaultSelection: () => null,
        getStartingBackendId: () => "opencode",
        getLastError: () =>
          "SENTINEL-ERROR spawn /Users/SENTINEL-PATH failed --key SENTINEL-APIKEY",
        subscribeModelCache: () => () => {},
      },
    });
    const host = buildHost(manager, { catalog });
    const { client, transport } = host.createClient({ serialize: true });
    const wire: string[] = [];
    transport.onFrame((frame) => wire.push(JSON.stringify(frame)));
    client.watchSession("s1");
    await settle();

    const hostScope = JSON.stringify(host.getHostState());
    const sessionScope = JSON.stringify(host.getSessionState("s1"));
    const everything = [hostScope, sessionScope, ...wire].join("\n");

    expect(host.getHostState().backends.map((b) => b.id)).toEqual(["opencode", "claude"]);
    expect(
      host.getHostState().backends[0].enabled?.map((m) => [m.baseModelId, m.missingKey])
    ).toEqual([
      ["openrouter/qwen/qwen3-max", false],
      ["openrouter/llama", true],
    ]);
    expect(host.getHostState().host).toEqual({
      defaultBackendId: "opencode",
      startingBackendId: "opencode",
      startFailed: true,
    });
    for (const sentinel of SENTINELS) expect(everything).not.toContain(sentinel);
    const keys = keysOf([host.getHostState(), host.getSessionState("s1")]);
    for (const key of FORBIDDEN_KEYS) expect(keys.has(key)).toBe(false);
  });
});
