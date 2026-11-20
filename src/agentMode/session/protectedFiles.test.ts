import * as path from "path";
import { isProtectedFile } from "@/agentMode/session/protectedFiles";
import {
  createProtectedFilesVault,
  type ProtectedFilesVault,
} from "@/agentMode/session/testing/protectedFilesVault";

describe("protectedFiles", () => {
  let fixture: ProtectedFilesVault;

  beforeEach(() => {
    fixture = createProtectedFilesVault("Only the user edits it.");
  });

  afterEach(() => fixture.remove());

  describe("isProtectedFile()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/989 protects the rule's file in a folder of the rule's folder however the path spells where the write lands, and nothing else", () => {
      const verdicts = fixture.cases.map(({ spelling, target }) => [
        spelling,
        isProtectedFile(fixture.rule, target, fixture.vault),
      ]);

      expect(verdicts).toEqual(
        fixture.cases.map(({ spelling, protected: expected }) => [spelling, expected])
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/989 resolves a relative path from a project chat's folder, not the vault", () => {
      const project = path.join(fixture.vault, "Projects", "Launch");

      expect(
        isProtectedFile(fixture.rule, "../../copilot/agents/coco/instructions.md", project)
      ).toBe(true);
      expect(isProtectedFile(fixture.rule, "copilot/agents/coco/instructions.md", project)).toBe(
        false
      );
    });
  });
});
