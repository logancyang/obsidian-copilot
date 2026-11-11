import * as path from "node:path";
import * as os from "os";
import type { CopilotSettings } from "@/settings/model";
import { agentChildEnv, agentHomeDir, agentUserPath } from "./agentUserDirs";

jest.mock("os", () => ({
  ...jest.requireActual<object>("os"),
  homedir: jest.fn(() => "/os/home"),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/868";

function settingsWith(envOverrides: Record<string, string>): CopilotSettings {
  return { agentMode: { backends: { codex: { envOverrides } } } } as unknown as CopilotSettings;
}

describe("agentUserDirs", () => {
  describe("agentChildEnv()", () => {
    it("layers the agent's env overrides over Obsidian's environment", () => {
      const env = agentChildEnv(settingsWith({ CODEX_HOME: "/data/codex" }), "codex");
      expect(env.CODEX_HOME).toBe("/data/codex");
      expect(env.PATH).toBe(process.env.PATH);
    });

    it("returns Obsidian's environment for an agent without overrides", () => {
      expect(agentChildEnv(settingsWith({}), "claude")).toEqual(process.env);
    });
  });

  describe("agentHomeDir()", () => {
    it(`uses the HOME the agent runs with ${ISSUE}`, () => {
      expect(agentHomeDir({ HOME: "/home/me" })).toBe(
        process.platform === "win32" ? "/os/home" : "/home/me"
      );
    });

    it("falls back to the operating system's home folder without HOME", () => {
      expect(agentHomeDir({})).toBe("/os/home");
      expect(os.homedir).toHaveBeenCalled();
    });
  });

  describe("agentUserPath()", () => {
    it("joins path segments under the agent's home folder", () => {
      expect(agentUserPath({}, ".claude", "skills")).toBe(
        path.join("/os/home", ".claude", "skills")
      );
    });
  });
});
