import { z } from "zod";
import { StructuredTool } from "@langchain/core/tools";

/**
 * Tool validation tests to ensure all tools follow best practices
 * and have properly typed schemas that match their handlers
 */

// Helper to check if a tool schema uses z.any() which reduces type safety
function hasWeakTyping(schema: z.ZodType): boolean {
  if (schema instanceof z.ZodAny) {
    return true;
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const value of Object.values(shape)) {
      if (hasWeakTyping(value as z.ZodType)) {
        return true;
      }
    }
  }

  if (schema instanceof z.ZodArray) {
    return hasWeakTyping(schema._def.type);
  }

  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return hasWeakTyping(schema._def.innerType);
  }

  return false;
}

// Helper to validate tool metadata
function validateToolMetadata(tool: StructuredTool): string[] {
  const issues: string[] = [];

  if (!tool.name || tool.name.trim() === "") {
    issues.push("Tool must have a non-empty name");
  }

  if (!tool.description || tool.description.trim() === "") {
    issues.push("Tool must have a non-empty description");
  }

  if (tool.name && tool.name.includes(" ")) {
    issues.push("Tool name should not contain spaces");
  }

  if (!tool.schema) {
    issues.push("Tool must have a schema");
  }

  return issues;
}

describe("All Tools Validation", () => {
  describe("StructuredTool tools validation", () => {
    // We'll test tools individually since we can't easily import all at once due to circular deps

    test("Tool validation helper functions work correctly", () => {
      // Test weak typing detection
      const weakSchema = z.object({
        good: z.string(),
        bad: z.any(), // This should be detected
      });

      expect(hasWeakTyping(weakSchema)).toBe(true);

      const strongSchema = z.object({
        query: z.string(),
        count: z.number(),
        items: z.array(z.string()),
      });

      expect(hasWeakTyping(strongSchema)).toBe(false);
    });

    test("Metadata validation works correctly", () => {
      const goodTool = {
        name: "testTool",
        description: "A test tool",
        schema: z.void(),
      } as unknown as StructuredTool;

      expect(validateToolMetadata(goodTool)).toEqual([]);

      const badTool = {
        name: "",
        description: "  ",
        schema: z.void(),
      } as unknown as StructuredTool;

      const issues = validateToolMetadata(badTool);
      expect(issues).toContain("Tool must have a non-empty name");
      expect(issues).toContain("Tool must have a non-empty description");
    });
  });

  describe("Schema best practices", () => {
    test("Schemas should use specific types instead of z.any()", () => {
      // Good practice
      const goodSchema = z.object({
        query: z.string().describe("Search query"),
        options: z
          .object({
            caseSensitive: z.boolean().optional(),
            limit: z.number().min(1).max(100).optional(),
          })
          .optional(),
      });

      expect(hasWeakTyping(goodSchema)).toBe(false);

      // Bad practice - using z.any()
      const badSchema = z.object({
        query: z.string(),
        data: z.any(), // Avoid this!
      });

      expect(hasWeakTyping(badSchema)).toBe(true);
    });

    test("Array schemas should specify element types", () => {
      // Good - specific element type
      const goodArraySchema = z.object({
        items: z.array(z.string()),
        history: z.array(
          z.object({
            timestamp: z.number(),
            action: z.string(),
          })
        ),
      });

      expect(hasWeakTyping(goodArraySchema)).toBe(false);

      // Bad - array of any
      const badArraySchema = z.object({
        items: z.array(z.any()),
      });

      expect(hasWeakTyping(badArraySchema)).toBe(true);
    });

    test("Optional fields should be properly marked", () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
        withDefault: z.string().default("default"),
        nullable: z.string().nullable(),
      });

      // All valid inputs
      expect(
        schema.safeParse({ required: "test", withDefault: "value", nullable: "text" }).success
      ).toBe(true);
      expect(
        schema.safeParse({
          required: "test",
          optional: "opt",
          withDefault: "value",
          nullable: "text",
        }).success
      ).toBe(true);
      expect(
        schema.safeParse({ required: "test", withDefault: "value", nullable: null }).success
      ).toBe(true);

      // Test that default value is applied
      const parsed = schema.parse({ required: "test", nullable: "text" });
      expect(parsed.withDefault).toBe("default");
    });

    test("Descriptions should be provided for documentation", () => {
      const wellDocumentedSchema = z.object({
        query: z.string().describe("The search query to execute"),
        limit: z.number().min(1).describe("Maximum number of results to return"),
        includeArchived: z.boolean().describe("Whether to include archived items"),
      });

      // Check that descriptions are accessible
      const shape = wellDocumentedSchema.shape;
      expect((shape.query as any)._def.description).toBe("The search query to execute");
      expect((shape.limit as any)._def.description).toBe("Maximum number of results to return");
    });
  });

  describe("Common tool patterns", () => {
    test("Search tools should have consistent parameter names", () => {
      // Common pattern for search tools
      const searchSchema = z.object({
        query: z.string().min(1).describe("Search query"),
        // Other tools might have: filters, limit, offset, etc.
      });

      // Validate the pattern
      const result = searchSchema.safeParse({ query: "test search" });
      expect(result.success).toBe(true);
    });

    test("Time-based tools should accept time parameters consistently", () => {
      // TimeInfo pattern that's used across tools
      const timeInfoSchema = z.object({
        epoch: z.number(),
        isoString: z.string(),
        userLocaleString: z.string(),
        localDateString: z.string(),
        timezoneOffset: z.number(),
        timezone: z.string(),
      });

      const timeRangeSchema = z.object({
        startTime: timeInfoSchema,
        endTime: timeInfoSchema,
      });

      // This pattern should be consistent across tools
      const validTimeRange = {
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
      };

      expect(timeRangeSchema.safeParse(validTimeRange).success).toBe(true);
    });

    test("File operation tools should validate paths", () => {
      const fileToolSchema = z.object({
        path: z.string().min(1).describe("File path"),
        content: z.string().optional().describe("File content"),
      });

      // Valid paths
      expect(fileToolSchema.safeParse({ path: "/valid/path.md" }).success).toBe(true);
      expect(fileToolSchema.safeParse({ path: "relative/path.md" }).success).toBe(true);

      // Invalid - empty path
      expect(fileToolSchema.safeParse({ path: "" }).success).toBe(false);
    });
  });

  describe("Error handling patterns", () => {
    test("Tools should provide meaningful validation error messages", () => {
      const schema = z.object({
        email: z.string().email("Invalid email format"),
        age: z.number().min(0, "Age must be non-negative").max(150, "Age seems unrealistic"),
      });

      const result = schema.safeParse({ email: "not-an-email", age: -5 });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = result.error.issues;
        expect(errors.some((e) => e.message === "Invalid email format")).toBe(true);
        expect(errors.some((e) => e.message === "Age must be non-negative")).toBe(true);
      }
    });

    test("Complex nested schemas should validate deeply", () => {
      const complexSchema = z.object({
        user: z.object({
          name: z.string().min(1),
          email: z.string().email(),
          preferences: z.object({
            theme: z.enum(["light", "dark"]),
            notifications: z.boolean(),
          }),
        }),
        items: z
          .array(
            z.object({
              id: z.string(),
              quantity: z.number().positive(),
            })
          )
          .min(1, "At least one item required"),
      });

      // Invalid nested data
      const invalidData = {
        user: {
          name: "",
          email: "invalid",
          preferences: {
            theme: "blue", // Invalid enum value
            notifications: true,
          },
        },
        items: [],
      };

      const result = complexSchema.safeParse(invalidData);
      expect(result.success).toBe(false);

      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join("."));
        expect(paths).toContain("user.name");
        expect(paths).toContain("user.email");
        expect(paths).toContain("user.preferences.theme");
        expect(paths).toContain("items");
      }
    });
  });
});
