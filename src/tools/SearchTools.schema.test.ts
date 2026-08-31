import { createLocalSearchTool, indexTool, webSearchTool } from "@/tools/SearchTools";
import type { App } from "obsidian";

describe("SearchTools", () => {
  describe("createLocalSearchTool()", () => {
    const schema = createLocalSearchTool({} as App).schema;

    it("accepts epoch time ranges and pre-expanded query data", () => {
      const result = schema.safeParse({
        query: "meetings last week",
        salientTerms: ["meetings"],
        timeRange: {
          startTime: 1234567890000,
          endTime: 1234567900000,
        },
        _preExpandedQuery: {
          originalQuery: "meetings last week",
          salientTerms: ["meetings"],
          expandedQueries: ["recent meetings"],
          recallTerms: ["meetings", "recent meetings"],
        },
      });

      expect(result.success).toBe(true);
    });

    it("accepts an empty salient-terms list and omitted optional search metadata", () => {
      expect(schema.safeParse({ query: "what did I do last week", salientTerms: [] }).success).toBe(
        true
      );
    });

    it("accepts partial numeric time ranges for the tool handler to sanitize", () => {
      expect(
        schema.safeParse({
          query: "notes since yesterday",
          salientTerms: ["notes"],
          timeRange: { startTime: 1234567890000 },
        }).success
      ).toBe(true);
    });

    it("rejects empty queries and missing salient terms", () => {
      expect(schema.safeParse({ query: "", salientTerms: ["test"] }).success).toBe(false);
      expect(schema.safeParse({ query: "test query" }).success).toBe(false);
    });

    it("rejects legacy TimeInfo objects and incomplete pre-expanded query data", () => {
      expect(
        schema.safeParse({
          query: "meetings last week",
          salientTerms: ["meetings"],
          timeRange: {
            startTime: { epoch: 1234567890000 },
            endTime: { epoch: 1234567900000 },
          },
        }).success
      ).toBe(false);

      expect(
        schema.safeParse({
          query: "meetings last week",
          salientTerms: ["meetings"],
          _preExpandedQuery: {
            originalQuery: "meetings last week",
            salientTerms: ["meetings"],
            expandedQueries: ["recent meetings"],
          },
        }).success
      ).toBe(false);
    });
  });

  describe("webSearchTool schema", () => {
    const schema = webSearchTool.schema;

    it("accepts user and assistant chat history entries", () => {
      expect(
        schema.safeParse({
          query: "TypeScript tutorials",
          chatHistory: [
            { role: "user", content: "I want to learn TypeScript" },
            { role: "assistant", content: "I can help with that." },
          ],
        }).success
      ).toBe(true);
      expect(schema.safeParse({ query: "TypeScript tutorials", chatHistory: [] }).success).toBe(
        true
      );
    });

    it("rejects empty queries and malformed chat history entries", () => {
      expect(schema.safeParse({ query: "", chatHistory: [] }).success).toBe(false);
      expect(
        schema.safeParse({
          query: "search query",
          chatHistory: [{ role: "system", content: "System message" }],
        }).success
      ).toBe(false);
      expect(
        schema.safeParse({
          query: "search query",
          chatHistory: [{ role: "user" }],
        }).success
      ).toBe(false);
    });
  });

  describe("indexTool schema", () => {
    const schema = indexTool.schema;

    it("accepts the empty arguments object used to invoke the parameterless tool", () => {
      expect(schema.safeParse({}).success).toBe(true);
    });

    it("rejects non-object inputs", () => {
      expect(schema.safeParse(undefined).success).toBe(false);
      expect(schema.safeParse("index").success).toBe(false);
    });
  });
});
