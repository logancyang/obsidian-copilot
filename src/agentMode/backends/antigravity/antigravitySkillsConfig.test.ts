import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Skill } from "@/agentMode/skills/types";
import { syncAntigravitySkillsConfig } from "./antigravitySkillsConfig";
import { pinTempHome, type TempHome } from "./testing/tempHome";

jest.mock("os", () => ({ ...jest.requireActual<object>("os"), homedir: jest.fn() }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function skill(name: string, enabledAgents: string[]): Skill {
  return {
    name,
    description: name,
    filePath: `copilot/skills/${name}/SKILL.md`,
    dirPath: `copilot/skills/${name}`,
    body: "",
    enabledAgents,
    location: { kind: "canonical" },
  };
}

describe("antigravitySkillsConfig", () => {
  describe("syncAntigravitySkillsConfig()", () => {
    let home: TempHome;
    let vault: string;
    let config: string;

    beforeEach(() => {
      home = pinTempHome();
      vault = join(home.homeDir, "vault");
      mkdirSync(vault);
      config = join(vault, ".agent", "skills.json");
    });

    afterEach(() => home.restore());

    const excluded = () =>
      JSON.parse(readFileSync(config, "utf8")) as {
        entries: Array<{ path: string; exclude: string[] }>;
      };

    it("excludes from Codex's .agents/skills, by whole name, each managed skill switched on for Codex and off for Antigravity", async () => {
      await syncAntigravitySkillsConfig(
        vault,
        [
          skill("codexonly", ["codex"]),
          skill("dot.name", ["codex", "claude"]),
          skill("shared", ["codex", "antigravity"]),
          skill("agyonly", ["antigravity"]),
          skill("claudeonly", ["claude"]),
        ],
        ["codex"]
      );

      expect(excluded()).toEqual({
        entries: [{ path: ".agents/skills", exclude: ["^codexonly$", "^dot\\.name$"] }],
      });
    });

    it("writes no file when no skill needs excluding", async () => {
      await syncAntigravitySkillsConfig(
        vault,
        [skill("shared", ["codex", "antigravity"])],
        ["codex"]
      );

      expect(existsSync(config)).toBe(false);
    });

    it("removes its own file once the last excluded skill is switched on for Antigravity", async () => {
      await syncAntigravitySkillsConfig(vault, [skill("codexonly", ["codex"])], ["codex"]);

      await syncAntigravitySkillsConfig(
        vault,
        [skill("codexonly", ["codex", "antigravity"])],
        ["codex"]
      );

      expect(existsSync(config)).toBe(false);
    });

    it("leaves a skills.json Copilot did not write as it is, even when a skill needs excluding", async () => {
      mkdirSync(join(vault, ".agent"));
      const own = '{"entries":[{"path":"team/skills"}]}\n';
      writeFileSync(config, own);

      await syncAntigravitySkillsConfig(vault, [skill("codexonly", ["codex"])], ["codex"]);
      await syncAntigravitySkillsConfig(vault, [], ["codex"]);

      expect(readFileSync(config, "utf8")).toBe(own);
    });
  });
});
