import { isVaultWriteToolKind } from "@/agentMode/session/fanout/fanoutTypes";
import { deriveToolKind } from "./toolMeta";

describe("deriveToolKind", () => {
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

  it("classifies every native Claude file-mutation tool so read-only fan-out denies it", () => {
    const writeTools = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
    for (const name of writeTools) {
      const kind = deriveToolKind(name);
      expect(isVaultWriteToolKind(kind)).toBe(true);
    }
  });

  it("classifies Bash as execute (allowed in read-only fan-out)", () => {
    expect(deriveToolKind("Bash")).toBe("execute");
    expect(isVaultWriteToolKind("execute")).toBe(false);
  });

  it("routes native plan tools to switch_mode (not an MCP tool of the same name)", () => {
    expect(deriveToolKind("ExitPlanMode")).toBe("switch_mode");
    expect(deriveToolKind("EnterPlanMode")).toBe("switch_mode");
    expect(deriveToolKind("ExitPlanMode", "some-mcp")).toBe("other");
  });
});
