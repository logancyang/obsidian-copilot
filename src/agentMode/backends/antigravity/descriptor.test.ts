import { AntigravityBackendDescriptor } from "./descriptor";

describe("descriptor", () => {
  describe("AntigravityBackendDescriptor", () => {
    describe("wire.encode()", () => {
      it("encodes baseModelId with effort suffix", () => {
        expect(
          AntigravityBackendDescriptor.wire.encode({
            baseModelId: "gemini-3.7-pro",
            effort: "high",
          })
        ).toBe("gemini-3.7-pro-high");
      });

      it("encodes baseModelId without effort", () => {
        expect(
          AntigravityBackendDescriptor.wire.encode({
            baseModelId: "gemini-3.7-pro",
            effort: null,
          })
        ).toBe("gemini-3.7-pro");
      });
    });

    describe("wire.decode()", () => {
      it("decodes model without effort into google provider and null effort", () => {
        expect(AntigravityBackendDescriptor.wire.decode("gemini-3.7-flash")).toEqual({
          selection: { baseModelId: "gemini-3.7-flash", effort: null },
          provider: "google",
        });
      });

      it("decodes model with slash effort suffix", () => {
        expect(AntigravityBackendDescriptor.wire.decode("gemini-3.7-pro/high")).toEqual({
          selection: { baseModelId: "gemini-3.7-pro", effort: "high" },
          provider: "google",
        });
      });

      it("decodes model with dash effort suffix", () => {
        expect(AntigravityBackendDescriptor.wire.decode("gemini-3.6-flash-medium")).toEqual({
          selection: { baseModelId: "gemini-3.6-flash", effort: "medium" },
          provider: "google",
        });
      });

      it("handles empty wireId gracefully", () => {
        expect(AntigravityBackendDescriptor.wire.decode("")).toEqual({
          selection: { baseModelId: "", effort: null },
          provider: "google",
        });
      });
    });

    describe("normalizeModelName()", () => {
      it("normalizes gemini model names with title casing", () => {
        expect(AntigravityBackendDescriptor.normalizeModelName?.("gemini-3.7-pro")).toBe(
          "Gemini-3.7-pro"
        );
      });

      it("normalizes claude and gpt model names with title casing", () => {
        expect(AntigravityBackendDescriptor.normalizeModelName?.("claude-sonnet-4-6")).toBe(
          "Claude-sonnet-4-6"
        );
        expect(AntigravityBackendDescriptor.normalizeModelName?.("gpt-oss-120b")).toBe(
          "GPT-oss-120b"
        );
      });
    });

    describe("getModeMapping()", () => {
      it("returns null when modeState is null to preserve live spec", () => {
        expect(AntigravityBackendDescriptor.getModeMapping?.(null, null)).toBeNull();
      });

      it("maps standard agent/plan/auto modes from live advertised modes", () => {
        const modeState = {
          currentModeId: "agent",
          availableModes: [{ id: "agent" }, { id: "plan" }, { id: "auto" }],
        };
        expect(AntigravityBackendDescriptor.getModeMapping?.(modeState as unknown, null)).toEqual({
          kind: "setMode",
          canonical: {
            default: "agent",
            plan: "plan",
            auto: "auto",
          },
          readOnlyModeId: "plan",
        });
      });

      it("maps alias modes like default/read-only/full-access from live advertised modes", () => {
        const modeState = {
          currentModeId: "default",
          availableModes: [{ id: "default" }, { id: "read-only" }, { id: "full-access" }],
        };
        expect(AntigravityBackendDescriptor.getModeMapping?.(modeState as unknown, null)).toEqual({
          kind: "setMode",
          canonical: {
            default: "default",
            plan: "read-only",
            auto: "full-access",
          },
          readOnlyModeId: "read-only",
        });
      });
    });
  });
});
