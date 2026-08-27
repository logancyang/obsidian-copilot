import { antigravityWire, AntigravityBackendDescriptor } from "./descriptor";

describe("AntigravityBackendDescriptor", () => {
  describe("antigravityWire", () => {
    it("encodes model selection without effort as baseModelId", () => {
      expect(
        antigravityWire.encode({
          baseModelId: "gemini-3.7-flash",
          effort: null,
        })
      ).toBe("gemini-3.7-flash");
    });

    it("encodes model selection with effort as baseModelId/effort", () => {
      expect(
        antigravityWire.encode({
          baseModelId: "gemini-3.7-flash",
          effort: "high",
        })
      ).toBe("gemini-3.7-flash/high");
    });

    it("decodes simple wire id into selection with null effort", () => {
      expect(antigravityWire.decode("gemini-3.7-flash")).toEqual({
        selection: {
          baseModelId: "gemini-3.7-flash",
          effort: null,
        },
        provider: null,
      });
    });

    it("decodes compound wire id with recognized effort", () => {
      expect(antigravityWire.decode("gemini-3.7-flash/high")).toEqual({
        selection: {
          baseModelId: "gemini-3.7-flash",
          effort: "high",
        },
        provider: null,
      });
    });

    it("treats compound wire id with unknown effort segment as base model id", () => {
      expect(antigravityWire.decode("gemini-3.7-flash/unknown-effort")).toEqual({
        selection: {
          baseModelId: "gemini-3.7-flash/unknown-effort",
          effort: null,
        },
        provider: null,
      });
    });
  });

  describe("descriptor metadata", () => {
    it("has id antigravity and correct displayName", () => {
      expect(AntigravityBackendDescriptor.id).toBe("antigravity");
      expect(AntigravityBackendDescriptor.displayName).toBe("Antigravity");
      expect(AntigravityBackendDescriptor.selfHostable).toBe(false);
    });
  });
});
