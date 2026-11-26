import { getSettings, resetSettings, setSettings } from "@/settings/model";
import { CursorBackend } from "./CursorBackend";
import { resolveCursorBinary } from "./cursorBinaryResolver";

jest.mock("./cursorBinaryResolver", () => ({
  resolveCursorBinary: jest.fn(),
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: () => false,
}));

describe("CursorBackend", () => {
  describe("CursorBackend", () => {
    describe("buildSpawnDescriptor()", () => {
      beforeEach(() => {
        resetSettings();
        jest.mocked(resolveCursorBinary).mockReset();
      });

      it("starts the Cursor agent in ACP mode from the resolved installation", async () => {
        jest.mocked(resolveCursorBinary).mockReturnValue("/home/me/.local/bin/agent");
        setSettings({
          agentMode: {
            ...getSettings().agentMode,
            backends: {
              ...getSettings().agentMode.backends,
              cursor: {
                binaryPath: "/home/me/.local/bin/agent",
                envOverrides: { HTTPS_PROXY: "http://proxy" },
              },
            },
          },
        });

        const descriptor = await new CursorBackend("1.2.3").buildSpawnDescriptor();

        expect(descriptor.command).toBe("/home/me/.local/bin/agent");
        expect(descriptor.args).toEqual(["acp"]);
        expect(descriptor.env.HTTPS_PROXY).toBe("http://proxy");
      });

      it("refuses to start when no Cursor installation can be found", async () => {
        jest.mocked(resolveCursorBinary).mockReturnValue(null);
        await expect(new CursorBackend().buildSpawnDescriptor()).rejects.toThrow(
          "Cursor isn't set up. Install it or choose Auto-detect in Settings → Copilot → Basic → Agents."
        );
      });
    });
  });
});
