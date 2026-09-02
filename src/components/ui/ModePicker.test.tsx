import { getModeLabel } from "@/components/ui/ModePicker";

describe("ModePicker", () => {
  describe("getModeLabel()", () => {
    it("returns localized canonical modes and preserves unknown backend values for https://github.com/Brevilabs/obsidian-copilot-private/issues/326", () => {
      const display = {
        default: { label: "安全", description: "" },
        auto: { label: "自动", description: "" },
        plan: { label: "计划", description: "" },
      };
      expect(getModeLabel("default", display)).toBe("安全");
      expect(getModeLabel("auto", display)).toBe("自动");
      expect(getModeLabel("plan", display)).toBe("计划");
      expect(getModeLabel("custom" as never, display)).toBe("custom");
    });
  });
});
