/**
 * Version-gate tests for `runSettingsMigrations`. `@/settings/model` is mocked
 * (getSettings / setSettings) and a fake `ModelManagementApi` stands in, so the
 * gate logic is exercised in isolation from the real store and registries.
 */

import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, DEFAULT_COPILOT_FOLDER, DEFAULT_SETTINGS } from "@/constants";
import type { ModelManagementApi, ProviderType } from "@/modelManagement";
import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";
import { Platform } from "obsidian";

import { CURRENT_SETTINGS_VERSION, runSettingsMigrations } from "./index";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// The v6 seed pulls in miyoUtils, which now imports the status store (owned by a
// parallel PR-2 workstream; contract stub in this worktree). The seed itself
// never calls it, so an empty mock is enough to keep this suite isolated.
jest.mock("@/miyo/miyoStatusStore", () => ({ isMiyoAvailableForCapability: jest.fn() }));

jest.mock("@/services/keychainService", () => ({
  KeychainService: { getInstance: jest.fn(() => ({ isAvailable: () => false })) },
}));

jest.mock("@/settings/model", () => {
  const actual = jest.requireActual<typeof import("@/settings/model")>("@/settings/model");
  return { ...actual, getSettings: jest.fn(), setSettings: jest.fn() };
});

const mockGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;
const mockSetSettings = setSettings as jest.MockedFunction<typeof setSettings>;

function settings(
  overrides: Partial<CopilotSettings>,
  models: CustomModel[] = []
): CopilotSettings {
  return { ...DEFAULT_SETTINGS, activeModels: models, ...overrides };
}

function makeApi() {
  const setupProvider = jest.fn(async () => ({ providerId: "p1", configuredModelIds: ["cm1"] }));
  const removeProvider = jest.fn(async () => undefined);
  const api = {
    providerRegistry: { listByOrigin: jest.fn(() => []) },
    setup: { byok: { setupProvider } },
    coordinator: { removeProvider },
  } as unknown as ModelManagementApi;
  return { api, setupProvider, removeProvider };
}

const keyedAnthropic = () =>
  settings({ settingsVersion: undefined, anthropicApiKey: "sk-ant" }, [
    {
      name: "claude-sonnet-4-5",
      provider: ChatModelProviders.ANTHROPIC,
      enabled: true,
      isBuiltIn: false,
    },
  ]);

beforeEach(() => {
  jest.clearAllMocks();
});

it("runs when settingsVersion is undefined (pre-versioned install)", async () => {
  mockGetSettings.mockReturnValue(keyedAnthropic());
  const { api, setupProvider } = makeApi();

  await runSettingsMigrations(api);

  expect(setupProvider).toHaveBeenCalledTimes(1);
  expect(mockSetSettings).toHaveBeenCalledWith({ settingsVersion: CURRENT_SETTINGS_VERSION });
});

it("runs when settingsVersion is the orphaned prototype value 2", async () => {
  mockGetSettings.mockReturnValue({ ...keyedAnthropic(), settingsVersion: 2 });
  const { api, setupProvider } = makeApi();

  await runSettingsMigrations(api);

  expect(setupProvider).toHaveBeenCalledTimes(1);
  expect(mockSetSettings).toHaveBeenCalledWith({ settingsVersion: CURRENT_SETTINGS_VERSION });
});

it("bumps the version even when there is nothing to migrate", async () => {
  mockGetSettings.mockReturnValue(settings({ settingsVersion: undefined }, []));
  const { api, setupProvider } = makeApi();

  await runSettingsMigrations(api);

  expect(setupProvider).not.toHaveBeenCalled();
  expect(mockSetSettings).toHaveBeenCalledWith({ settingsVersion: CURRENT_SETTINGS_VERSION });
});

it("runs only the v5 backfill for a v4 vault (legacy BYOK migration does not re-run)", async () => {
  mockGetSettings.mockReturnValue(
    settings({
      settingsVersion: 4,
      providers: {
        p1: {
          providerId: "p1",
          providerType: "openai-compatible",
          displayName: "OpenRouter",
          origin: { kind: "byok", catalogProviderId: "openrouter" },
          addedAt: 0,
          apiKeyKeychainId: null,
        },
      },
    })
  );
  const { api, setupProvider } = makeApi();

  await runSettingsMigrations(api);

  expect(setupProvider).not.toHaveBeenCalled();
  // Backfill writes the flag, then the version bump lands.
  const providerWrite = mockSetSettings.mock.calls.find((call) => "providers" in call[0])?.[0] as
    | { providers: Record<string, { requiresApiKey?: boolean }> }
    | undefined;
  expect(providerWrite?.providers.p1.requiresApiKey).toBe(true);
  expect(mockSetSettings).toHaveBeenCalledWith({ settingsVersion: CURRENT_SETTINGS_VERSION });
});

it("skips when already at the current version", async () => {
  mockGetSettings.mockReturnValue(settings({ settingsVersion: CURRENT_SETTINGS_VERSION }));
  const { api, setupProvider } = makeApi();

  await runSettingsMigrations(api);

  expect(setupProvider).not.toHaveBeenCalled();
  expect(mockSetSettings).not.toHaveBeenCalled();
});

it("skips a future version", async () => {
  mockGetSettings.mockReturnValue(settings({ settingsVersion: CURRENT_SETTINGS_VERSION + 1 }));
  const { api, setupProvider } = makeApi();

  await runSettingsMigrations(api);

  expect(setupProvider).not.toHaveBeenCalled();
  expect(mockSetSettings).not.toHaveBeenCalled();
});

it("v10: makes auth optional for an existing custom OpenAI-compatible provider (https://github.com/logancyang/obsidian-copilot/issues/2895)", async () => {
  mockGetSettings.mockReturnValue(
    settings({
      settingsVersion: 9,
      providers: {
        custom: {
          providerId: "custom",
          providerType: "openai-compatible",
          displayName: "Custom OpenAI-compatible",
          origin: { kind: "byok" },
          requiresApiKey: true,
          apiKeyKeychainId: "keychain-custom",
          addedAt: 0,
        },
      },
    })
  );
  const { api } = makeApi();

  await runSettingsMigrations(api);

  const providerWrite = mockSetSettings.mock.calls.find((call) => "providers" in call[0])?.[0] as
    | { providers: Record<string, { requiresApiKey?: boolean; apiKeyKeychainId?: string | null }> }
    | undefined;
  expect(providerWrite?.providers.custom).toEqual(
    expect.objectContaining({ requiresApiKey: false, apiKeyKeychainId: "keychain-custom" })
  );
  expect(mockSetSettings).toHaveBeenCalledWith({ settingsVersion: CURRENT_SETTINGS_VERSION });
});

it("v6: seeds plus for a v5 vault with neither Miyo nor self-host", async () => {
  mockGetSettings.mockReturnValue(settings({ settingsVersion: 5 }));
  const { api, setupProvider } = makeApi();

  await runSettingsMigrations(api);

  // Only the v6 seed runs for a v5 vault (no BYOK/backfill).
  expect(setupProvider).not.toHaveBeenCalled();
  expect(mockSetSettings).toHaveBeenCalledWith({
    docProcessorBackend: "plus",
  });
});

it("v6: seeds miyo when Miyo and self-host mode are both on", async () => {
  // Self-host mode being on (with Miyo enabled) is what makes the doc processor
  // seed to miyo.
  mockGetSettings.mockReturnValue(
    settings({ settingsVersion: 5, enableMiyo: true, enableSelfHostMode: true })
  );
  const { api } = makeApi();

  await runSettingsMigrations(api);

  expect(mockSetSettings).toHaveBeenCalledWith({
    docProcessorBackend: "miyo",
  });
});

it("v6: seeds plus when semantic search is on but Miyo is off", async () => {
  // enableSemanticSearchV3 must not influence the seed — the doc processor keys
  // off Miyo/self-host state, not the legacy semantic flag.
  mockGetSettings.mockReturnValue(
    settings({ settingsVersion: 5, enableSemanticSearchV3: true, enableMiyo: false })
  );
  const { api } = makeApi();

  await runSettingsMigrations(api);

  expect(mockSetSettings).toHaveBeenCalledWith({
    docProcessorBackend: "plus",
  });
});

it("v6: seeds plus for a mobile vault with Miyo enabled but self-host off", async () => {
  // enableSelfHostMode is off here, so the doc processor seeds to plus regardless
  // of the mobile Miyo state.
  (Platform as { isMobile: boolean }).isMobile = true;
  try {
    mockGetSettings.mockReturnValue(
      settings({
        settingsVersion: 5,
        enableMiyo: true,
        enableSelfHostMode: false,
        miyoServerUrl: "",
      })
    );
    const { api } = makeApi();

    await runSettingsMigrations(api);

    expect(mockSetSettings).toHaveBeenCalledWith({
      docProcessorBackend: "plus",
    });
  } finally {
    (Platform as { isMobile: boolean }).isMobile = false;
  }
});

it("v7: seeds enableMiyoSearchSkill=true for an existing Miyo user", async () => {
  // Existing Miyo user (persisted enableMiyo) must keep the search skill when the
  // implicit auto-seed becomes an explicit toggle — no silent un-install.
  mockGetSettings.mockReturnValue(settings({ settingsVersion: 6, enableMiyo: true }));
  const { api } = makeApi();

  await runSettingsMigrations(api);

  expect(mockSetSettings).toHaveBeenCalledWith({ enableMiyoSearchSkill: true });
  expect(mockSetSettings).toHaveBeenCalledWith({ settingsVersion: CURRENT_SETTINGS_VERSION });
});

it("v7: leaves the skill flag untouched when Miyo was never enabled", async () => {
  mockGetSettings.mockReturnValue(settings({ settingsVersion: 6, enableMiyo: false }));
  const { api } = makeApi();

  await runSettingsMigrations(api);

  const flagWrite = mockSetSettings.mock.calls.find((call) => "enableMiyoSearchSkill" in call[0]);
  expect(flagWrite).toBeUndefined();
  expect(mockSetSettings).toHaveBeenCalledWith({ settingsVersion: CURRENT_SETTINGS_VERSION });
});

it("v7: keys off persisted enableMiyo, not the mobile-sensitive search backend", async () => {
  // A mobile-first upgrade: getSearchBackend() would fold in Platform.isMobile
  // and could resolve to non-miyo, but the migration must read the raw persisted
  // intent so it can't write false and Sync it to desktop.
  (Platform as { isMobile: boolean }).isMobile = true;
  try {
    mockGetSettings.mockReturnValue(settings({ settingsVersion: 6, enableMiyo: true }));
    const { api } = makeApi();

    await runSettingsMigrations(api);

    expect(mockSetSettings).toHaveBeenCalledWith({ enableMiyoSearchSkill: true });
  } finally {
    (Platform as { isMobile: boolean }).isMobile = false;
  }
});

describe("runSettingsMigrations()", () => {
  it("v8: seeds copilotFolder for a v7 vault", async () => {
    // A v7 vault predates the configurable root and must be stamped with the
    // historical default so the derived sub-folder accessors have a base.
    mockGetSettings.mockReturnValue(settings({ settingsVersion: 7 }));
    const { api } = makeApi();

    await runSettingsMigrations(api);

    expect(mockSetSettings).toHaveBeenCalledWith({ copilotFolder: DEFAULT_COPILOT_FOLDER });
    expect(mockSetSettings).toHaveBeenCalledWith({ settingsVersion: CURRENT_SETTINGS_VERSION });
  });

  it("v8: seeds copilotFolder for a pre-versioned install", async () => {
    mockGetSettings.mockReturnValue(settings({ settingsVersion: undefined }));
    const { api } = makeApi();

    await runSettingsMigrations(api);

    expect(mockSetSettings).toHaveBeenCalledWith({ copilotFolder: DEFAULT_COPILOT_FOLDER });
  });

  it("v8: does not re-seed copilotFolder for a vault already at the current version", async () => {
    mockGetSettings.mockReturnValue(settings({ settingsVersion: CURRENT_SETTINGS_VERSION }));
    const { api } = makeApi();

    await runSettingsMigrations(api);

    const copilotFolderWrite = mockSetSettings.mock.calls.find(
      (call) => "copilotFolder" in call[0]
    );
    expect(copilotFolderWrite).toBeUndefined();
  });

  it("v8: seeds copilotRootHistory with the legacy and current roots", async () => {
    mockGetSettings.mockReturnValue(settings({ settingsVersion: 7 }));
    const { api } = makeApi();

    await runSettingsMigrations(api);

    const historyWrite = mockSetSettings.mock.calls.find(
      (call) => typeof call[0] === "object" && "copilotRootHistory" in call[0]
    );
    const seededHistory = (historyWrite?.[0] as Partial<CopilotSettings> | undefined)
      ?.copilotRootHistory;
    expect(seededHistory).toEqual([DEFAULT_COPILOT_FOLDER]);
  });

  it("v8: flags a legacy vault (v7) as upgraded so WS-D can prompt", async () => {
    mockGetSettings.mockReturnValue(settings({ settingsVersion: 7 }));
    const { api } = makeApi();

    await runSettingsMigrations(api);

    expect(mockSetSettings).toHaveBeenCalledWith({ upgradedToV8FromLegacy: true });
  });

  it("v8: flags a pre-versioned install (version 0) as upgraded so WS-D can prompt", async () => {
    // A pre-versioned install (settingsVersion absent → `fromVersion === 0`) is a
    // real user whose data.json predates the version field, not a fresh install:
    // fresh installs are stamped to the current version at bootstrap and never
    // reach this migration. So a `0` here IS a legacy vault and must be flagged.
    mockGetSettings.mockReturnValue(settings({ settingsVersion: undefined }));
    const { api } = makeApi();

    await runSettingsMigrations(api);

    expect(mockSetSettings).toHaveBeenCalledWith({ upgradedToV8FromLegacy: true });
  });

  it("v9: drops GitHub Copilot models and selections for a v8 vault", async () => {
    mockGetSettings.mockReturnValue(
      settings({ settingsVersion: 8, defaultModelKey: "gpt-4o|github-copilot" }, [
        { name: "gpt-4o", provider: "github-copilot", enabled: true, isBuiltIn: false },
      ])
    );
    const { api } = makeApi();

    await runSettingsMigrations(api);

    expect(mockSetSettings).toHaveBeenCalledWith({ activeModels: [], defaultModelKey: "" });
  });

  it("v9: leaves models and selections alone for a vault already at the current version", async () => {
    mockGetSettings.mockReturnValue(
      settings({
        settingsVersion: CURRENT_SETTINGS_VERSION,
        defaultModelKey: "gpt-4o|github-copilot",
      })
    );
    const { api } = makeApi();

    await runSettingsMigrations(api);

    expect(mockSetSettings).not.toHaveBeenCalled();
  });

  it("v11: hands a saved Bedrock provider to the removal cascade for a v10 vault", async () => {
    mockGetSettings.mockReturnValue(
      settings({
        settingsVersion: 10,
        providers: {
          bed: {
            providerId: "bed",
            providerType: "bedrock" as ProviderType,
            displayName: "Amazon Bedrock",
            origin: { kind: "byok" },
            addedAt: 0,
          },
        },
      })
    );
    const { api, removeProvider } = makeApi();

    await runSettingsMigrations(api);

    expect(removeProvider).toHaveBeenCalledWith("bed");
  });

  it("v11: leaves a saved Bedrock provider alone for a vault already at the current version", async () => {
    mockGetSettings.mockReturnValue(
      settings({
        settingsVersion: CURRENT_SETTINGS_VERSION,
        providers: {
          bed: {
            providerId: "bed",
            providerType: "bedrock" as ProviderType,
            displayName: "Amazon Bedrock",
            origin: { kind: "byok" },
            addedAt: 0,
          },
        },
      })
    );
    const { api, removeProvider } = makeApi();

    await runSettingsMigrations(api);

    expect(removeProvider).not.toHaveBeenCalled();
  });

  it("v8: does not flag a vault already at the current version", async () => {
    mockGetSettings.mockReturnValue(settings({ settingsVersion: CURRENT_SETTINGS_VERSION }));
    const { api } = makeApi();

    await runSettingsMigrations(api);

    const flagWrite = mockSetSettings.mock.calls.find(
      (call) => "upgradedToV8FromLegacy" in call[0]
    );
    expect(flagWrite).toBeUndefined();
  });
});
