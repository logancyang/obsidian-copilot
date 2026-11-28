import { ToolResultFormatter } from "@/tools/ToolResultFormatter";
import { createToolCallMarker, parseToolCallMarkers } from "./toolCallParser";

jest.mock("@/logger");

describe("toolCallParser", () => {
  describe("createToolCallMarker() with parseToolCallMarkers()", () => {
    it("splits a message into text, tool call and text segments carrying the marker's fields", () => {
      const marker = createToolCallMarker(
        "webSearch-1",
        "webSearch",
        "Web Search",
        "🌐",
        "Searching the web",
        false,
        "",
        "found it"
      );

      const { segments } = parseToolCallMarkers(`Before ${marker} After`);

      expect(segments.map((s) => s.type)).toEqual(["text", "toolCall", "text"]);
      expect(segments[0].content).toBe("Before ");
      expect(segments[1].toolCall).toMatchObject({
        id: "webSearch-1",
        toolName: "webSearch",
        displayName: "Web Search",
        emoji: "🌐",
        confirmationMessage: "Searching the web",
        isExecuting: false,
        result: "found it",
      });
      expect(segments[2].content).toBe(" After");
    });

    it("returns one text segment for a message without markers", () => {
      expect(parseToolCallMarkers("Just an answer").segments).toEqual([
        { type: "text", content: "Just an answer" },
      ]);
    });

    it("round-trips a result that contains an HTML comment terminator", () => {
      const id = "localSearch-123";
      const toolName = "localSearch";
      const marker = createToolCallMarker(
        id,
        toolName,
        "Vault Search",
        "🔍",
        "",
        true,
        "",
        '{"key":"value --><script>alert(1)</script> more"}'
      );

      const parsed = parseToolCallMarkers(marker);
      const toolSeg = parsed.segments.find((s) => s.type === "toolCall")!;
      expect(toolSeg.toolCall?.id).toBe(id);
      expect(toolSeg.toolCall?.isExecuting).toBe(true);
      expect(toolSeg.toolCall?.result).toBe('{"key":"value --><script>alert(1)</script> more"}');
    });

    it("round-trips a localSearch JSON result, containing marker-like text, so ToolResultFormatter can format it", () => {
      const id = "localSearch-789";
      const localSearchArrayJson = JSON.stringify({
        type: "local_search",
        documents: [
          {
            title: "Lesson 1",
            content:
              "Date: 2025/5/13\nProgress: 0/10. <!--TOOL_CALL_START:x:y:z:a:b:c--> should not break JSON --> tail",
            path: "Piano Lessons/Lesson 1.md",
            score: 0.59,
            rerank_score: null,
            includeInContext: true,
          },
        ],
      });

      const marker = createToolCallMarker(
        id,
        "localSearch",
        "Vault search",
        "🔍",
        "",
        false,
        "",
        localSearchArrayJson
      );

      const parsed = parseToolCallMarkers(marker);
      const resultString = parsed.segments.find((s) => s.type === "toolCall")!.toolCall!.result!;

      const formatted = ToolResultFormatter.format("localSearch", resultString);
      expect(formatted).toContain("📚 Found 1 relevant notes");
      expect(formatted).toContain("Lesson 1");
    });

    it("replaces a result over 5,000 characters with an omitted notice", () => {
      const id = "readNote-large";
      const oversizedPayload = "a".repeat(6000);
      const marker = createToolCallMarker(
        id,
        "readNote",
        "Read Note",
        "🔍",
        "",
        false,
        "",
        oversizedPayload
      );

      const parsed = parseToolCallMarkers(marker);
      const toolSegment = parsed.segments.find((s) => s.type === "toolCall")!;
      expect(toolSegment.toolCall?.result).toBe(
        "Tool 'readNote' Result omitted to keep the UI responsive (payload exceeded 5,000 characters)."
      );
    });

    it("keeps a result of 4,000 characters intact", () => {
      const id = "readNote-medium";
      const mediumPayload = "a".repeat(4000);
      const marker = createToolCallMarker(
        id,
        "readNote",
        "Read Note",
        "🔍",
        "",
        false,
        "",
        mediumPayload
      );

      const parsed = parseToolCallMarkers(marker);
      const toolSegment = parsed.segments.find((s) => s.type === "toolCall")!;
      expect(toolSegment.toolCall?.result).toBe(mediumPayload);
    });
  });
});
