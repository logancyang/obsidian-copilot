import { deriveToolKind } from "./toolMeta";

describe("toolMeta", () => {
  describe("deriveToolKind()", () => {
    it("classifies native read tools as read", () => {
      for (const name of ["Read", "Glob", "Grep", "LS"]) {
        expect(deriveToolKind(name)).toBe("read");
      }
    });

    it("classifies native fetch tools as fetch", () => {
      for (const name of ["WebSearch", "WebFetch"]) {
        expect(deriveToolKind(name)).toBe("fetch");
      }
    });

    it("classifies every native Claude file-mutation tool as edit", () => {
      for (const name of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
        expect(deriveToolKind(name)).toBe("edit");
      }
    });

    it("classifies Bash as execute", () => {
      expect(deriveToolKind("Bash")).toBe("execute");
    });

    it("routes native plan tools to switch_mode (not an MCP tool of the same name)", () => {
      expect(deriveToolKind("ExitPlanMode")).toBe("switch_mode");
      expect(deriveToolKind("EnterPlanMode")).toBe("switch_mode");
      expect(deriveToolKind("ExitPlanMode", "some-mcp")).toBe("other");
    });
  });
});
