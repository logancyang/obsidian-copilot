import { resetSettings, setSettings } from "@/settings/model";
import { ANTIGRAVITY_NOT_SET_UP_MESSAGE, AntigravityBackend } from "./AntigravityBackend";
import { pinTempHome, type TempHome } from "./testing/tempHome";

jest.mock("os", () => ({ ...jest.requireActual<object>("os"), homedir: jest.fn() }));
jest.mock("@/utils/binaryPath", () => ({
  ...jest.requireActual<object>("@/utils/binaryPath"),
  WELL_KNOWN_BIN_DIRS: [],
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function useAntigravitySettings(antigravity?: Record<string, unknown>): void {
  setSettings((current) => ({
    agentMode: {
      ...current.agentMode,
      activeBackend: "antigravity",
      backends: antigravity ? { antigravity } : {},
    },
  }));
}

describe("AntigravityBackend", () => {
  describe("AntigravityBackend", () => {
    describe("buildSpawnDescriptor()", () => {
      let home: TempHome;

      beforeEach(() => {
        home = pinTempHome();
        resetSettings();
      });

      afterEach(() => home.restore());

      it("launches the detected agy as an ACP server", async () => {
        const agy = home.installAgy();
        useAntigravitySettings();

        const descriptor = await new AntigravityBackend().buildSpawnDescriptor();

        expect(descriptor.command).toBe(agy);
        expect(descriptor.args).toEqual(["acp"]);
      });

      it("passes the user's environment overrides to the agent", async () => {
        const agy = home.installAgy();
        useAntigravitySettings({ binaryPath: agy, envOverrides: { HTTPS_PROXY: "http://proxy" } });

        const descriptor = await new AntigravityBackend().buildSpawnDescriptor();

        expect(descriptor.env.HTTPS_PROXY).toBe("http://proxy");
      });

      it("refuses to start with a setup hint when agy is not installed", async () => {
        useAntigravitySettings();

        await expect(new AntigravityBackend().buildSpawnDescriptor()).rejects.toThrow(
          ANTIGRAVITY_NOT_SET_UP_MESSAGE
        );
      });
    });
  });
});
