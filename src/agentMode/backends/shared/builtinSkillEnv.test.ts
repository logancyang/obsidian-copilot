import {
  buildBuiltinSkillEnv,
  getBuiltinSkillEnvRestartPolicy,
  sanitizeBuiltinSkillEnvOverrides,
} from "./builtinSkillEnv";
import { getSettings } from "@/settings/model";
import { getMiyoCustomUrl } from "@/miyo/miyoUtils";
import { BREVILABS_API_BASE_URL } from "@/constants";
import {
  MIYO_SEARCH_FOLDER_ENV,
  MIYO_SEARCH_SCOPE_ENV,
  PLUS_ENV,
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
} from "@/agentMode/skills/builtin/builtinSkills";
import { SYMPOSIUM_WORKSPACE_ROOT_ENV } from "@/symposium/constants";
import {
  COPILOT_OBSIDIAN_CLI_ENV,
  resolveObsidianCliPath,
} from "@/agentMode/backends/shared/obsidianCliPath";

jest.mock("@/settings/model", () => ({ getSettings: jest.fn() }));
jest.mock("@/miyo/miyoUtils", () => ({ getMiyoCustomUrl: jest.fn() }));
jest.mock("@/logger", () => ({ logWarn: jest.fn() }));
jest.mock("@/agentMode/backends/shared/obsidianCliPath", () => ({
  COPILOT_OBSIDIAN_CLI_ENV: "COPILOT_OBSIDIAN_CLI",
  resolveObsidianCliPath: jest.fn(),
}));

const mockGetSettings = getSettings as jest.Mock;
const mockGetMiyoCustomUrl = getMiyoCustomUrl as jest.Mock;
const mockResolveObsidianCliPath = resolveObsidianCliPath as jest.Mock;

describe("builtinSkillEnv", () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetMiyoCustomUrl.mockReset();
    mockResolveObsidianCliPath.mockReset();
    // Default: no custom Miyo URL configured (local loopback).
    mockGetMiyoCustomUrl.mockReturnValue("");
    mockResolveObsidianCliPath.mockReturnValue(null);
  });

  describe("buildBuiltinSkillEnv()", () => {
    it("returns the service credentials and relay config for an active Plus user", async () => {
      mockGetSettings.mockReturnValue({
        isPaidUser: true,
        plusLicenseKey: "hydrated-key",
        userId: "user-123",
      });
      const env = await buildBuiltinSkillEnv("4.0.0");

      expect(env).toEqual({
        [PLUS_ENV.licenseKey]: "hydrated-key",
        [PLUS_ENV.baseUrl]: BREVILABS_API_BASE_URL,
        [PLUS_ENV.userId]: "user-123",
        [PLUS_ENV.clientVersion]: "4.0.0",
      });
      expect(env).not.toHaveProperty("SYMPOSIUM_TOKEN");
    });

    it("returns empty when the user is not a Plus subscriber", async () => {
      mockGetSettings.mockReturnValue({ isPaidUser: false, plusLicenseKey: "hydrated-key" });
      expect(await buildBuiltinSkillEnv()).toEqual({});
    });

    it("returns empty when there is no license key on file", async () => {
      mockGetSettings.mockReturnValue({ isPaidUser: true, plusLicenseKey: "" });
      expect(await buildBuiltinSkillEnv()).toEqual({});
    });

    it("injects MIYO_URL when a custom Miyo server URL is set, independent of Plus", async () => {
      mockGetSettings.mockReturnValue({ isPaidUser: false });
      mockGetMiyoCustomUrl.mockReturnValue("http://192.168.1.10:8742");
      expect(await buildBuiltinSkillEnv()).toEqual({ MIYO_URL: "http://192.168.1.10:8742" });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 defaults scope closed when the active vault identity is unavailable", async () => {
      mockGetSettings.mockReturnValue({ isPaidUser: false });

      expect(await buildBuiltinSkillEnv("", "/vault")).toEqual({
        [SYMPOSIUM_WORKSPACE_ROOT_ENV]: "/vault",
        [MIYO_SEARCH_SCOPE_ENV]: "current",
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 injects the active vault identity for Current vault search", async () => {
      mockGetSettings.mockReturnValue({ isPaidUser: false, miyoSearchAll: false });

      expect(await buildBuiltinSkillEnv("", "/vault/root", "root")).toEqual({
        [SYMPOSIUM_WORKSPACE_ROOT_ENV]: "/vault/root",
        [MIYO_SEARCH_SCOPE_ENV]: "current",
        [MIYO_SEARCH_FOLDER_ENV]: "root",
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 marks Unrestricted search without replacing the active vault identity", async () => {
      mockGetSettings.mockReturnValue({ isPaidUser: false, miyoSearchAll: true });

      expect(await buildBuiltinSkillEnv("", "/vault/root", "root")).toEqual({
        [SYMPOSIUM_WORKSPACE_ROOT_ENV]: "/vault/root",
        [MIYO_SEARCH_SCOPE_ENV]: "unrestricted",
        [MIYO_SEARCH_FOLDER_ENV]: "root",
      });
    });

    it("injects the host Obsidian CLI independently of Plus and Miyo", async () => {
      mockGetSettings.mockReturnValue({ isPaidUser: false });
      mockResolveObsidianCliPath.mockReturnValue("C:/Users/Me/App Data/Obsidian/Obsidian.com");

      expect(await buildBuiltinSkillEnv()).toEqual({
        [COPILOT_OBSIDIAN_CLI_ENV]: "C:/Users/Me/App Data/Obsidian/Obsidian.com",
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 injects protected Self-Host routing without provider credentials", async () => {
      mockGetSettings.mockReturnValue({
        isPaidUser: false,
        enableSelfHostMode: true,
        exaApiKey: "host-only-key",
      });

      expect(
        await buildBuiltinSkillEnv("", "/vault/root", "root", {
          url: "http://127.0.0.1:1234/search",
          token: "session-token",
        })
      ).toEqual({
        [SYMPOSIUM_WORKSPACE_ROOT_ENV]: "/vault/root",
        [MIYO_SEARCH_SCOPE_ENV]: "current",
        [MIYO_SEARCH_FOLDER_ENV]: "root",
        [SELF_HOST_WEB_SEARCH_ENV]: "1",
        [SELF_HOST_WEB_SEARCH_URL_ENV]: "http://127.0.0.1:1234/search",
        [SELF_HOST_WEB_SEARCH_TOKEN_ENV]: "session-token",
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 does not mark Self-Host routing active before its replacement channel exists", async () => {
      mockGetSettings.mockReturnValue({ isPaidUser: false, enableSelfHostMode: true });

      expect(await buildBuiltinSkillEnv()).toEqual({});
    });

    it("merges MIYO_URL with the Plus relay env for a Plus user with a custom Miyo URL", async () => {
      mockGetSettings.mockReturnValue({
        isPaidUser: true,
        plusLicenseKey: "hydrated-key",
        userId: "user-123",
      });
      mockGetMiyoCustomUrl.mockReturnValue("http://miyo.example:8742");

      expect(await buildBuiltinSkillEnv("4.0.0")).toEqual({
        MIYO_URL: "http://miyo.example:8742",
        [PLUS_ENV.licenseKey]: "hydrated-key",
        [PLUS_ENV.baseUrl]: BREVILABS_API_BASE_URL,
        [PLUS_ENV.userId]: "user-123",
        [PLUS_ENV.clientVersion]: "4.0.0",
      });
    });
  });

  describe("sanitizeBuiltinSkillEnvOverrides()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 prevents backend overrides from widening Current vault search", () => {
      expect(
        sanitizeBuiltinSkillEnvOverrides({
          MIYO_URL: "http://override.example",
          [MIYO_SEARCH_SCOPE_ENV]: "unrestricted",
          [MIYO_SEARCH_FOLDER_ENV]: "other-vault",
        })
      ).toEqual({
        MIYO_URL: "http://override.example",
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 preserves unrelated backend overrides", () => {
      expect(sanitizeBuiltinSkillEnvOverrides({ ANTHROPIC_MODEL: "claude" })).toEqual({
        ANTHROPIC_MODEL: "claude",
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 prevents backend overrides from bypassing Self-Host search routing", () => {
      expect(
        sanitizeBuiltinSkillEnvOverrides({
          [SELF_HOST_WEB_SEARCH_ENV]: "",
          [SELF_HOST_WEB_SEARCH_URL_ENV]: "http://attacker.invalid",
          [SELF_HOST_WEB_SEARCH_TOKEN_ENV]: "replacement-token",
          OPENAI_API_KEY: "allowed",
        })
      ).toEqual({ OPENAI_API_KEY: "allowed" });
    });
  });

  describe("getBuiltinSkillEnvRestartPolicy()", () => {
    it.each([
      ["isPaidUser", false, true],
      ["plusLicenseKey", "old", "new"],
      ["miyoServerUrl", "http://old", "http://new"],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/121 defers the spawn-time refresh when %s changes",
      (key, before, after) => {
        const prev = { [key]: before } as unknown as ReturnType<typeof getSettings>;
        const next = { [key]: after } as unknown as ReturnType<typeof getSettings>;

        expect(getBuiltinSkillEnvRestartPolicy(prev, next)).toBe("deferred");
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 immediately refreshes an enabled skill when scope tightens", () => {
      const prev = { enableMiyoSearchSkill: true, miyoSearchAll: true } as ReturnType<
        typeof getSettings
      >;
      const next = { enableMiyoSearchSkill: true, miyoSearchAll: false } as ReturnType<
        typeof getSettings
      >;

      expect(getBuiltinSkillEnvRestartPolicy(prev, next)).toBe("immediate");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 immediately blocks native web tools when Self-Host mode is enabled", () => {
      const prev = { enableSelfHostMode: false } as ReturnType<typeof getSettings>;
      const next = { enableSelfHostMode: true } as ReturnType<typeof getSettings>;

      expect(getBuiltinSkillEnvRestartPolicy(prev, next)).toBe("immediate");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/165 defers the routing refresh when Self-Host mode is disabled", () => {
      const prev = { enableSelfHostMode: true } as ReturnType<typeof getSettings>;
      const next = { enableSelfHostMode: false } as ReturnType<typeof getSettings>;

      expect(getBuiltinSkillEnvRestartPolicy(prev, next)).toBe("deferred");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 defers an enabled skill refresh when scope widens", () => {
      const prev = { enableMiyoSearchSkill: true, miyoSearchAll: false } as ReturnType<
        typeof getSettings
      >;
      const next = { enableMiyoSearchSkill: true, miyoSearchAll: true } as ReturnType<
        typeof getSettings
      >;

      expect(getBuiltinSkillEnvRestartPolicy(prev, next)).toBe("deferred");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 skips scope refreshes while the skill is disabled", () => {
      const prev = { enableMiyoSearchSkill: false, miyoSearchAll: true } as ReturnType<
        typeof getSettings
      >;
      const next = { enableMiyoSearchSkill: false, miyoSearchAll: false } as ReturnType<
        typeof getSettings
      >;

      expect(getBuiltinSkillEnvRestartPolicy(prev, next)).toBe("none");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 keeps spawn-time state for unrelated settings changes", () => {
      const prev = { miyoSearchAll: false, temperature: 0 } as ReturnType<typeof getSettings>;
      const next = { miyoSearchAll: false, temperature: 1 } as ReturnType<typeof getSettings>;

      expect(getBuiltinSkillEnvRestartPolicy(prev, next)).toBe("none");
    });
  });
});
