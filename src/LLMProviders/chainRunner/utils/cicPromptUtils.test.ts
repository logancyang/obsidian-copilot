import {
  buildLocalSearchInnerContent,
  ensureCiCOrderingWithQuestion,
  injectGuidanceBeforeUserQuery,
  renderCiCMessage,
  wrapLocalSearchPayload,
} from "./cicPromptUtils";

describe("cicPromptUtils", () => {
  describe("buildLocalSearchInnerContent", () => {
    it("orders intro text before documents and trims whitespace", () => {
      const intro = "\nIntro block\n";
      const documents = "\n<document>Doc</document>\n";

      const inner = buildLocalSearchInnerContent(intro, documents);

      expect(inner).toBe("Intro block\n\n<document>Doc</document>");
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
    it("places context before question", () => {
      const combined = renderCiCMessage("context block", "What?");

      expect(combined).toBe("context block\n\nWhat?");
    });

    it("returns the original question when context is blank", () => {
      expect(renderCiCMessage("  \n  ", "What?")).toBe("What?");
    });
  });

  describe("ensureCiCOrderingWithQuestion", () => {
    it("appends the trimmed question with [User query]: label after the payload when missing", () => {
      const payload = "<localSearch>\n<context/>\n</localSearch>";
      const question = "  What did I do last week?  ";

      const result = ensureCiCOrderingWithQuestion(payload, question);

      // Should add "[User query]:" label (same format as LayerToMessagesConverter)
      expect(result).toBe(renderCiCMessage(payload, "[User query]:\nWhat did I do last week?"));
    });

    it("returns payload unchanged when question already included", () => {
      const question = "What did I do last week?";
      const payload = renderCiCMessage("<localSearch />", `[User query]:\n${question}`);

      expect(ensureCiCOrderingWithQuestion(payload, question)).toBe(payload);
    });

    it("returns payload unchanged when question is blank", () => {
      const payload = "<localSearch>\n<context/>\n</localSearch>";

      expect(ensureCiCOrderingWithQuestion(payload, "   ")).toBe(payload);
    });
  });

  describe("injectGuidanceBeforeUserQuery", () => {
    const guidance = "<guidance>\nRules\n</guidance>";

    it("places guidance before user query label when present", () => {
      const payload = "# Additional context:\n\n<context>\n</context>\n\n[User query]:\nWhat?";
      const result = injectGuidanceBeforeUserQuery(payload, guidance);

      expect(result).toBe(
        "# Additional context:\n\n<context>\n</context>\n\n<guidance>\nRules\n</guidance>\n\n[User query]:\nWhat?"
      );
    });

    it("appends guidance when user query label missing", () => {
      const payload = "<context>\n</context>";
      const result = injectGuidanceBeforeUserQuery(payload, guidance);

      expect(result).toBe("<context>\n</context>\n\n<guidance>\nRules\n</guidance>");
    });

    it("leaves payload unchanged when guidance empty", () => {
      const payload = "<context>\n</context>";
      expect(injectGuidanceBeforeUserQuery(payload, "")).toBe(payload);
      expect(injectGuidanceBeforeUserQuery(payload, null)).toBe(payload);
      expect(injectGuidanceBeforeUserQuery(payload, undefined)).toBe(payload);
    });

    it("handles payloads with trailing whitespace before label", () => {
      const payload = "# Additional context:\n\n<context>\n</context>\n  \n\n[User query]:\nWhat?";
      const result = injectGuidanceBeforeUserQuery(payload, guidance);

      expect(result).toBe(
        "# Additional context:\n\n<context>\n</context>\n\n<guidance>\nRules\n</guidance>\n\n[User query]:\nWhat?"
      );
    });
  });
});
