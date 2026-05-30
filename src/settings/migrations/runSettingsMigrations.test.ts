/**
 * Version-gate tests for `runSettingsMigrations`. `@/settings/model` is mocked
 * (getSettings / setSettings) and a fake `ModelManagementApi` stands in, so the
 * gate logic is exercised in isolation from the real store and registries.
 */

import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, DEFAULT_SETTINGS } from "@/constants";
import type { ModelManagementApi } from "@/modelManagement";
import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";

import { CURRENT_SETTINGS_VERSION, runSettingsMigrations } from "./index";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
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
  const api = {
    providerRegistry: { listByOrigin: jest.fn(() => []) },
    setup: { byok: { setupProvider } },
  } as unknown as ModelManagementApi;
  return { api, setupProvider };
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
