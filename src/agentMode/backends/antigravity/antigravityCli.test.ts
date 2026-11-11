import type { CopilotSettings } from "@/settings/model";
import { detectBinary } from "@/utils/detectBinary";
import {
  antigravityDetectionSearchDirs,
  antigravityInstallState,
  antigravitySignInCommand,
  detectAntigravityCliPath,
  resolveAntigravityBinaryPath,
} from "./antigravityCli";
import { pinTempHome, type TempHome } from "./testing/tempHome";

jest.mock("os", () => ({ ...jest.requireActual<object>("os"), homedir: jest.fn() }));
jest.mock("@/utils/detectBinary", () => ({ detectBinary: jest.fn() }));
jest.mock("@/utils/binaryPath", () => ({
  ...jest.requireActual<object>("@/utils/binaryPath"),
  WELL_KNOWN_BIN_DIRS: [],
}));

const mockedDetectBinary = jest.mocked(detectBinary);

function settingsWith(antigravity?: Record<string, unknown>): CopilotSettings {
  return {
    agentMode: { backends: antigravity ? { antigravity } : {} },
  } as unknown as CopilotSettings;
}

describe("antigravityCli", () => {
  let home: TempHome;

  beforeEach(() => {
    home = pinTempHome();
    mockedDetectBinary.mockReset().mockResolvedValue(null);
  });

  afterEach(() => home.restore());

  describe("antigravityInstallState()", () => {
    it("reports ready when a binary path resolved and absent when none did", () => {
      expect(antigravityInstallState("/bin/agy")).toEqual({ kind: "ready", source: "custom" });
      expect(antigravityInstallState(null)).toEqual({ kind: "absent" });
    });

    it("returns the same object for the same outcome", () => {
      expect(antigravityInstallState("/a/agy")).toBe(antigravityInstallState("/b/agy"));
      expect(antigravityInstallState(null)).toBe(antigravityInstallState(null));
    });
  });

  describe("resolveAntigravityBinaryPath()", () => {
    it("finds agy installed in the home directory without any saved path", () => {
      const agy = home.installAgy();

      expect(resolveAntigravityBinaryPath(settingsWith())).toBe(agy);
    });

    it("uses the saved path when it exists", () => {
      const agy = home.installAgy();

      expect(resolveAntigravityBinaryPath(settingsWith({ binaryPath: agy }))).toBe(agy);
    });

    it("returns null when agy is not installed", () => {
      expect(resolveAntigravityBinaryPath(settingsWith())).toBeNull();
    });
  });

  describe("detectAntigravityCliPath()", () => {
    it("returns agy from the usual install locations without searching PATH", async () => {
      const agy = home.installAgy();

      await expect(detectAntigravityCliPath()).resolves.toBe(agy);
      expect(mockedDetectBinary).not.toHaveBeenCalled();
    });

    it("falls back to the agy found on the login shell's PATH", async () => {
      mockedDetectBinary.mockResolvedValue("/custom/prefix/bin/agy");

      await expect(detectAntigravityCliPath()).resolves.toBe("/custom/prefix/bin/agy");
      expect(mockedDetectBinary).toHaveBeenCalledWith("agy");
    });
  });

  describe("antigravityDetectionSearchDirs()", () => {
    it("names the home directory's .local/bin as a searched location", () => {
      expect(antigravityDetectionSearchDirs()).toContain(`${home.homeDir}/.local/bin`);
    });
  });

  describe("antigravitySignInCommand()", () => {
    it("runs the resolved agy with acp --login", () => {
      expect(antigravitySignInCommand("/home/me/.local/bin/agy", undefined, "darwin")).toBe(
        "/home/me/.local/bin/agy acp --login"
      );
    });

    it("carries a HOME override into the command so sign-in caches credentials where the agent reads them", () => {
      expect(antigravitySignInCommand("/bin/agy", { HOME: "/alt home" }, "darwin")).toBe(
        "HOME='/alt home' /bin/agy acp --login"
      );
    });

    it("offers no command until agy is found", () => {
      expect(antigravitySignInCommand(null, undefined, "darwin")).toBeNull();
    });
  });
});
