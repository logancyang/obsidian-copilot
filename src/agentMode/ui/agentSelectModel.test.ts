import type { BackendDescriptor, BackendId, InstallState } from "@/agentMode/session/types";
import {
  buildAgentSelectRows,
  resolveAgentSelectCta,
  type AgentSelectRow,
} from "./agentSelectModel";

function descriptor(id: BackendId, overrides: Partial<BackendDescriptor> = {}): BackendDescriptor {
  return {
    id,
    displayName: id,
    setupDescription: `${id} description`,
    ...overrides,
  } as BackendDescriptor;
}

const OPENCODE = descriptor("opencode", { displayName: "opencode" });
const CLAUDE = descriptor("claude", { displayName: "Claude" });
const CODEX = descriptor("codex", { displayName: "Codex" });
const DISPLAY_ORDER = [OPENCODE, CLAUDE, CODEX];

const INCOMPATIBLE: InstallState = {
  kind: "incompatible",
  source: "custom",
  currentVersion: "1.15.0",
  minVersion: "1.16.0",
  message: "opencode v1.15.0 is not supported. Copilot requires opencode v1.16.0 or newer.",
};
const ERRORED: InstallState = { kind: "error", message: "opencode binary is not executable." };

function rowWith(overrides: Partial<AgentSelectRow> = {}): AgentSelectRow {
  return {
    id: "opencode",
    name: "opencode",
    description: "opencode description",
    status: "absent",
    recommended: false,
    statusMessage: null,
    ...overrides,
  };
}

describe("agentSelectModel", () => {
  describe("buildAgentSelectRows()", () => {
    it("reports a ready backend as installed with no status message", () => {
      const [row] = buildAgentSelectRows(
        [OPENCODE],
        { opencode: { kind: "ready", source: "managed" } },
        "opencode"
      );

      expect(row.status).toBe("installed");
      expect(row.statusMessage).toBeNull();
    });

    it("reports an incompatible backend as outdated and carries its message", () => {
      const [row] = buildAgentSelectRows([OPENCODE], { opencode: INCOMPATIBLE }, "opencode");

      expect(row.status).toBe("outdated");
      expect(row.statusMessage).toBe(INCOMPATIBLE.message);
    });

    it("reports an errored backend as error and carries its message", () => {
      const [row] = buildAgentSelectRows([OPENCODE], { opencode: ERRORED }, "opencode");

      expect(row.status).toBe("error");
      expect(row.statusMessage).toBe(ERRORED.message);
    });

    it("reports an absent backend as absent", () => {
      const [row] = buildAgentSelectRows([OPENCODE], { opencode: { kind: "absent" } }, "opencode");

      expect(row.status).toBe("absent");
      expect(row.statusMessage).toBeNull();
    });

    it("reports an in-flight readiness probe as checking", () => {
      const [row] = buildAgentSelectRows(
        [CLAUDE],
        { claude: { kind: "checking", source: "custom" } },
        "opencode"
      );

      expect(row.status).toBe("checking");
    });

    it("treats a backend with no reported install state as absent", () => {
      const [row] = buildAgentSelectRows([CODEX], {}, "opencode");

      expect(row.status).toBe("absent");
    });

    it("preserves the caller's descriptor order", () => {
      const rows = buildAgentSelectRows(DISPLAY_ORDER, {}, "opencode");

      expect(rows.map((row) => row.id)).toEqual(["opencode", "claude", "codex"]);
    });

    it("marks exactly one row as recommended", () => {
      const rows = buildAgentSelectRows(DISPLAY_ORDER, {}, "opencode");

      expect(rows.filter((row) => row.recommended).map((row) => row.id)).toEqual(["opencode"]);
    });

    it("copies the name and description from the descriptor", () => {
      const [row] = buildAgentSelectRows([OPENCODE], {}, "opencode");

      expect(row.name).toBe("opencode");
      expect(row.description).toBe("opencode description");
    });

    it("returns one shared frozen slice when there are no descriptors", () => {
      const first = buildAgentSelectRows([], {}, "opencode");
      const second = buildAgentSelectRows([], {}, "opencode");

      expect(first).toHaveLength(0);
      expect(second).toBe(first);
      expect(Object.isFrozen(first)).toBe(true);
    });
  });

  describe("resolveAgentSelectCta()", () => {
    it("keeps a checking agent non-actionable until its probe settles", () => {
      expect(resolveAgentSelectCta(rowWith({ status: "checking", name: "Claude" }))).toEqual({
        label: "Checking…",
        note: "Checking Claude setup…",
        action: "wait",
      });
    });

    it("offers to start a chat on an installed agent without claiming authentication", () => {
      expect(resolveAgentSelectCta(rowWith({ status: "installed" }))).toEqual({
        label: "Start chat",
        note: null,
        action: "start",
      });
    });

    it("routes an outdated agent to configure and reuses its install message verbatim", () => {
      expect(
        resolveAgentSelectCta(rowWith({ status: "outdated", statusMessage: INCOMPATIBLE.message }))
      ).toEqual({
        label: "Configure",
        note: INCOMPATIBLE.message,
        action: "configure",
      });
    });

    it("routes an errored agent to configure and reuses its error message verbatim", () => {
      expect(
        resolveAgentSelectCta(rowWith({ status: "error", statusMessage: ERRORED.message }))
      ).toEqual({
        label: "Configure",
        note: ERRORED.message,
        action: "configure",
      });
    });

    it("routes an absent agent to configure and names it in the note", () => {
      expect(resolveAgentSelectCta(rowWith({ status: "absent", name: "Codex" }))).toEqual({
        label: "Configure",
        note: "Codex isn't set up on this machine yet.",
        action: "configure",
      });
    });
  });
});
