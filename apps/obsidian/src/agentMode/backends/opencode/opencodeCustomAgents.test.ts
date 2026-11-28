import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "obsidian";
import {
  customAgentModeId,
  opencodeAgentsFilePath,
  putAgentEntries,
  readCustomAgentModeId,
  removeAgentEntries,
  startAgentEntries,
  writeAgentsFile,
} from "./opencodeCustomAgents";
import { useHermeticHome } from "./testing/hermeticHome";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/991";

describe("opencodeCustomAgents", () => {
  const sandbox = useHermeticHome();
  const agentsFile = () =>
    path.join(sandbox.home(), ".obsidian-copilot", "vaults", "v1", "opencode-agents.json");
  const readAgents = () =>
    JSON.parse(fs.readFileSync(agentsFile(), "utf8")).agents as Record<string, { system: string }>;

  describe("customAgentModeId()", () => {
    it(`names an agent's ask-first and Auto OpenCode agents and, apart, those of each prompt variant, so no two ids collide (${ISSUE})`, () => {
      expect([
        customAgentModeId({ slug: "coco", auto: false }),
        customAgentModeId({ slug: "coco", auto: true }),
        customAgentModeId({ slug: "coco", variant: "alt", auto: false }),
        customAgentModeId({ slug: "coco", variant: "alt", auto: true }),
        customAgentModeId({ slug: "coco-auto", auto: false }),
      ]).toEqual([
        "copilot-teammate-coco/default",
        "copilot-teammate-coco/auto",
        "copilot-teammate-coco/alt/default",
        "copilot-teammate-coco/alt/auto",
        "copilot-teammate-coco-auto/default",
      ]);
    });
  });

  describe("readCustomAgentModeId()", () => {
    it.each([
      ["copilot-teammate-coco/default", { slug: "coco", auto: false }],
      ["copilot-teammate-coco/auto", { slug: "coco", auto: true }],
      ["copilot-teammate-coco/alt/default", { slug: "coco", variant: "alt", auto: false }],
      ["copilot-teammate-coco/alt/auto", { slug: "coco", variant: "alt", auto: true }],
      ["copilot-teammate-auto/default", { slug: "auto", auto: false }],
      ["copilot-teammate-coco", null],
      ["copilot-teammate-coco/build", null],
      ["copilot-teammate-coco/alt", null],
      ["copilot-teammate-coco/alt/more/default", null],
      ["copilot-build", null],
      ["build", null],
    ])(
      `reads %s as %j, so a chat saved on an id from before ${ISSUE} still reads`,
      (modeId, expected) => {
        expect(readCustomAgentModeId(modeId)).toEqual(expected);
      }
    );
  });

  describe("opencodeAgentsFilePath()", () => {
    it("keeps the file with the vault's other Copilot app data, outside the vault", () => {
      expect(opencodeAgentsFilePath({ vault: { adapter: {} } } as unknown as App)).toBe(
        path.join(sandbox.home(), ".obsidian-copilot", "vaults", "default", "opencode-agents.json")
      );
    });
  });

  describe("writeAgentsFile()", () => {
    it("creates the folder and replaces the file whole, leaving no staged copy behind", async () => {
      await writeAgentsFile(agentsFile(), '{"agents":{"a":{}}}');
      await writeAgentsFile(agentsFile(), '{"agents":{"b":{}}}');

      expect(fs.readFileSync(agentsFile(), "utf8")).toBe('{"agents":{"b":{}}}');
      expect(fs.readdirSync(path.dirname(agentsFile()))).toEqual(["opencode-agents.json"]);
    });

    it(`leaves the previous file exactly as it was and no staged copy of the prompts beside it when the final rename fails (${ISSUE})`, async () => {
      await writeAgentsFile(agentsFile(), '{"agents":{"coco":{}}}');
      jest.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("EPERM: file is open"));

      await expect(writeAgentsFile(agentsFile(), '{"agents":{"maya":{}}}')).rejects.toThrow(
        "EPERM"
      );

      expect(fs.readFileSync(agentsFile(), "utf8")).toBe('{"agents":{"coco":{}}}');
      expect(fs.readdirSync(path.dirname(agentsFile()))).toEqual(["opencode-agents.json"]);
    });
  });

  describe("putAgentEntries()", () => {
    it("adds the entries to those written since OpenCode started and writes them all", async () => {
      startAgentEntries(agentsFile());

      await putAgentEntries(agentsFile(), { "copilot-teammate-coco/default": { system: "Coco" } });
      await putAgentEntries(agentsFile(), { "copilot-teammate-maya/default": { system: "Maya" } });

      expect(readAgents()).toEqual({
        "copilot-teammate-coco/default": { system: "Coco" },
        "copilot-teammate-maya/default": { system: "Maya" },
      });
    });

    it("drops the entries an earlier OpenCode run wrote once OpenCode starts again", async () => {
      startAgentEntries(agentsFile());
      await putAgentEntries(agentsFile(), { "copilot-teammate-coco/default": { system: "Coco" } });

      startAgentEntries(agentsFile());
      await putAgentEntries(agentsFile(), { "copilot-teammate-maya/default": { system: "Maya" } });

      expect(Object.keys(readAgents())).toEqual(["copilot-teammate-maya/default"]);
    });
  });

  describe("removeAgentEntries()", () => {
    it(`removes every entry of the agent, of each prompt variant, and keeps the other agents' entries (${ISSUE})`, async () => {
      startAgentEntries(agentsFile());
      await putAgentEntries(agentsFile(), {
        "copilot-teammate-coco/default": { system: "COCO-OWN" },
        "copilot-teammate-coco/alt/auto": { system: "COCO-ALT" },
        "copilot-teammate-coco-two/default": { system: "COCO-TWO" },
      });

      await removeAgentEntries(agentsFile(), "coco");

      expect(readAgents()).toEqual({ "copilot-teammate-coco-two/default": { system: "COCO-TWO" } });
    });

    it(`removes the agent from a file an earlier OpenCode run wrote, and the running OpenCode's next write does not bring it back (${ISSUE})`, async () => {
      startAgentEntries(agentsFile());
      await putAgentEntries(agentsFile(), {
        "copilot-teammate-coco/default": { system: "COCO-OWN" },
        "copilot-teammate-maya/default": { system: "MAYA" },
      });
      startAgentEntries(agentsFile());

      await removeAgentEntries(agentsFile(), "coco");
      expect(readAgents()).toEqual({ "copilot-teammate-maya/default": { system: "MAYA" } });
      await putAgentEntries(agentsFile(), {
        "copilot-teammate-coco/default": { system: "COCO-2" },
      });
      await removeAgentEntries(agentsFile(), "coco");
      await putAgentEntries(agentsFile(), { "copilot-teammate-leo/default": { system: "LEO" } });

      expect(readAgents()).toEqual({ "copilot-teammate-leo/default": { system: "LEO" } });
    });

    it(`writes nothing when OpenCode never ran an agent in the vault (${ISSUE})`, async () => {
      await removeAgentEntries(agentsFile(), "coco");

      expect(fs.existsSync(path.dirname(agentsFile()))).toBe(false);
    });
  });
});
