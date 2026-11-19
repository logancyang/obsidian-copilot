import { isAgentMemoryFile } from "@/agents/agentMemoryFile";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

jest.mock("@/entitlement");

describe("agentMemoryFile", () => {
  describe("isAgentMemoryFile()", () => {
    let root: string;
    let coco: string;
    let memory: string;

    beforeEach(async () => {
      await setCustomAgentsAccess("team");
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-file-")));
      coco = path.join(root, "copilot", "agents", "coco");
      fs.mkdirSync(coco, { recursive: true });
      fs.mkdirSync(path.join(root, "copilot", "agents", "maya"), { recursive: true });
      memory = path.join(coco, "MEMORY.md");
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it("accepts the agent's own MEMORY.md before the first save creates it", () => {
      expect(isAgentMemoryFile(memory, memory)).toBe(true);
    });

    it("accepts the agent's own MEMORY.md once it exists", () => {
      fs.writeFileSync(memory, "## How to work\n");

      expect(isAgentMemoryFile(memory, memory)).toBe(true);
    });

    it("accepts the same file named through '..' or a symlinked folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      fs.writeFileSync(memory, "");
      fs.symlinkSync(coco, path.join(root, "coco-link"));

      expect(isAgentMemoryFile(path.join(coco, "..", "coco", "MEMORY.md"), memory)).toBe(true);
      expect(isAgentMemoryFile(path.join(root, "coco-link", "MEMORY.md"), memory)).toBe(true);
    });

    it("refuses another agent's MEMORY.md, the agent's own instructions.md and a MEMORY.md elsewhere (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      expect(isAgentMemoryFile(path.join(root, "copilot/agents/maya/MEMORY.md"), memory)).toBe(
        false
      );
      expect(isAgentMemoryFile(path.join(coco, "instructions.md"), memory)).toBe(false);
      expect(isAgentMemoryFile(path.join(root, "MEMORY.md"), memory)).toBe(false);
    });

    it("refuses a path that climbs out of the folder with '..' to another agent (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      expect(isAgentMemoryFile(path.join(coco, "..", "maya", "MEMORY.md"), memory)).toBe(false);
    });

    it("refuses a MEMORY.md that is a symlink to a file outside the agent's folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      const outside = path.join(root, "notes.md");
      fs.writeFileSync(outside, "");
      fs.symlinkSync(outside, memory);

      expect(isAgentMemoryFile(memory, memory)).toBe(false);
    });

    it("refuses a relative path, which names no one file", () => {
      expect(isAgentMemoryFile("copilot/agents/coco/MEMORY.md", memory)).toBe(false);
    });

    it("refuses every path once the agent's folder is gone", () => {
      fs.rmSync(coco, { recursive: true });

      expect(isAgentMemoryFile(memory, memory)).toBe(false);
    });

    it("refuses a MEMORY.md that is a symlink to a file that does not exist yet, which a write would create outside the folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      fs.symlinkSync(path.join(root, "not-yet.md"), memory);

      expect(isAgentMemoryFile(memory, memory)).toBe(false);
    });

    it("refuses a MEMORY.md hard-linked to another file, which a write would change too (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      const outside = path.join(root, "notes.md");
      fs.writeFileSync(outside, "");
      fs.linkSync(outside, memory);

      expect(isAgentMemoryFile(memory, memory)).toBe(false);
    });

    it("refuses another letter case of the file name, which names another file on a case-sensitive disk (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      fs.writeFileSync(memory, "");

      expect(isAgentMemoryFile(path.join(coco, "memory.md"), memory)).toBe(false);
    });

    it("refuses the agent's own MEMORY.md while custom agents are not available, as when the license is removed during the chat (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", async () => {
      await setCustomAgentsAccess("plus-without-custom-agents");

      expect(isAgentMemoryFile(memory, memory)).toBe(false);
    });

    it("compares Windows paths by folder and exact file name: either separator names the file, while a stream, a short name or another agent's folder does not (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      const folders = new Set([
        "C:\\Vault\\copilot\\agents\\coco",
        "C:\\Vault\\copilot\\agents\\maya",
      ]);
      const windowsFs = {
        realpathSync: {
          native: (target: string) => {
            const resolved = path.win32.resolve(target);
            if (!folders.has(resolved)) throw new Error(`ENOENT: ${target}`);
            return resolved;
          },
        },
        lstatSync: () => undefined,
      };
      let isWindowsMemoryFile: typeof isAgentMemoryFile = () => true;
      jest.isolateModules(() => {
        jest.doMock("@/agents/customAgentsGate", () => ({ getCustomAgentsGate: () => "full" }));
        jest.doMock("@/utils/desktopRuntime", () => ({
          requireNodeModule: (id: string) => (id === "path" ? path.win32 : windowsFs),
        }));
        ({ isAgentMemoryFile: isWindowsMemoryFile } = jest.requireActual<
          typeof import("@/agents/agentMemoryFile")
        >("@/agents/agentMemoryFile"));
      });
      const memoryPath = "C:\\Vault/copilot/agents/coco/MEMORY.md";

      expect(isWindowsMemoryFile("C:\\Vault\\copilot\\agents\\coco\\MEMORY.md", memoryPath)).toBe(
        true
      );
      expect(isWindowsMemoryFile("C:/Vault/copilot/agents/coco/MEMORY.md", memoryPath)).toBe(true);
      for (const other of [
        "C:\\Vault\\copilot\\agents\\coco\\MEMORY.md:hidden",
        "C:\\Vault\\copilot\\agents\\coco\\MEMORY~1.MD",
        "C:\\Vault\\copilot\\agents\\coco\\..\\maya\\MEMORY.md",
      ]) {
        expect(isWindowsMemoryFile(other, memoryPath)).toBe(false);
      }
    });
  });
});
