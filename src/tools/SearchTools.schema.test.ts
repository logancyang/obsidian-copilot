import type { App } from "obsidian";

const mockGetSettings = jest.fn<Record<string, unknown>, []>();
const mockIsMiyoActive = jest.fn<boolean, []>();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));
jest.mock("@/search/RetrieverFactory", () => ({
  RetrieverFactory: {
    isMiyoActive: () => mockIsMiyoActive(),
  },
}));

import { createLocalSearchTool, webSearchTool } from "@/tools/SearchTools";

describe("SearchTools", () => {
  describe("createLocalSearchTool()", () => {
    const schema = createLocalSearchTool({} as App).schema;

    it("reports unavailable instead of using keyword search when enabled Miyo cannot run on mobile (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
      mockGetSettings.mockReturnValue({ enableMiyo: true });
      mockIsMiyoActive.mockReturnValue(false);
      const tool = createLocalSearchTool({} as App);
      const invoke = tool.invoke.bind(tool) as (input: {
        query: string;
        salientTerms: string[];
      }) => Promise<string>;

      await expect(invoke({ query: "vault notes", salientTerms: [] })).rejects.toThrow(
        "Miyo is unavailable. Configure a remote Miyo connection, then retry vault search."
      );
    });

    it("accepts epoch time ranges", () => {
      const result = schema.safeParse({
        query: "meetings last week",
        salientTerms: ["meetings"],
        timeRange: {
          startTime: 1234567890000,
          endTime: 1234567900000,
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

    it("rejects legacy TimeInfo objects", () => {
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
});
