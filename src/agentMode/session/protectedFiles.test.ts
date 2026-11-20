import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isProtectedFile, type ProtectedFiles } from "@/agentMode/session/protectedFiles";

describe("protectedFiles", () => {
  let root: string;
  let vault: string;
  let rule: ProtectedFiles;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "protected-files-")));
    vault = path.join(root, "vault");
    fs.mkdirSync(path.join(vault, "copilot/agents/coco"), { recursive: true });
    fs.writeFileSync(path.join(vault, "copilot/agents/coco/instructions.md"), "You are Coco.");
    rule = {
      folder: path.join(vault, "copilot/agents"),
      fileName: "instructions.md",
      reason: "Only the user edits it.",
    };
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  describe("isProtectedFile()", () => {
    it("protects a file with the rule's name in a folder under the rule's folder, whether it exists yet or not", () => {
      expect(
        isProtectedFile(rule, path.join(vault, "copilot/agents/coco/instructions.md"), vault)
      ).toBe(true);
      expect(
        isProtectedFile(rule, path.join(vault, "copilot/agents/new/instructions.md"), vault)
      ).toBe(true);
    });

    it("resolves a relative path against the chat's folder", () => {
      expect(isProtectedFile(rule, "copilot/agents/coco/instructions.md", vault)).toBe(true);
      expect(
        isProtectedFile(rule, "agents/coco/instructions.md", path.join(vault, "copilot"))
      ).toBe(true);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/989 protects the file reached through '..', another letter case or a nested folder", () => {
      expect(
        isProtectedFile(
          rule,
          path.join(vault, "notes/../copilot/agents/coco/instructions.md"),
          vault
        )
      ).toBe(true);
      expect(
        isProtectedFile(rule, path.join(vault, "copilot/Agents/coco/Instructions.MD"), vault)
      ).toBe(true);
      expect(
        isProtectedFile(rule, path.join(vault, "copilot/agents/coco/drafts/instructions.md"), vault)
      ).toBe(true);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/989 protects the file reached through a symlinked folder outside the rule's folder", () => {
      fs.symlinkSync(path.join(vault, "copilot/agents"), path.join(vault, "shortcut"));

      expect(isProtectedFile(rule, path.join(vault, "shortcut/coco/instructions.md"), vault)).toBe(
        true
      );
      expect(isProtectedFile(rule, path.join(vault, "shortcut/new/instructions.md"), vault)).toBe(
        true
      );
    });

    it("leaves other files in the rule's folder and files of that name elsewhere unprotected", () => {
      for (const target of [
        "copilot/agents/coco/MEMORY.md",
        "copilot/agents/coco/notes.md",
        "copilot/agents/coco/instructions.md.bak",
        "copilot/instructions.md",
        "notes/instructions.md",
        "copilot/agents-old/coco/instructions.md",
      ]) {
        expect([target, isProtectedFile(rule, path.join(vault, target), vault)]).toEqual([
          target,
          false,
        ]);
      }
    });
  });
});
