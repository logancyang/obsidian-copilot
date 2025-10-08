import { ToolResultFormatter } from "@/tools/ToolResultFormatter";
import { createToolCallMarker, parseToolCallMarkers, updateToolCallMarker } from "./toolCallParser";

jest.mock("@/logger");

describe("toolCallParser encoding/decoding", () => {
  it("should preserve result containing HTML comment terminators via encoding", () => {
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
      // Result contains sequences that could break HTML comments without encoding
      '{"key":"value --><script>alert(1)</script> more"}'
    );

    const parsed = parseToolCallMarkers(marker);
    const toolSeg = parsed.segments.find((s) => s.type === "toolCall")!;
    expect(toolSeg.toolCall?.id).toBe(id);
    expect(toolSeg.toolCall?.isExecuting).toBe(true);
    // Decoded result equals original
    expect(toolSeg.toolCall?.result).toBe('{"key":"value --><script>alert(1)</script> more"}');
  });

  it("updateToolCallMarker should encode result and set isExecuting=false", () => {
    const id = "localSearch-456";
    let marker = createToolCallMarker(id, "localSearch", "Vault Search", "🔍", "", true, "", "");

    const rawResult = '{"key":"value <!-- nested --> and more"}';
    marker = updateToolCallMarker(marker, id, rawResult);

    const parsed = parseToolCallMarkers(marker);
    const toolSeg = parsed.segments.find((s) => s.type === "toolCall")!;
    expect(toolSeg.toolCall?.isExecuting).toBe(false);
    expect(toolSeg.toolCall?.result).toBe(rawResult);
  });

  it("integration: ToolResultFormatter.format should handle encoded JSON localSearch results", () => {
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

  it("omits oversized encoded results to keep the UI responsive", () => {
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
});
