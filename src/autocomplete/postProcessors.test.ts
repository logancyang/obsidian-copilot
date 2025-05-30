import {
  AutocompletePostProcessor,
  GeneralWhitespaceCleaner,
  PostProcessContext,
  RemoveCodeIndicators,
  RemoveOverlapProcessor,
} from "./postProcessors";

describe("RemoveOverlapProcessor", () => {
  const processor = new RemoveOverlapProcessor();

  // Helper function to create context
  const createContext = (
    prefix: string,
    suffix: string,
    completion: string,
    context?: string
  ): PostProcessContext => ({
    prefix,
    suffix,
    completion,
    context,
  });

  describe("List marker overlap tests", () => {
    test("Removes duplicate unordered list marker `-`", () => {
      const ctx = createContext("- ", "", "- Item 1");
      expect(processor.process(ctx)).toBe("Item 1");
    });

    test("Removes duplicate unordered list marker `*`", () => {
      const ctx = createContext("* ", "", "* Item 2");
      expect(processor.process(ctx)).toBe("Item 2");
    });

    test("Removes duplicate numbered list marker", () => {
      const ctx = createContext("1. ", "", "1. Step 1");
      expect(processor.process(ctx)).toBe("Step 1");
    });

    test("Handles list marker with newline prefix", () => {
      const ctx = createContext("\n- ", "", "- Item 3");
      expect(processor.process(ctx)).toBe("Item 3");
    });
  });

  describe("Whitespace overlap tests", () => {
    test("Removes whitespace overlap between prefix and completion", () => {
      const ctx = createContext("Hello ", "", " World");
      expect(processor.process(ctx)).toBe("World");
    });

    test("Preserves whitespace when no overlap", () => {
      const ctx = createContext("Hello", "", " World");
      expect(processor.process(ctx)).toBe(" World");
    });

    test("Handles tab characters in overlap", () => {
      const ctx = createContext("-\t", "", "-\tItem 1");
      expect(processor.process(ctx)).toBe("Item 1");
    });
  });

  describe("Word-level overlap tests", () => {
    test("Handles word overlap with prefix", () => {
      const ctx = createContext("This is a ", "", "a complete sentence.");
      expect(processor.process(ctx)).toBe("complete sentence.");
    });

    test("Handles word overlap with suffix", () => {
      const ctx = createContext("", "sentence continuation.", "This is a sentence ");
      expect(processor.process(ctx)).toBe("This is a ");
    });

    test("Handles multi-word overlap with prefix", () => {
      const ctx = createContext("Starting with some context. ", "", "context. Now continuing...");
      expect(processor.process(ctx)).toBe("Now continuing...");
    });
  });

  describe("Character-level marker overlap tests", () => {
    test("Handles special marker overlap", () => {
      const ctx = createContext("> ", "", "> Blockquote");
      expect(processor.process(ctx)).toBe("Blockquote");
    });

    test("Handles combined markers", () => {
      const ctx = createContext("- [ ] ", "", "- [ ] Task item");
      expect(processor.process(ctx)).toBe("Task item");
    });
  });

  // Additional tests for complex scenarios
  describe("Complex pattern recognition", () => {
    test("Recognizes segment boundaries in text with markers", () => {
      const ctx = createContext("## Heading ", "", "## Heading content");
      expect(processor.process(ctx)).toBe("content");
    });

    test("Handles mixed markers and words", () => {
      const ctx = createContext("#tag1 #tag2 ", "", "#tag2 #tag3");
      expect(processor.process(ctx)).toBe("#tag3");
    });

    test("Properly handles consecutive markers", () => {
      const ctx = createContext("-->", "", "--> Arrow");
      expect(processor.process(ctx)).toBe("Arrow");
    });
  });
});

describe("GeneralWhitespaceCleaner", () => {
  const cleaner = new GeneralWhitespaceCleaner();

  test("Trims leading space when prefix ends with space", () => {
    const ctx: PostProcessContext = {
      prefix: "Hello ",
      suffix: "",
      completion: " world",
    };
    expect(cleaner.process(ctx)).toBe("world");
  });

  test("Trims trailing space when suffix starts with space", () => {
    const ctx: PostProcessContext = {
      prefix: "",
      suffix: " continues",
      completion: "Text ",
    };
    expect(cleaner.process(ctx)).toBe("Text");
  });

  test("Handles newline overlap in list context", () => {
    const ctx: PostProcessContext = {
      prefix: "List:\n",
      suffix: "",
      completion: "\n- Item",
      context: "UnorderedList",
    };
    expect(cleaner.process(ctx)).toBe("- Item");
  });

  test("Does not trim spaces when no overlap", () => {
    const ctx: PostProcessContext = {
      prefix: "No overlap",
      suffix: "here",
      completion: " in between ",
    };
    expect(cleaner.process(ctx)).toBe(" in between ");
  });
});

describe("RemoveCodeIndicators", () => {
  const codeProcessor = new RemoveCodeIndicators();

  test("Removes code block markers in CodeBlock context", () => {
    const ctx: PostProcessContext = {
      prefix: "```python\ndef ",
      suffix: "",
      completion: "function():\n    return 42\n```",
      context: "CodeBlock",
    };
    expect(codeProcessor.process(ctx)).toBe("function():\n    return 42");
  });

  test("Removes language specifier", () => {
    const ctx: PostProcessContext = {
      prefix: "",
      suffix: "",
      completion: "```javascript\nconst x = 5;\n```",
      context: "CodeBlock",
    };
    expect(codeProcessor.process(ctx)).toBe("const x = 5;");
  });

  test("Does not modify completion when not in CodeBlock context", () => {
    const ctx: PostProcessContext = {
      prefix: "",
      suffix: "",
      completion: "```javascript\nconst x = 5;\n```",
      context: "UnorderedList",
    };
    expect(codeProcessor.process(ctx)).toBe("```javascript\nconst x = 5;\n```");
  });
});

describe("AutocompletePostProcessor", () => {
  const postProcessor = new AutocompletePostProcessor();

  test("Processes list marker overlap correctly", () => {
    const result = postProcessor.process("- ", "", "- Next item", "UnorderedList");
    expect(result).toBe("Next item");
  });

  test("Processes code blocks correctly", () => {
    const result = postProcessor.process("```js\n", "", "```js\nconst x = 5;\n```", "CodeBlock");
    expect(result).toBe("const x = 5;");
  });

  test("Handles whitespace and overlap combination", () => {
    const result = postProcessor.process(
      "Text with trailing space ",
      " and continuation",
      " overlapping text "
    );
    expect(result).toBe("overlapping text");
  });

  test("Complex case: List with markers and whitespace", () => {
    const result = postProcessor.process(
      "- First item\n- ",
      "",
      "- Second item with **formatting**",
      "UnorderedList"
    );
    expect(result).toBe("Second item with **formatting**");
  });

  test("Preserves completion when no processing needed", () => {
    const result = postProcessor.process("No overlap here. ", "", "This is new text.");
    expect(result).toBe("This is new text.");
  });

  describe("Edge cases", () => {
    test("Handles empty input", () => {
      const result = postProcessor.process("", "", "", undefined);
      expect(result).toBe("");
    });

    test("Handles null/undefined context", () => {
      const result = postProcessor.process("Some text", "", "completion", undefined);
      expect(result).toBe("completion");
    });

    test("Handles multi-line completions", () => {
      const result = postProcessor.process("Paragraph 1\n\n", "", "Paragraph 2\n\nParagraph 3");
      expect(result).toBe("Paragraph 2\n\nParagraph 3");
    });

    test("Handles emoji and special characters", () => {
      const result = postProcessor.process("Special 👍 ", "", "👍 characters 🚀");
      expect(result).toBe("characters 🚀");
    });
  });

  describe("Integration tests", () => {
    test("Processes multiple overlaps correctly", () => {
      // This test checks that all processors work together
      const result = postProcessor.process(
        "```js\n- ",
        "",
        "- ```js\nconst x = 5;\n```",
        "CodeBlock"
      );
      expect(result).toBe("const x = 5;");
    });

    test("Handles nested contexts correctly", () => {
      const result = postProcessor.process(
        "- List item with `code\n  ",
        "",
        "  continuation of code`",
        "UnorderedList"
      );
      expect(result).toBe("continuation of code`");
    });

    test("Real-world scenario: List items with formatting", () => {
      const result = postProcessor.process(
        "# Notes\n\n- First point\n- ",
        "",
        "- Second point with **bold** and *italic*",
        "UnorderedList"
      );
      expect(result).toBe("Second point with **bold** and *italic*");
    });

    test("Real-world scenario: Code with indentation", () => {
      const result = postProcessor.process(
        "```typescript\nfunction example() {\n  ",
        "\n}",
        "  const value = 42;\n  return value;",
        "CodeBlock"
      );
      expect(result).toBe("const value = 42;\n  return value;");
    });
  });
});
