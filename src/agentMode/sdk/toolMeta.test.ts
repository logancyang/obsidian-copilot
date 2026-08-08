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

  // Read-only fan-out leans on `deriveToolKind` to label every native Claude
  // file-mutation tool as a vault-write kind so the shared permission prompter
  // denies it. A tool that falls through to `"other"` would be ALLOWED in a
  // read-only sub-session — that is the gap this guard catches. NotebookEdit
  // (.ipynb writes) regressed here once: it was not in any branch and slipped
  // through as `"other"`.
  it("classifies every native Claude file-mutation tool so read-only fan-out denies it", () => {
    const writeTools = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
    for (const name of writeTools) {
      const kind = deriveToolKind(name);
      expect(isVaultWriteToolKind(kind)).toBe(true);
    }
  });

  // Bash is `execute`, intentionally ALLOWED in a read-only fan-out turn so
  // Copilot's skill-script relay tools (web search/fetch) run; the read-only
  // prompt + native sandbox keep shell from writing the vault.
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
