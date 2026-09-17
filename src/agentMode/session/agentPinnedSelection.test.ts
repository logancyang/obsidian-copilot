import { resolveAgentPinnedSelection } from "@/agentMode/session/agentPinnedSelection";

const SESSION_DEFAULT = { baseModelId: "sonnet", effort: "medium" };

describe("agentPinnedSelection", () => {
  describe("resolveAgentPinnedSelection()", () => {
    it("leaves the selection alone for the built-in Copilot, which pins nothing", () => {
      expect(resolveAgentPinnedSelection(null, "claude", SESSION_DEFAULT)).toBeNull();
    });

    it("leaves the selection alone for an agent that pins only a backend", () => {
      const pins = { backendId: "claude", modelId: null, effort: null };
      expect(resolveAgentPinnedSelection(pins, "claude", SESSION_DEFAULT)).toBeNull();
    });

    it("names the pinned model and lets the backend choose the effort", () => {
      const pins = { backendId: null, modelId: "opus", effort: null };
      expect(resolveAgentPinnedSelection(pins, "claude", SESSION_DEFAULT)).toEqual({
        baseModelId: "opus",
        effort: null,
      });
    });

    it("applies a pinned effort to the model the chat would otherwise open on", () => {
      const pins = { backendId: null, modelId: null, effort: "high" };
      expect(resolveAgentPinnedSelection(pins, "claude", SESSION_DEFAULT)).toEqual({
        baseModelId: "sonnet",
        effort: "high",
      });
    });

    it("applies a pinned model and effort together", () => {
      const pins = { backendId: "claude", modelId: "opus", effort: "high" };
      expect(resolveAgentPinnedSelection(pins, "claude", SESSION_DEFAULT)).toEqual({
        baseModelId: "opus",
        effort: "high",
      });
    });

    it("drops a model pin made for a different backend, which would not know the id", () => {
      const pins = { backendId: "codex", modelId: "gpt-5", effort: "high" };
      expect(resolveAgentPinnedSelection(pins, "claude", SESSION_DEFAULT)).toBeNull();
    });

    it("drops an effort-only pin when there is no model for it to ride on", () => {
      const pins = { backendId: null, modelId: null, effort: "high" };
      expect(resolveAgentPinnedSelection(pins, "claude", null)).toBeNull();
    });
  });
});
