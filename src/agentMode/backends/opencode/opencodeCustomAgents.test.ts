import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { App } from "obsidian";
import {
  customAgentModeId,
  opencodeAgentsFilePath,
  readCustomAgentModeId,
  writeAgentsFile,
} from "./opencodeCustomAgents";

describe("opencodeCustomAgents", () => {
  describe("customAgentModeId()", () => {
    it("names an agent's ask-first and Auto OpenCode agents so no two agents' ids collide", () => {
      expect([
        customAgentModeId({ slug: "coco", auto: false }),
        customAgentModeId({ slug: "coco", auto: true }),
        customAgentModeId({ slug: "coco-auto", auto: false }),
      ]).toEqual([
        "copilot-agent-coco/default",
        "copilot-agent-coco/auto",
        "copilot-agent-coco-auto/default",
      ]);
    });
  });

  describe("readCustomAgentModeId()", () => {
    it.each([
      ["copilot-agent-coco/default", { slug: "coco", auto: false }],
      ["copilot-agent-coco/auto", { slug: "coco", auto: true }],
      ["copilot-agent-auto/default", { slug: "auto", auto: false }],
      ["copilot-agent-coco", null],
      ["copilot-agent-coco/build", null],
      ["copilot-build", null],
      ["build", null],
    ])("reads %s as %j", (modeId, expected) => {
      expect(readCustomAgentModeId(modeId)).toEqual(expected);
    });
  });

  describe("opencodeAgentsFilePath()", () => {
    it("keeps the file with the vault's other Copilot app data, outside the vault", () => {
      expect(opencodeAgentsFilePath({ vault: { adapter: {} } } as unknown as App)).toBe(
        path.join(os.homedir(), ".obsidian-copilot", "vaults", "default", "opencode-agents.json")
      );
    });
  });

  describe("writeAgentsFile()", () => {
    it("creates the folder and replaces the file whole, leaving no staged copy behind", async () => {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-agents-file-"));
      const file = path.join(dir, "vaults", "v1", "opencode-agents.json");
      try {
        await writeAgentsFile(file, '{"agents":{"a":{}}}');
        await writeAgentsFile(file, '{"agents":{"b":{}}}');

        expect(fs.readFileSync(file, "utf8")).toBe('{"agents":{"b":{}}}');
        expect(fs.readdirSync(path.dirname(file))).toEqual(["opencode-agents.json"]);
      } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
      }
    });
  });
});
