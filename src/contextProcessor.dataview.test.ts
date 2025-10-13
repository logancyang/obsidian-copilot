// Mock chainFactory before importing anything else to avoid import errors
jest.mock("@/chainFactory", () => ({
  ChainType: {
    LLM_CHAIN: "llm_chain",
    VAULT_QA_CHAIN: "vault_qa",
    COPILOT_PLUS_CHAIN: "copilot_plus",
    PROJECT_CHAIN: "project",
  },
}));

import { ContextProcessor } from "@/contextProcessor";
import { DATAVIEW_BLOCK_TAG } from "@/constants";

// Mock the global app object for Dataview plugin access
global.app = {
  plugins: {
    plugins: {},
  },
} as any;

describe("ContextProcessor - Dataview Integration", () => {
  let contextProcessor: ContextProcessor;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    contextProcessor = ContextProcessor.getInstance();
    // Reset plugins for each test
    (global.app as any).plugins.plugins = {};
    // Save and mock console.error to suppress expected error messages
    originalConsoleError = console.error;
    console.error = jest.fn();
  });

  afterEach(() => {
    // Restore original console.error
    console.error = originalConsoleError;
  });

  describe("processDataviewBlocks - Plugin Availability", () => {
    it("should return content unchanged when Dataview plugin is not installed", async () => {
      const content = "```dataview\nLIST\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");
      expect(result).toBe(content);
    });

    it("should return content unchanged when Dataview API is not available", async () => {
      (global.app as any).plugins.plugins.dataview = {};
      const content = "```dataview\nLIST\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");
      expect(result).toBe(content);
    });
  });

  describe("processDataviewBlocks - Regex Pattern Matching", () => {
    beforeEach(() => {
      // Mock successful Dataview plugin with API
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockResolvedValue({
            successful: true,
            value: {
              type: "list",
              values: [{ path: "note1.md" }, { path: "note2.md" }],
            },
          }),
        },
      };
    });

    it("should match dataview blocks with exact newline", async () => {
      const content = "```dataview\nLIST\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");
      expect(result).toContain(`<${DATAVIEW_BLOCK_TAG}>`);
      expect(result).toContain("<query_type>dataview</query_type>");
    });

    it("should match dataview blocks with trailing spaces", async () => {
      const content = "```dataview  \nLIST\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");
      expect(result).toContain(`<${DATAVIEW_BLOCK_TAG}>`);
      expect(result).toContain("<query_type>dataview</query_type>");
    });

    it("should match dataview blocks with tabs", async () => {
      const content = "```dataview\t\nLIST\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");
      expect(result).toContain(`<${DATAVIEW_BLOCK_TAG}>`);
      expect(result).toContain("<query_type>dataview</query_type>");
    });

    it("should match dataview blocks with Windows CRLF line endings", async () => {
      const content = "```dataview\r\nLIST\r\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");
      expect(result).toContain(`<${DATAVIEW_BLOCK_TAG}>`);
      expect(result).toContain("<query_type>dataview</query_type>");
    });

    it("should match dataviewjs blocks", async () => {
      const content = "```dataviewjs\ndv.list()\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");
      expect(result).toContain(`<${DATAVIEW_BLOCK_TAG}>`);
      expect(result).toContain("<query_type>dataviewjs</query_type>");
    });
  });

  describe("processDataviewBlocks - Multiple Blocks", () => {
    beforeEach(() => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest
            .fn()
            .mockResolvedValueOnce({
              successful: true,
              value: {
                type: "list",
                values: [{ path: "note1.md" }],
              },
            })
            .mockResolvedValueOnce({
              successful: true,
              value: {
                type: "list",
                values: [{ path: "note2.md" }],
              },
            }),
        },
      };
    });

    it("should process multiple different dataview blocks", async () => {
      const content = `
# First Query
\`\`\`dataview
LIST WHERE tag = "#project"
\`\`\`

# Second Query
\`\`\`dataview
TABLE file.name
\`\`\`
`;
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      // Should contain two dataview block tags
      const blockMatches = result.match(new RegExp(`<${DATAVIEW_BLOCK_TAG}>`, "g"));
      expect(blockMatches).toHaveLength(2);
    });

    it("should process multiple identical dataview blocks correctly", async () => {
      const content = `
# First Instance
\`\`\`dataview
LIST
\`\`\`

# Second Instance
\`\`\`dataview
LIST
\`\`\`
`;
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      // Should contain two dataview block tags
      const blockMatches = result.match(new RegExp(`<${DATAVIEW_BLOCK_TAG}>`, "g"));
      expect(blockMatches).toHaveLength(2);

      // Both should have different results (since mock returns different values)
      expect(result).toContain("[[note1.md]]");
      expect(result).toContain("[[note2.md]]");
    });
  });

  describe("processDataviewBlocks - Query Execution", () => {
    it("should include both original query and executed results", async () => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockResolvedValue({
            successful: true,
            value: {
              type: "list",
              values: [{ path: "note1.md" }],
            },
          }),
        },
      };

      const content = '```dataview\nLIST WHERE contains(tags, "#project")\n```';
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("<original_query>");
      expect(result).toContain('LIST WHERE contains(tags, "#project")');
      expect(result).toContain("<executed_result>");
      expect(result).toContain("[[note1.md]]");
    });

    it("should handle query timeout gracefully", async () => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockImplementation(
            () =>
              new Promise((resolve) => {
                // Never resolve to simulate timeout
                setTimeout(resolve, 10000);
              })
          ),
        },
      };

      const content = "```dataview\nLIST\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("<error>Query timeout</error>");
    }, 10000); // Increase test timeout to 10s

    it("should handle query execution errors", async () => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockResolvedValue({
            successful: false,
            error: "Invalid syntax",
          }),
        },
      };

      const content = "```dataview\nINVALID QUERY\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("<error>Invalid syntax</error>");
    });

    it("should handle dataviewjs with unsupported message", async () => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn(),
        },
      };

      const content = "```dataviewjs\ndv.pages()\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("DataviewJS execution not yet supported");
    });
  });

  describe("processDataviewBlocks - Result Formatting", () => {
    it("should format LIST results correctly", async () => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockResolvedValue({
            successful: true,
            value: {
              type: "list",
              values: [{ path: "note1.md" }, { path: "note2.md" }, { path: "note3.md" }],
            },
          }),
        },
      };

      const content = "```dataview\nLIST\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("- [[note1.md]]");
      expect(result).toContain("- [[note2.md]]");
      expect(result).toContain("- [[note3.md]]");
    });

    it("should format TABLE results correctly", async () => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockResolvedValue({
            successful: true,
            value: {
              type: "table",
              headers: ["File", "Size"],
              values: [
                [{ path: "note1.md" }, 100],
                [{ path: "note2.md" }, 200],
              ],
            },
          }),
        },
      };

      const content = "```dataview\nTABLE file.size\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("| File | Size |");
      expect(result).toContain("| --- | --- |");
      expect(result).toContain("| [[note1.md]] | 100 |");
      expect(result).toContain("| [[note2.md]] | 200 |");
    });

    it("should format TASK results correctly", async () => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockResolvedValue({
            successful: true,
            value: {
              type: "task",
              values: [
                { text: "Task 1", completed: false },
                { text: "Task 2", completed: true },
              ],
            },
          }),
        },
      };

      const content = "```dataview\nTASK\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("- [ ] Task 1");
      expect(result).toContain("- [x] Task 2");
    });

    it("should handle empty results", async () => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockResolvedValue({
            successful: true,
            value: {
              type: "list",
              values: [],
            },
          }),
        },
      };

      const content = "```dataview\nLIST WHERE false\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("<executed_result>\nNo results\n</executed_result>");
    });

    it("should handle null values gracefully", async () => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockResolvedValue({
            successful: true,
            value: {
              type: "list",
              values: [null, { path: "note1.md" }, undefined],
            },
          }),
        },
      };

      const content = "```dataview\nLIST\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      // Should skip null/undefined values
      expect(result).toContain("- ");
      expect(result).toContain("- [[note1.md]]");
    });

    it("should handle arrays in values", async () => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockResolvedValue({
            successful: true,
            value: {
              type: "list",
              values: [[{ path: "note1.md" }, { path: "note2.md" }]],
            },
          }),
        },
      };

      const content = "```dataview\nLIST\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("[[note1.md]], [[note2.md]]");
    });
  });

  describe("processDataviewBlocks - Edge Cases", () => {
    beforeEach(() => {
      (global.app as any).plugins.plugins.dataview = {
        api: {
          query: jest.fn().mockResolvedValue({
            successful: true,
            value: {
              type: "list",
              values: [],
            },
          }),
        },
      };
    });

    it("should not process non-dataview code blocks", async () => {
      const content = "```javascript\nconst x = 1;\n```";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");
      expect(result).toBe(content);
      expect(result).not.toContain(`<${DATAVIEW_BLOCK_TAG}>`);
    });

    it("should handle content with no dataview blocks", async () => {
      const content = "Just some regular markdown content.";
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");
      expect(result).toBe(content);
    });

    it("should preserve surrounding content", async () => {
      const content = `
# Before

Some text before

\`\`\`dataview
LIST
\`\`\`

Some text after

# After
`;
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("# Before");
      expect(result).toContain("Some text before");
      expect(result).toContain("Some text after");
      expect(result).toContain("# After");
      expect(result).toContain(`<${DATAVIEW_BLOCK_TAG}>`);
    });

    it("should handle multiline queries", async () => {
      const content = `\`\`\`dataview
LIST
WHERE contains(tags, "#project")
  AND file.mtime > date(today) - dur(7 days)
SORT file.mtime DESC
\`\`\``;
      const result = await contextProcessor.processDataviewBlocks(content, "test.md");

      expect(result).toContain("<original_query>");
      expect(result).toContain('WHERE contains(tags, "#project")');
      expect(result).toContain("AND file.mtime > date(today) - dur(7 days)");
      expect(result).toContain("SORT file.mtime DESC");
    });
  });
});
