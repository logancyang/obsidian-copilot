import {
  buildLocalSearchInnerContent,
  ensureCiCOrderingWithQuestion,
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

  describe("ensureCiCOrderingWithQuestion", () => {
    it("appends the trimmed question after the payload when missing", () => {
      const payload = "<localSearch>\n<context/>\n</localSearch>";
      const question = "  What did I do last week?  ";

      const result = ensureCiCOrderingWithQuestion(payload, question);

      expect(result).toBe(renderCiCMessage(payload, "What did I do last week?", true));
    });

    it("returns payload unchanged when question already included", () => {
      const question = "What did I do last week?";
      const payload = renderCiCMessage("<localSearch />", question, true);

      expect(ensureCiCOrderingWithQuestion(payload, question)).toBe(payload);
    });

    it("returns payload unchanged when question is blank", () => {
      const payload = "<localSearch>\n<context/>\n</localSearch>";

      expect(ensureCiCOrderingWithQuestion(payload, "   ")).toBe(payload);
    });
  });
});
