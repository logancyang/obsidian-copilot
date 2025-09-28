import {
  buildLocalSearchInnerContent,
  renderCiCMessage,
  wrapLocalSearchPayload,
} from "./cicPromptUtils";

describe("cicPromptUtils", () => {
  describe("buildLocalSearchInnerContent", () => {
    it("orders guidance before documents and trims whitespace", () => {
      const guidance = "\n<guidance>Rules</guidance>\n";
      const documents = "\n<document>Doc</document>\n";

      const inner = buildLocalSearchInnerContent(guidance, documents);

      expect(inner).toBe("<guidance>Rules</guidance>\n\n<document>Doc</document>");
    });

    it("returns empty string when both inputs are blank", () => {
      expect(buildLocalSearchInnerContent("", "")).toBe("");
    });
  });

  describe("wrapLocalSearchPayload", () => {
    it("wraps content with localSearch tag and preserves time range", () => {
      const content = "<guidance>Rules</guidance>\n\n<document>Doc</document>";

      const wrapped = wrapLocalSearchPayload(content, "last week");

      expect(wrapped).toBe(
        '<localSearch timeRange="last week">\n<guidance>Rules</guidance>\n\n<document>Doc</document>\n</localSearch>'
      );
    });

    it("omits payload whitespace when content is empty", () => {
      expect(wrapLocalSearchPayload("", "")).toBe("<localSearch></localSearch>");
    });
  });

  describe("renderCiCMessage", () => {
    it("places context before question and adds label when requested", () => {
      const combined = renderCiCMessage("context block", "What?", true);

      expect(combined).toBe("context block\n\nQuestion: What?");
    });

    it("returns the original question when context is blank", () => {
      expect(renderCiCMessage("  \n  ", "What?", false)).toBe("What?");
    });
  });
});
