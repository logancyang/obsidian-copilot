/**
 * Unit tests for the GitHub Copilot removal migration.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/316
 *
 * `planGitHubCopilotRemoval` is pure, so most coverage builds an in-the-wild
 * settings object and asserts the resulting patch. `executeGitHubCopilotRemoval`
 * is exercised against a mocked settings store and keychain so the side effects
 * are observable in isolation.
 */

import type { CustomModel, ProjectConfig } from "@/aiParams";
import { ChatModelProviders, DEFAULT_SETTINGS } from "@/constants";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, setSettings } from "@/settings/model";

import {
  executeGitHubCopilotRemoval,
  planGitHubCopilotRemoval,
} from "./githubCopilotRemovalMigration";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => {
  const actual = jest.requireActual<typeof import("@/settings/model")>("@/settings/model");
  return { ...actual, setSettings: jest.fn() };
});

jest.mock("@/services/keychainService", () => ({
  KeychainService: { getInstance: jest.fn() },
}));

const mockSetSettings = setSettings as jest.MockedFunction<typeof setSettings>;
const mockGetInstance = KeychainService.getInstance as jest.MockedFunction<
  typeof KeychainService.getInstance
>;

function keychain(overrides: Partial<KeychainService> = {}) {
  const instance = {
    isAvailable: jest.fn(() => true),
    deleteSecret: jest.fn(),
    ...overrides,
  } as unknown as KeychainService;
  mockGetInstance.mockReturnValue(instance);
  return instance as unknown as {
    isAvailable: jest.Mock;
    deleteSecret: jest.Mock;
  };
}

function model(overrides: Partial<CustomModel>): CustomModel {
  return {
    name: "test-model",
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: false,
    ...overrides,
  };
}

function project(overrides: Partial<ProjectConfig>): ProjectConfig {
  return {
    id: "p1",
    name: "Project",
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
    ...overrides,
  };
}

function settingsWith(overrides: Partial<CopilotSettings> = {}): CopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("githubCopilotRemovalMigration", () => {
  describe("planGitHubCopilotRemoval()", () => {
    it("returns null for a vault that never configured GitHub Copilot", () => {
      expect(
        planGitHubCopilotRemoval(
          settingsWith({
            activeModels: [model({ name: "gpt-4o" })],
            defaultModelKey: "gpt-4o|openai",
            projectList: [project({ projectModelKey: "gpt-4o|openai" })],
          })
        )
      ).toBeNull();
    });

    it("drops every GitHub Copilot model and keeps the rest in order", () => {
      const patch = planGitHubCopilotRemoval(
        settingsWith({
          activeModels: [
            model({ name: "gpt-4o", provider: "github-copilot" }),
            model({ name: "claude-sonnet-4-5", provider: ChatModelProviders.ANTHROPIC }),
            model({ name: "gpt-5-codex", provider: "github-copilot", enabled: false }),
            model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI }),
          ],
        })
      );

      expect(patch?.activeModels).toEqual([
        model({ name: "claude-sonnet-4-5", provider: ChatModelProviders.ANTHROPIC }),
        model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI }),
      ]);
      expect(patch).not.toHaveProperty("defaultModelKey");
    });

    it("clears a default model key that pointed at a GitHub Copilot model", () => {
      expect(
        planGitHubCopilotRemoval(settingsWith({ defaultModelKey: "gpt-4o|github-copilot" }))
      ).toEqual({ defaultModelKey: "" });
    });

    it("clears a backend-prefixed default model key that pointed at a GitHub Copilot model", () => {
      expect(
        planGitHubCopilotRemoval(
          settingsWith({ defaultModelKey: "opencode:gpt-4o|github-copilot" })
        )
      ).toEqual({ defaultModelKey: "" });
    });

    it("clears the default model key even when no matching model row survived on disk", () => {
      const patch = planGitHubCopilotRemoval(
        settingsWith({
          activeModels: [model({ name: "gpt-4o", provider: ChatModelProviders.OPENAI })],
          defaultModelKey: "gpt-4o|github-copilot",
        })
      );

      expect(patch).toEqual({ defaultModelKey: "" });
    });

    it("clears the quick command selection to undefined so quick ask inherits the chat default again (https://github.com/logancyang/obsidian-copilot-preview/issues/316)", () => {
      const patch = planGitHubCopilotRemoval(
        settingsWith({ quickCommandModelKey: "gpt-4o|github-copilot" })
      );

      expect(patch).toEqual({ quickCommandModelKey: undefined });
      expect(patch).toHaveProperty("quickCommandModelKey");
    });

    it("leaves a quick command selection that points at a surviving model alone", () => {
      expect(
        planGitHubCopilotRemoval(settingsWith({ quickCommandModelKey: "gpt-4o|openai" }))
      ).toBeNull();
    });

    it("clears only the project selections that pointed at a GitHub Copilot model", () => {
      const patch = planGitHubCopilotRemoval(
        settingsWith({
          projectList: [
            project({ id: "p1", projectModelKey: "gpt-4o|github-copilot" }),
            project({ id: "p2", projectModelKey: "gpt-4o|openai" }),
            project({ id: "p3", projectModelKey: "" }),
          ],
        })
      );

      expect(patch?.projectList).toEqual([
        project({ id: "p1", projectModelKey: "" }),
        project({ id: "p2", projectModelKey: "gpt-4o|openai" }),
        project({ id: "p3", projectModelKey: "" }),
      ]);
    });

    it("tolerates settings that predate the model and project lists", () => {
      const bare = settingsWith();
      delete (bare as Partial<CopilotSettings>).activeModels;
      delete (bare as Partial<CopilotSettings>).projectList;

      expect(planGitHubCopilotRemoval(bare)).toBeNull();
    });

    it("does not treat a provider whose name merely contains the removed one as removed (https://github.com/logancyang/obsidian-copilot-preview/issues/316)", () => {
      expect(
        planGitHubCopilotRemoval(
          settingsWith({
            activeModels: [model({ name: "gpt-4o", provider: "my-github-copilot-proxy" })],
            defaultModelKey: "gpt-4o|my-github-copilot-proxy",
          })
        )
      ).toBeNull();
    });
  });

  describe("executeGitHubCopilotRemoval()", () => {
    it("applies the plan and deletes both OAuth keychain entries", () => {
      const secrets = keychain();

      executeGitHubCopilotRemoval(
        settingsWith({
          activeModels: [model({ name: "gpt-4o", provider: "github-copilot" })],
          defaultModelKey: "gpt-4o|github-copilot",
        })
      );

      expect(mockSetSettings).toHaveBeenCalledWith({ activeModels: [], defaultModelKey: "" });
      expect(secrets.deleteSecret.mock.calls).toEqual([
        ["githubCopilotAccessToken"],
        ["githubCopilotToken"],
      ]);
    });

    it("still deletes the keychain entries when no models or selections changed", () => {
      const secrets = keychain();

      executeGitHubCopilotRemoval(settingsWith());

      expect(mockSetSettings).not.toHaveBeenCalled();
      expect(secrets.deleteSecret).toHaveBeenCalledTimes(2);
    });

    it("skips keychain deletion when the keychain is unavailable on this build", () => {
      const secrets = keychain({ isAvailable: jest.fn(() => false) as never });

      executeGitHubCopilotRemoval(settingsWith());

      expect(secrets.deleteSecret).not.toHaveBeenCalled();
    });

    it("does not fail the migration when the keychain is locked (https://github.com/logancyang/obsidian-copilot-preview/issues/316)", () => {
      keychain({
        deleteSecret: jest.fn(() => {
          throw new Error("keychain locked");
        }) as never,
      });

      expect(() => executeGitHubCopilotRemoval(settingsWith())).not.toThrow();
    });

    it("does not fail the migration when the keychain service is not initialized (https://github.com/logancyang/obsidian-copilot-preview/issues/316)", () => {
      mockGetInstance.mockImplementation(() => {
        throw new Error("KeychainService must be initialized with app on first call");
      });

      expect(() =>
        executeGitHubCopilotRemoval(
          settingsWith({ activeModels: [model({ provider: "github-copilot" })] })
        )
      ).not.toThrow();
      expect(mockSetSettings).toHaveBeenCalledWith({ activeModels: [] });
    });
  });
});
