import { z } from "zod";
import { CommonSchemas, createAsyncTool, createTool, extractParametersFromZod } from "./SimpleTool";

describe("SimpleTool Tests", () => {
  describe("createTool", () => {
    test("creates a basic tool with void schema", async () => {
      const tool = createTool({
        name: "testTool",
        description: "A test tool",
        schema: z.void(),
        handler: async () => "success",
      });

      expect(tool.name).toBe("testTool");
      expect(tool.description).toBe("A test tool");
      const result = await tool.call(undefined);
      expect(result).toBe("success");
    });

    test("creates a tool with object schema", async () => {
      const tool = createTool({
        name: "greetTool",
        description: "Greets a user",
        schema: z.object({
          name: z.string().describe("User's name"),
          age: z.number().optional().describe("User's age"),
        }),
        handler: async ({ name, age }) => `Hello ${name}, age: ${age ?? "unknown"}`,
      });

      const result = await tool.call({ name: "John", age: 30 });
      expect(result).toBe("Hello John, age: 30");
    });

    test("validates input parameters", async () => {
      const tool = createTool({
        name: "strictTool",
        description: "A tool with strict validation",
        schema: z.object({
          email: z.string().email(),
          count: z.number().min(1).max(10),
        }),
        handler: async ({ email, count }) => `${email}: ${count}`,
      });

      // Valid input
      const result = await tool.call({ email: "test@example.com", count: 5 });
      expect(result).toBe("test@example.com: 5");

      // Invalid email
      await expect(tool.call({ email: "invalid", count: 5 })).rejects.toThrow(
        "Tool strictTool validation failed"
      );

      // Count out of range
      await expect(tool.call({ email: "test@example.com", count: 15 })).rejects.toThrow(
        "Tool strictTool validation failed"
      );
    });

    test("handles empty object for void schema", async () => {
      const tool = createTool({
        name: "voidTool",
        description: "A tool expecting no parameters",
        schema: z.void(),
        handler: async () => "no params needed",
      });

      // Should handle empty object gracefully
      const result = await tool.call({} as any);
      expect(result).toBe("no params needed");

      // Should also handle undefined
      const result2 = await tool.call(undefined);
      expect(result2).toBe("no params needed");
    });

    test("includes optional properties", async () => {
      const tool = createTool({
        name: "metaTool",
        description: "A tool with metadata",
        schema: z.void(),
        handler: async () => "done",
        timeoutMs: 5000,
        isBackground: true,
        version: "1.0.0",
        deprecated: false,
        metadata: { category: "utility" },
      });

      expect(tool.timeoutMs).toBe(5000);
      expect(tool.isBackground).toBe(true);
      expect(tool.version).toBe("1.0.0");
      expect(tool.deprecated).toBe(false);
      expect(tool.metadata).toEqual({ category: "utility" });
    });

    test("formats Zod validation errors properly", async () => {
      const tool = createTool({
        name: "complexTool",
        description: "A tool with complex validation",
        schema: z.object({
          user: z.object({
            name: z.string().min(2),
            email: z.string().email(),
          }),
          items: z.array(z.string()).min(1),
        }),
        handler: async () => "success",
      });

      try {
        await tool.call({
          user: { name: "J", email: "invalid" },
          items: [],
        });
        fail("Should have thrown validation error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain("Tool complexTool validation failed");
        expect(message).toContain("user.name:");
        expect(message).toContain("user.email:");
        expect(message).toContain("items:");
      }
    });

    test("propagates handler errors", async () => {
      const tool = createTool({
        name: "errorTool",
        description: "A tool that throws errors",
        schema: z.object({ shouldFail: z.boolean() }),
        handler: async ({ shouldFail }) => {
          if (shouldFail) {
            throw new Error("Handler failed as requested");
          }
          return "success";
        },
      });

      const result = await tool.call({ shouldFail: false });
      expect(result).toBe("success");

      await expect(tool.call({ shouldFail: true })).rejects.toThrow("Handler failed as requested");
    });
  });

  describe("CommonSchemas", () => {
    test("provides common schema helpers", () => {
      expect(CommonSchemas.emptyParams).toBeInstanceOf(z.ZodVoid);

      const stringSchema = CommonSchemas.stringParam("Test string");
      expect(stringSchema).toBeInstanceOf(z.ZodString);
      expect(stringSchema._def.description).toBe("Test string");

      const numberSchema = CommonSchemas.numberParam("Test number");
      expect(numberSchema).toBeInstanceOf(z.ZodNumber);

      const urlSchema = CommonSchemas.url("Website URL");
      expect(urlSchema).toBeInstanceOf(z.ZodString);

      // Test URL validation
      expect(() => urlSchema.parse("https://example.com")).not.toThrow();
      expect(() => urlSchema.parse("not-a-url")).toThrow();
    });

    test("optional string schema works correctly", () => {
      const schema = CommonSchemas.optionalString("Optional field");
      expect(schema.parse(undefined)).toBeUndefined();
      expect(schema.parse("value")).toBe("value");
    });

    test("non-empty string schema validates minimum length", () => {
      const schema = CommonSchemas.nonEmptyString("Required field");
      expect(() => schema.parse("")).toThrow();
      expect(schema.parse("value")).toBe("value");
    });
  });

  describe("extractParametersFromZod", () => {
    test("extracts parameters from object schema", () => {
      const schema = z.object({
        name: z.string().describe("User's name"),
        age: z.number().describe("User's age"),
        email: z.string().email(),
      });

      const params = extractParametersFromZod(schema);
      expect(params).toEqual({
        name: "User's name",
        age: "User's age",
        email: "No description",
      });
    });

    test("returns empty object for void schema", () => {
      const params = extractParametersFromZod(z.void());
      expect(params).toEqual({});
    });

    test("handles optional fields", () => {
      const schema = z.object({
        required: z.string().describe("Required field"),
        // Note: For optional/nullable/default wrappers, descriptions need to be on the inner type
        optional: z.string().describe("Optional field").optional(),
        nullable: z.string().describe("Nullable field").nullable(),
        withDefault: z.string().describe("Field with default").default("default"),
      });

      const params = extractParametersFromZod(schema);
      expect(params).toEqual({
        required: "Required field",
        optional: "Optional field",
        nullable: "Nullable field",
        withDefault: "Field with default",
      });
    });

    test("handles union schemas", () => {
      const schema = z.union([
        z.object({ type: z.literal("a"), value: z.string() }),
        z.object({ type: z.literal("b"), value: z.number() }),
      ]);

      const params = extractParametersFromZod(schema);
      expect(params).toEqual({
        _union: "Multiple parameter formats supported",
      });
    });
  });

  describe("createAsyncTool", () => {
    test("creates tool with async validation", async () => {
      let validationCalled = false;

      const tool = createAsyncTool({
        name: "asyncTool",
        description: "Tool with async validation",
        schema: z.object({
          path: z.string(),
        }),
        asyncValidator: async ({ path }) => {
          validationCalled = true;
          if (!path.startsWith("/valid/")) {
            throw new Error("Invalid path");
          }
        },
        handler: async ({ path }) => `Path ${path} is valid`,
      });

      // Valid path
      const result = await tool.call({ path: "/valid/file.txt" });
      expect(result).toBe("Path /valid/file.txt is valid");
      expect(validationCalled).toBe(true);

      // Invalid path
      validationCalled = false;
      await expect(tool.call({ path: "/invalid/file.txt" })).rejects.toThrow("Invalid path");
      expect(validationCalled).toBe(true);
    });

    test("works without async validator", async () => {
      const tool = createAsyncTool({
        name: "simpleTool",
        description: "Tool without async validation",
        schema: z.object({ value: z.string() }),
        handler: async ({ value }) => value.toUpperCase(),
      });

      const result = await tool.call({ value: "hello" });
      expect(result).toBe("HELLO");
    });
  });

  describe("TypeScript type inference", () => {
    test("infers correct types for tool handlers", async () => {
      // This test mainly ensures TypeScript compilation works correctly
      const tool = createTool({
        name: "typedTool",
        description: "A tool with typed parameters",
        schema: z.object({
          stringField: z.string(),
          numberField: z.number(),
          booleanField: z.boolean(),
          arrayField: z.array(z.string()),
          optionalField: z.string().optional(),
        }),
        handler: async (args) => {
          // TypeScript should infer the correct types here
          const upperString: string = args.stringField.toUpperCase();
          const doubled: number = args.numberField * 2;
          const negated: boolean = !args.booleanField;
          const joined: string = args.arrayField.join(",");
          const optional: string | undefined = args.optionalField;

          return {
            upperString,
            doubled,
            negated,
            joined,
            optional,
          };
        },
      });

      const result = await tool.call({
        stringField: "hello",
        numberField: 5,
        booleanField: true,
        arrayField: ["a", "b", "c"],
      });

      expect(result).toEqual({
        upperString: "HELLO",
        doubled: 10,
        negated: false,
        joined: "a,b,c",
        optional: undefined,
      });
    });
  });
});
