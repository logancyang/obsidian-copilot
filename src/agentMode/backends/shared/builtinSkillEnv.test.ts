import { buildBuiltinSkillEnv } from "./builtinSkillEnv";
import { getSettings } from "@/settings/model";
import { getMiyoCustomUrl } from "@/miyo/miyoUtils";
import { BREVILABS_API_BASE_URL } from "@/constants";
import { PLUS_ENV } from "@/agentMode/skills/builtin/builtinSkills";
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

    it("injects the host workspace root independently of Plus", async () => {
      mockGetSettings.mockReturnValue({ isPaidUser: false });

      expect(await buildBuiltinSkillEnv("", "/vault")).toEqual({
        [SYMPOSIUM_WORKSPACE_ROOT_ENV]: "/vault",
      });
    });

    it("injects the host Obsidian CLI independently of Plus and Miyo", async () => {
      mockGetSettings.mockReturnValue({ isPaidUser: false });
      mockResolveObsidianCliPath.mockReturnValue("C:/Users/Me/App Data/Obsidian/Obsidian.com");

      expect(await buildBuiltinSkillEnv()).toEqual({
        [COPILOT_OBSIDIAN_CLI_ENV]: "C:/Users/Me/App Data/Obsidian/Obsidian.com",
      });
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
});
