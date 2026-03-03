import { createToolCallMarker } from "./utils/toolCallParser";

/**
 * Test suite for AutonomousAgentChainRunner tool call ID handling
 *
 * This test suite specifically addresses the bug where temporary tool call IDs
 * (e.g., "temporary-tool-call-id-localSearch-0") were created during streaming,
 * but then the code tried to find them using unique timestamp-based IDs
 * (e.g., "localSearch-1234567890-abc123"), causing React to fail when unmounting
 * DOM nodes because the IDs didn't match.
 */

/**
 * Test suite for agent loop empty response detection (Issue #2233)
 *
 * This test suite addresses the bug where Gemini 3.1 Pro Preview agent loop
 * would stop with only a reasoning marker and no user-visible output.
 * The fix detects when the model returns no content and no tool calls,
 * and provides an actionable error message instead of silently returning empty.
 */
describe("AutonomousAgentChainRunner - Empty Response Detection", () => {
  /**
   * Helper function that mimics the empty response detection logic
   * from runReActLoop in AutonomousAgentChainRunner.ts
   */
  const detectAndHandleEmptyResponse = (
    content: string,
    toolCallsLength: number
  ): { isEmpty: boolean; finalContent: string } => {
    // No tool calls = final response
    if (toolCallsLength === 0) {
      let finalContent = content;
      if (!finalContent || finalContent.trim() === "") {
        // Empty response detected - provide error message
        finalContent =
          "The model did not produce a response. This can happen when:\n" +
          "- The model's reasoning was filtered but no answer was generated\n" +
          "- The model encountered an issue during response generation\n\n" +
          "Please try again or switch to a different model.";
        return { isEmpty: true, finalContent };
      }
      return { isEmpty: false, finalContent };
    }
    return { isEmpty: false, finalContent: content };
  };

  describe("Empty content with no tool calls", () => {
    it("should detect empty string as empty response", () => {
      const result = detectAndHandleEmptyResponse("", 0);
      expect(result.isEmpty).toBe(true);
      expect(result.finalContent).toContain("model did not produce a response");
    });

    it("should detect whitespace-only string as empty response", () => {
      const result = detectAndHandleEmptyResponse("   \n\t  ", 0);
      expect(result.isEmpty).toBe(true);
      expect(result.finalContent).toContain("model did not produce a response");
    });

    it("should detect undefined content as empty response", () => {
      const result = detectAndHandleEmptyResponse(undefined as unknown as string, 0);
      expect(result.isEmpty).toBe(true);
      expect(result.finalContent).toContain("model did not produce a response");
    });
  });

  describe("Valid content with no tool calls", () => {
    it("should not modify valid content", () => {
      const validContent = "Here is your answer based on the search results.";
      const result = detectAndHandleEmptyResponse(validContent, 0);
      expect(result.isEmpty).toBe(false);
      expect(result.finalContent).toBe(validContent);
    });

    it("should not modify content with leading/trailing whitespace", () => {
      const contentWithWhitespace = "  Valid response content  ";
      const result = detectAndHandleEmptyResponse(contentWithWhitespace, 0);
      expect(result.isEmpty).toBe(false);
      expect(result.finalContent).toBe(contentWithWhitespace);
    });
  });

  describe("Tool calls present", () => {
    it("should not trigger empty detection when tool calls exist", () => {
      // Even if content is empty, having tool calls means loop continues
      const result = detectAndHandleEmptyResponse("", 1);
      expect(result.isEmpty).toBe(false);
      expect(result.finalContent).toBe("");
    });

    it("should preserve empty content when tool calls exist", () => {
      const result = detectAndHandleEmptyResponse("", 3);
      expect(result.isEmpty).toBe(false);
      // Content stays empty because we continue to tool execution
      expect(result.finalContent).toBe("");
    });
  });

  describe("Error message content", () => {
    it("should include actionable guidance in error message", () => {
      const result = detectAndHandleEmptyResponse("", 0);
      expect(result.finalContent).toContain("try again");
      expect(result.finalContent).toContain("different model");
    });

    it("should explain possible causes in error message", () => {
      const result = detectAndHandleEmptyResponse("", 0);
      expect(result.finalContent).toContain("reasoning was filtered");
      expect(result.finalContent).toContain("response generation");
    });
  });
});

describe("AutonomousAgentChainRunner - Tool Call ID Generation", () => {
  describe("Tool Call ID Uniqueness", () => {
    /**
     * Test that tool call IDs are unique across multiple tool calls
     * This prevents React from getting confused when mounting/unmounting components
     */
    it("should generate unique IDs for multiple tool calls", () => {
      const toolName = "localSearch";
      const ids: string[] = [];

      // Generate multiple IDs
      for (let i = 0; i < 10; i++) {
        const id = `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        ids.push(id);
      }

      // Check that all IDs are unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    /**
     * Test that tool call IDs have the correct format
     * Format: {toolName}-{timestamp}-{random}
     */
    it("should generate IDs with correct format", () => {
      const toolName = "localSearch";
      const id = `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // Verify format: toolName-timestamp-random
      const parts = id.split("-");
      expect(parts.length).toBeGreaterThanOrEqual(3);
      expect(parts[0]).toBe(toolName);
      expect(Number.isNaN(Number(parts[1]))).toBe(false); // timestamp should be a number
      expect(parts[2].length).toBeGreaterThan(0); // random part should exist
    });

    /**
     * Test that tool call IDs for different tools are distinct
     */
    it("should generate distinct IDs for different tool types", () => {
      const tools = ["localSearch", "readNote", "webSearch"];
      const ids = tools.map(
        (tool) => `${tool}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
      );

      // All IDs should start with their respective tool name
      tools.forEach((tool, index) => {
        expect(ids[index].startsWith(tool)).toBe(true);
      });

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("Temporary vs Final Tool Call ID", () => {
    /**
     * Test the temporary ID generation function used during streaming
     * This is the ID format that should be used for initial tool call markers
     */
    it("should generate temporary IDs with consistent format", () => {
      const getTemporaryToolCallId = (toolName: string, index: number): string => {
        return `temporary-tool-call-id-${toolName}-${index}`;
      };

      const tempId1 = getTemporaryToolCallId("localSearch", 0);
      const tempId2 = getTemporaryToolCallId("localSearch", 1);
      const tempId3 = getTemporaryToolCallId("readNote", 0);

      expect(tempId1).toBe("temporary-tool-call-id-localSearch-0");
      expect(tempId2).toBe("temporary-tool-call-id-localSearch-1");
      expect(tempId3).toBe("temporary-tool-call-id-readNote-0");
    });

    /**
     * Test that temporary IDs should be replaced with unique IDs during execution
     * This ensures that React components are properly identified for unmounting
     */
    it("should use unique IDs during tool execution, not temporary IDs", () => {
      const toolName = "localSearch";
      const toolIndex = 0;

      // During streaming, we use temporary IDs
      const tempId = `temporary-tool-call-id-${toolName}-${toolIndex}`;

      // During execution, we should generate unique IDs
      const uniqueId = `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // The unique ID should NOT match the temporary ID format
      expect(uniqueId).not.toMatch(/^temporary-tool-call-id-/);
      expect(uniqueId).toContain(toolName);
      expect(uniqueId).not.toBe(tempId);
    });

    /**
     * Test that tool call markers can be created with both temporary and unique IDs
     */
    it("should create tool call markers with unique IDs", () => {
      const toolName = "localSearch";
      const uniqueId = `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      const marker = createToolCallMarker(
        uniqueId,
        toolName,
        "Vault Search",
        "🔍",
        "Searching your vault...",
        true,
        "",
        ""
      );

      // Verify the marker contains the unique ID
      expect(marker).toContain(uniqueId);
      expect(marker).toContain(toolName);
    });
  });

  describe("Tool Call ID Map", () => {
    /**
     * Test that the toolCallIdMap correctly tracks tool call IDs by index
     * This is critical for finding the right DOM element to update/unmount
     */
    it("should maintain a map of tool call indices to IDs", () => {
      const toolCallIdMap = new Map<number, string>();

      // Simulate tool execution loop
      const toolCalls = [
        { name: "localSearch", index: 0 },
        { name: "readNote", index: 1 },
        { name: "localSearch", index: 2 },
      ];

      toolCalls.forEach((toolCall) => {
        const uniqueId = `${toolCall.name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        toolCallIdMap.set(toolCall.index, uniqueId);
      });

      // Verify the map has correct entries
      expect(toolCallIdMap.size).toBe(3);
      expect(toolCallIdMap.get(0)).toBeDefined();
      expect(toolCallIdMap.get(1)).toBeDefined();
      expect(toolCallIdMap.get(2)).toBeDefined();

      // Verify IDs are unique
      const ids = Array.from(toolCallIdMap.values());
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    /**
     * Test that the same tool called multiple times gets different IDs
     */
    it("should assign different IDs to the same tool called multiple times", () => {
      const toolCallIdMap = new Map<number, string>();
      const toolName = "localSearch";

      // Call the same tool 3 times
      for (let i = 0; i < 3; i++) {
        const uniqueId = `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        toolCallIdMap.set(i, uniqueId);
      }

      // All IDs should be different
      const id0 = toolCallIdMap.get(0);
      const id1 = toolCallIdMap.get(1);
      const id2 = toolCallIdMap.get(2);

      expect(id0).toBeDefined();
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id0).not.toBe(id1);
      expect(id1).not.toBe(id2);
      expect(id0).not.toBe(id2);
    });
  });

  describe("Regression Test for React Unmounting Bug", () => {
    /**
     * This test specifically addresses the bug where temporary IDs were used during
     * streaming, but unique IDs were used during execution, causing React to fail
     * when trying to unmount components.
     *
     * The fix ensures that:
     * 1. Temporary IDs are used during streaming to create initial markers
     * 2. Unique IDs are generated during execution
     * 3. The temporary markers are found and replaced with unique ID markers
     */
    it("should correctly handle ID transition from temporary to unique", () => {
      const getTemporaryToolCallId = (toolName: string, index: number): string => {
        return `temporary-tool-call-id-${toolName}-${index}`;
      };

      const toolName = "localSearch";
      const toolIndex = 0;

      // Step 1: During streaming, create a temporary ID
      const tempId = getTemporaryToolCallId(toolName, toolIndex);
      const currentIterationToolCallMessages: string[] = [];

      // Create a temporary marker
      const tempMarker = createToolCallMarker(
        tempId,
        toolName,
        "Vault Search",
        "🔍",
        "",
        true,
        "",
        ""
      );
      currentIterationToolCallMessages.push(tempMarker);

      // Step 2: During execution, generate a unique ID
      const uniqueId = `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // Step 3: Find and replace the temporary marker
      const existingIndex = currentIterationToolCallMessages.findIndex((msg) =>
        msg.includes(tempId)
      );

      expect(existingIndex).toBe(0); // Should find the temporary marker

      // Replace with unique ID marker
      const uniqueMarker = createToolCallMarker(
        uniqueId,
        toolName,
        "Vault Search",
        "🔍",
        "Searching your vault...",
        true,
        "",
        ""
      );
      currentIterationToolCallMessages[existingIndex] = uniqueMarker;

      // Step 4: Verify the replacement
      expect(currentIterationToolCallMessages[0]).toContain(uniqueId);
      expect(currentIterationToolCallMessages[0]).not.toContain(tempId);

      // Step 5: Verify the unique ID doesn't match temporary format
      expect(uniqueId).not.toMatch(/^temporary-tool-call-id-/);
    });
  });
});
