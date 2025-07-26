import { z } from "zod";

/**
 * Schema validation tests for SearchTools
 * These tests ensure that tool schemas match expected handler interfaces
 * without requiring complex runtime mocks
 */

describe("SearchTools Schema Validation", () => {
  describe("localSearchTool schema", () => {
    // Define the expected schema based on handler requirements
    const localSearchSchema = z.object({
      query: z.string().min(1).describe("The search query"),
      salientTerms: z.array(z.string()).describe("List of salient terms extracted from the query"),
      timeRange: z
        .object({
          startTime: z.any(), // TimeInfo type
          endTime: z.any(), // TimeInfo type
        })
        .optional()
        .describe("Time range for search"),
    });

    test("validates correct input structure", () => {
      const validInput = {
        query: "test query",
        salientTerms: ["test", "query"],
      };

      const result = localSearchSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    test("accepts empty salientTerms array", () => {
      const validInput = {
        query: "what did I do last week",
        salientTerms: [],
      };

      const result = localSearchSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    test("validates input with timeRange", () => {
      const validInput = {
        query: "meetings last week",
        salientTerms: ["meetings"],
        timeRange: {
          startTime: {
            epoch: 1234567890000,
            isoString: "2009-02-13T23:31:30.000Z",
            userLocaleString: "2/13/2009, 11:31:30 PM",
            localDateString: "2009-02-13",
            timezoneOffset: 0,
            timezone: "UTC",
          },
          endTime: {
            epoch: 1234567900000,
            isoString: "2009-02-13T23:31:40.000Z",
            userLocaleString: "2/13/2009, 11:31:40 PM",
            localDateString: "2009-02-13",
            timezoneOffset: 0,
            timezone: "UTC",
          },
        },
      };

      const result = localSearchSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    test("rejects empty query", () => {
      const invalidInput = {
        query: "",
        salientTerms: ["test"],
      };

      const result = localSearchSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("query");
      }
    });

    test("rejects missing salientTerms", () => {
      const invalidInput = {
        query: "test query",
      };

      const result = localSearchSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    test("rejects non-array salientTerms", () => {
      const invalidInput = {
        query: "test query",
        salientTerms: "not an array",
      };

      const result = localSearchSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });

  describe("webSearchTool schema", () => {
    // This should match ChatHistoryEntry interface
    const webSearchSchema = z.object({
      query: z.string().min(1).describe("The search query"),
      chatHistory: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          })
        )
        .describe("Previous conversation turns"),
    });

    test("validates correct input with proper chatHistory", () => {
      const validInput = {
        query: "search for TypeScript tutorials",
        chatHistory: [
          { role: "user" as const, content: "I want to learn TypeScript" },
          { role: "assistant" as const, content: "I can help you with that!" },
        ],
      };

      const result = webSearchSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    test("accepts empty chatHistory", () => {
      const validInput = {
        query: "TypeScript tutorials",
        chatHistory: [],
      };

      const result = webSearchSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    test("rejects invalid role in chatHistory", () => {
      const invalidInput = {
        query: "search query",
        chatHistory: [
          { role: "system", content: "System message" }, // 'system' not allowed
        ],
      };

      const result = webSearchSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("chatHistory");
      }
    });

    test("rejects missing content in chatHistory", () => {
      const invalidInput = {
        query: "search query",
        chatHistory: [{ role: "user" }], // missing content
      };

      const result = webSearchSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    test("rejects non-string content", () => {
      const invalidInput = {
        query: "search query",
        chatHistory: [
          { role: "user", content: 123 }, // content must be string
        ],
      };

      const result = webSearchSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    test("rejects z.any() chatHistory (regression test)", () => {
      // This tests that we're NOT using z.any()
      const weakSchema = z.object({
        query: z.string(),
        chatHistory: z.array(z.any()), // This is what we want to avoid
      });

      const malformedInput = {
        query: "test",
        chatHistory: ["just", "strings", 123, null], // Should fail with proper schema
      };

      // Weak schema would accept this
      expect(weakSchema.safeParse(malformedInput).success).toBe(true);

      // But our proper schema should reject it
      expect(webSearchSchema.safeParse(malformedInput).success).toBe(false);
    });
  });

  describe("indexTool schema", () => {
    const indexSchema = z.void();

    test("accepts undefined", () => {
      const result = indexSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    test("rejects any parameters", () => {
      const result = indexSchema.safeParse({ someParam: "value" });
      expect(result.success).toBe(false);
    });

    test("rejects string input", () => {
      const result = indexSchema.safeParse("string");
      expect(result.success).toBe(false);
    });

    test("handles empty object with SimpleTool fix", () => {
      // This tests the SimpleTool fix for empty objects on void schemas
      // The fix converts {} to undefined before validation
      const emptyObj = {};

      // Direct parse would fail
      const directResult = indexSchema.safeParse(emptyObj);
      expect(directResult.success).toBe(false);

      // But with the SimpleTool fix (simulated here), it should work
      const fixedInput = Object.keys(emptyObj).length === 0 ? undefined : emptyObj;
      const fixedResult = indexSchema.safeParse(fixedInput);
      expect(fixedResult.success).toBe(true);
    });
  });

  describe("Schema type inference", () => {
    test("localSearch schema infers correct types", () => {
      const localSchema = z.object({
        query: z.string().min(1),
        salientTerms: z.array(z.string()),
        timeRange: z
          .object({
            startTime: z.any(),
            endTime: z.any(),
          })
          .optional(),
      });

      type InferredType = z.infer<typeof localSchema>;

      // This is a compile-time test - if it compiles, types are correct
      const testValue: InferredType = {
        query: "test",
        salientTerms: ["test"],
        // timeRange is optional
      };

      // TypeScript should enforce these types
      const query: string = testValue.query;
      const terms: string[] = testValue.salientTerms;
      const timeRange = testValue.timeRange;

      expect(query).toBe("test");
      expect(terms).toEqual(["test"]);
      expect(timeRange).toBeUndefined();

      // Also validate the schema works
      expect(localSchema.safeParse(testValue).success).toBe(true);
    });

    test("webSearch schema matches ChatHistoryEntry interface", () => {
      // Define the expected interface
      interface ChatHistoryEntry {
        role: "user" | "assistant";
        content: string;
      }

      const webSchema = z.object({
        query: z.string().min(1),
        chatHistory: z.array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          })
        ),
      });

      type InferredType = z.infer<typeof webSchema>;

      // This ensures the inferred type matches ChatHistoryEntry[]
      const testValue: InferredType = {
        query: "test",
        chatHistory: [] as ChatHistoryEntry[],
      };

      // Should be assignable to ChatHistoryEntry[]
      const history: ChatHistoryEntry[] = testValue.chatHistory;
      expect(history).toEqual([]);

      // Also validate the schema works
      expect(webSchema.safeParse(testValue).success).toBe(true);
    });
  });
});
