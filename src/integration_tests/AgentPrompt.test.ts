/**
 * LEGACY TEST FILE - SKIPPED
 *
 * This integration test was designed to test XML-based tool calling flow.
 * The codebase has migrated to native LangChain tool calling via bindTools().
 *
 * XML tool parsing functions (parseXMLToolCalls, stripToolCallXML) have been removed
 * as part of the native tool calling migration (Phase 4).
 *
 * Native tool calling is tested via:
 * - Unit tests in the respective chain runner files
 * - Manual testing with various LLM providers
 *
 * TODO: Consider creating new integration tests for native tool calling flow
 */

// Skip entire file - legacy XML-based test
describe.skip("AgentPrompt Integration Tests (Legacy XML Flow)", () => {
  it("skipped - see file header comment", () => {});
});

/* Original test code preserved for reference:

// Mock obsidian Modal before any other imports
jest.mock("obsidian", () => ({
  Modal: class Modal {
    constructor() {
      (this as any).open = jest.fn();
      (this as any).close = jest.fn();
      (this as any).onOpen = jest.fn();
      (this as any).onClose = jest.fn();
    }
  },
  App: jest.fn().mockImplementation(() => ({
    workspace: {
      getActiveFile: jest.fn(),
    },
    vault: {
      read: jest.fn(),
    },
  })),
  Notice: jest.fn().mockImplementation(function (message) {
    this.message = message;
    this.noticeEl = document.createElement("div");
    this.hide = jest.fn();
  }),
  Platform: {
    isDesktop: true,
  },
}));

// Mock the specific modal that's causing issues
jest.mock("@/components/modals/CopilotPlusExpiredModal", () => ({
  CopilotPlusExpiredModal: class CopilotPlusExpiredModal {
    constructor() {
      (this as any).open = jest.fn();
      (this as any).close = jest.fn();
      (this as any).onOpen = jest.fn();
      (this as any).onClose = jest.fn();
    }
  },
}));

// Mock @orama/orama to avoid ES module issues
jest.mock("@orama/orama", () => ({
  create: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
  removeMultiple: jest.fn(),
  search: jest.fn(),
}));

import { AutonomousAgentChainRunner } from "@/LLMProviders/chainRunner";
import { jest } from "@jest/globals";
import * as dotenv from "dotenv";

// Add global fetch polyfill for Node.js environments
import fetch, { Headers, Request, Response } from "node-fetch";
if (!globalThis.fetch) {
  globalThis.fetch = fetch as any;
  globalThis.Headers = Headers as any;
  globalThis.Request = Request as any;
  globalThis.Response = Response as any;
}

// Add TextDecoderStream polyfill for Node.js environments
import "web-streams-polyfill/dist/polyfill.js";

// Load environment variables from .env.test
dotenv.config({ path: ".env.test" });

// Add contains method to Array prototype for compatibility
Array.prototype.contains = Array.prototype.includes;

// Increase test timeout to 120 seconds for real LLM calls
jest.setTimeout(120000);

// Mock only the essential dependencies
jest.mock("@/chainFactory", () => ({
  ChainType: {
    LLM_CHAIN: "llm_chain",
    VAULT_QA_CHAIN: "vault_qa",
    COPILOT_PLUS_CHAIN: "copilot_plus",
    PROJECT_CHAIN: "project",
  },
  default: jest.fn().mockImplementation(() => ({
    instances: new Map(),
  })),
}));

// Mock Obsidian - essential for tool initialization
jest.mock("obsidian", () => ({
  App: jest.fn(),
  Vault: jest.fn(),
  TFile: jest.fn(),
  TFolder: jest.fn(),
  Notice: jest.fn(),
  Plugin: jest.fn(),
  Platform: { isMobile: false },
  ItemView: class ItemView {
    constructor() {}
    getViewType() {
      return "mock-view";
    }
    getDisplayText() {
      return "Mock View";
    }
    onload() {}
    onunload() {}
  },
  WorkspaceLeaf: jest.fn(),
  Component: jest.fn(),
  Editor: jest.fn(),
  MarkdownView: jest.fn(),
  Menu: jest.fn(),
  requestUrl: jest.fn(),
}));

// Interface definitions for test cases
interface ExpectedToolCall {
  toolName: string;
  argumentValidator?: (args: any) => void;
  mockedReturnValue: any;
}

interface ToolFlowTestCase {
  description: string;
  prompt: string;
  expectedCalls: ExpectedToolCall[];
  finalOutputValidator?: (output: string) => void;
}

// Helper function to generate system prompt (mimic AutonomousAgentChainRunner)
async function generateSystemPrompt(availableTools: any[]): Promise<string> {
  // Use the same logic as ModelAdapter
  const { ModelAdapterFactory } = await import("@/LLMProviders/chainRunner/utils/modelAdapter");

  // Create a mock Gemini model to get the adapter
  const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
  const mockModel = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash-lite",
    apiKey: process.env.GEMINI_API_KEY || "",
  });

  const adapter = ModelAdapterFactory.createAdapter(mockModel);
  return AutonomousAgentChainRunner.generateSystemPrompt(availableTools, adapter, undefined);
}

// Helper function to mock tool execution
function mockToolExecution(toolCall: any, expectedCalls: ExpectedToolCall[]): string {
  const expectedCall = expectedCalls.find((call) => call.toolName === toolCall.name);

  if (!expectedCall) {
    // This will be caught and handled by the main validation logic
    // We still return a mock result to allow the test to continue
    console.warn(`⚠️ Unexpected tool call: ${toolCall.name} - will be validated later`);
    return `Mock result for unexpected tool: ${toolCall.name}`;
  }

  // Validate arguments if validator provided
  if (expectedCall.argumentValidator) {
    expectedCall.argumentValidator(toolCall.args);
  }

  // Return mocked result
  if (typeof expectedCall.mockedReturnValue === "object") {
    return JSON.stringify(expectedCall.mockedReturnValue);
  }
  return expectedCall.mockedReturnValue;
}

describe("Agent Prompt Integration Test - Direct Model Testing", () => {
  let realGeminiModel: any;
  let availableTools: any[] = [];

  beforeAll(async () => {
    // Skip tests if no API key is available
    if (!process.env.GEMINI_API_KEY) {
      console.log("Skipping Agent Prompt tests - GEMINI_API_KEY not found");
      return;
    }

    console.log("🚀 Starting Agent Prompt tests with real Gemini 2.5 Flash");

    try {
      // Import the necessary classes
      const { ToolRegistry } = await import("@/tools/ToolRegistry");
      const { initializeBuiltinTools } = await import("@/tools/builtinTools");
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");

      // Create mock app with vault
      const mockApp = {
        vault: {
          adapter: {
            exists: jest.fn(),
            read: jest.fn(),
            write: jest.fn(),
            remove: jest.fn(),
            mkdir: jest.fn(),
            list: jest.fn(),
          },
          getAllLoadedFiles: jest.fn().mockReturnValue([]),
          getFiles: jest.fn().mockReturnValue([]),
          getFolderByPath: jest.fn().mockReturnValue(null),
          getFileByPath: jest.fn().mockReturnValue(null),
          create: jest.fn(),
          modify: jest.fn(),
          delete: jest.fn(),
          getRoot: jest.fn().mockReturnValue({ path: "/" }),
        },
        workspace: {
          getActiveFile: jest.fn().mockReturnValue(null),
        },
        metadataCache: {
          getCache: jest.fn().mockReturnValue(null),
          getFileCache: jest.fn().mockReturnValue(null),
        },
      };

      // Create a real Gemini model instance for the test
      realGeminiModel = new ChatGoogleGenerativeAI({
        model: "gemini-2.5-flash",
        apiKey: process.env.GEMINI_API_KEY || "",
        temperature: 0.1,
        maxOutputTokens: 4000,
      });

      // Initialize built-in tools with all tools available
      const registry = ToolRegistry.getInstance();
      registry.clear(); // Clear any existing tools
      initializeBuiltinTools(mockApp.vault as any);

      // Get available tools and filter to enabled ones
      const { getSettings } = await import("@/settings/model");
      const settings = getSettings();
      const enabledToolIds = new Set(settings.autonomousAgentEnabledToolIds || []) as Set<string>;
      availableTools = registry.getEnabledTools(enabledToolIds, !!mockApp.vault);
    } catch (error) {
      console.error("❌ Error during Agent Prompt test setup:", error);
      throw error;
    }
  });

  // Test case data
  const testCases: ToolFlowTestCase[] = [
    {
      description: "should generate proper tool calls for time query",
      prompt: "What time is it right now in Tokyo?",
      expectedCalls: [
        {
          toolName: "getCurrentTime",
          argumentValidator: (args) => {
            expect(args).toEqual(
              expect.objectContaining({
                timezoneOffset: "+9",
              })
            );
          },
          mockedReturnValue: {
            epoch: Date.now(),
            isoString: new Date().toISOString(),
            userLocaleString: "Current time in JST (Tokyo)",
            localDateString: new Date().toLocaleDateString(),
            timezoneOffset: 540, // JST is UTC+9 (540 minutes)
            timezone: "JST",
          },
        },
      ],
      finalOutputValidator: (output) => {
        expect(output).toBeTruthy();
        expect(output.length).toBeGreaterThan(10);

        const outputLower = output.toLowerCase();
        const hasTimeContent =
          outputLower.includes("time") ||
          outputLower.includes("tokyo") ||
          outputLower.includes("jst") ||
          outputLower.includes("hour") ||
          outputLower.includes("minute") ||
          /\d{1,2}:\d{2}/.test(output);

        expect(hasTimeContent).toBe(true);
      },
    },
    {
      description: "should generate proper tool calls for replacing text in a file",
      prompt: `Extend the description for London.

      <active_note>
      <title>test.md</title>
      <content>
      New York City, USA - The city that never sleeps, New York buzzes with energy, towering skyscrapers, cultural diversity, and endless ambition. From Broadway to Wall Street, it’s a global symbol of dreams and hustle.

      Tokyo, Japan - A dazzling blend of futuristic tech and centuries-old tradition, Tokyo moves fast yet bows deep. Neon lights, tranquil shrines, and sushi perfection coexist in this mesmerizing metropolis.

      Paris, France - Romantic and refined, Paris is a living museum of art, fashion, and gastronomy. Every street corner whispers history, and every café terrace invites you to linger.

      London, UK - A city of kings and punks, rain and rebellion. London blends royal heritage with cutting-edge creativity, from the Tower of London to Shoreditch street art.
      </content>
      </active_note>
      `,
      expectedCalls: [
        {
          toolName: "replaceInFile",
          // Check if args.diff contains the correct search text
          argumentValidator: (args) => {
            expect(args.path).toBe("test.md");
            expect(args.diff).toContain(
              `------- SEARCH\nLondon, UK - A city of kings and punks, rain and rebellion. London blends royal heritage with cutting-edge creativity, from the Tower of London to Shoreditch street art.\n=======`
            );
          },
          mockedReturnValue: "File updated successfully",
        },
      ],
      finalOutputValidator: (output) => {},
    },
    {
      description: "should generate proper tool calls for creating a new note",
      prompt: `Create a new note about London based on info from the active note.

      <active_note>
      <title>test.md</title>
      <content>
      New York City, USA - The city that never sleeps, New York buzzes with energy, towering skyscrapers, cultural diversity, and endless ambition. From Broadway to Wall Street, it’s a global symbol of dreams and hustle.

      Tokyo, Japan - A dazzling blend of futuristic tech and centuries-old tradition, Tokyo moves fast yet bows deep. Neon lights, tranquil shrines, and sushi perfection coexist in this mesmerizing metropolis.

      Paris, France - Romantic and refined, Paris is a living museum of art, fashion, and gastronomy. Every street corner whispers history, and every café terrace invites you to linger.

      London, UK - A city of kings and punks, rain and rebellion. London blends royal heritage with cutting-edge creativity, from the Tower of London to Shoreditch street art.
      </content>
      </active_note>
      `,
      expectedCalls: [
        {
          toolName: "writeToFile",
          argumentValidator: (args) => {
            expect(args).toBeDefined();
          },
          mockedReturnValue: "File updated successfully",
        },
      ],
    },
    {
      description: "should generate proper tool calls for youtube transcription",
      prompt: `Summarize https://www.youtube.com/watch?v=ZvqnkRd1iyw&list=RDZvqnkRd1iyw&start_radio=1
      `,
      expectedCalls: [
        {
          toolName: "youtubeTranscription",
          mockedReturnValue: "This is the transcript of the video",
        },
      ],
    },
    {
      description: "should generate proper tool calls for local search with relative time",
      prompt: `Recap my last week
      `,
      expectedCalls: [
        {
          toolName: "getTimeRangeMs",
          argumentValidator: (args) => {
            expect(args).toEqual(
              expect.objectContaining({
                timeExpression: "last week",
              })
            );
          },
          mockedReturnValue: {
            // A fixed time range 2025-07-28 to 2025-08-04
            startTime: new Date("2025-07-28").getTime(),
            endTime: new Date("2025-08-04").getTime(),
          },
        },
        {
          toolName: "localSearch",
          argumentValidator: (args) => {
            expect(args).toEqual(
              expect.objectContaining({
                timeRange: {
                  startTime: new Date("2025-07-28").getTime(),
                  endTime: new Date("2025-08-04").getTime(),
                },
              })
            );
          },
          mockedReturnValue: "I went for shopping!",
        },
      ],
    },
    {
      description: "should generate proper tool calls for time query",
      prompt: "What time is it right now?",
      expectedCalls: [
        {
          toolName: "getCurrentTime",
          argumentValidator: (args) => {
            expect(args).toBeDefined();
          },
          mockedReturnValue: {
            epoch: Date.now(),
            isoString: new Date().toISOString(),
            userLocaleString: "Current time in UTC",
            localDateString: new Date().toLocaleDateString(),
            timezoneOffset: 0, // UTC is UTC+0 (0 minutes)
            timezone: "UTC",
          },
        },
      ],
      finalOutputValidator: (output) => {
        expect(output).toBeTruthy();
        expect(output.length).toBeGreaterThan(10);

        const outputLower = output.toLowerCase();
        const hasTimeContent =
          outputLower.includes("time") ||
          outputLower.includes("tokyo") ||
          outputLower.includes("jst") ||
          outputLower.includes("hour") ||
          outputLower.includes("minute") ||
          /\d{1,2}:\d{2}/.test(output);

        expect(hasTimeContent).toBe(true);
        console.log(
          `📄 Final output from real Gemini 2.5 Flash (${output.length} chars): ${output.substring(0, 300)}...`
        );
      },
    },
    {
      description: "should call getFileTree for note creation prompt",
      prompt:
        "Create a new note in myrealpage meetings folder about a meeting i just had with an agent named Mark. Include the details that Mark is switching to eXP. Make edits and create a notion task. And then use the quick note template for the template frontmatteer of that note.",
      expectedCalls: [
        {
          toolName: "getFileTree",
          mockedReturnValue: "File tree structure",
        },
      ],
      finalOutputValidator: (output) => {
        // This test only verifies that getFileTree is called, not the exact sequence
        // The main validation logic will check that getFileTree is in the actual calls
        expect(output).toBeTruthy();
      },
    },
    {
      description: "should handle basic queries without tool requirements",
      prompt: "Hello! Can you tell me a fun fact about programming?",
      expectedCalls: [], // No specific tools expected for this simple query
      finalOutputValidator: (output) => {
        expect(output).toBeTruthy();
        expect(output.length).toBeGreaterThan(10);
        console.log(
          `📄 Simple query response from Gemini 2.5 Flash (${output.length} chars): ${output.substring(0, 200)}...`
        );
      },
    },
  ];

  // Skip all tests if no API key - use conditional execution
  const shouldSkip = !process.env.GEMINI_API_KEY;

  test.each(testCases)("$description", async (testCase: ToolFlowTestCase) => {
    if (shouldSkip) {
      console.log("Skipping test - no API key");
      return;
    }

    try {
      console.log("Testing with prompt: ", testCase.prompt);
      // Generate the system prompt that would be used by AutonomousAgentChainRunner
      const systemPrompt = await generateSystemPrompt(availableTools);

      // Create conversation messages
      const conversationMessages = [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: testCase.prompt,
        },
      ];

      // Mimic the autonomous agent loop
      const maxIterations = 3;
      let iteration = 0;
      let finalResponse = "";
      const iterationHistory: string[] = [];
      const actualToolCalls: any[] = []; // Track all actual tool calls across iterations

      while (iteration < maxIterations) {
        iteration++;

        // Call the real Gemini model
        const response = await realGeminiModel.invoke(conversationMessages);

        // Ensure fullResponse is always a string (handle multimodal/array content)
        const fullResponse = (() => {
          const content = response.content || response.text || "";
          if (typeof content === "string") {
            return content;
          }
          if (Array.isArray(content)) {
            // For multimodal content, extract text parts
            return content.map((part: any) => part.text || JSON.stringify(part)).join(" ");
          }
          return JSON.stringify(content);
        })();

        console.log(
          `📤 Model response (${fullResponse.length} chars): ${fullResponse.substring(0, 300)}...`
        );

        // Parse tool calls from the response using the same logic as AutonomousAgentChainRunner
        const { parseXMLToolCalls, stripToolCallXML } = await import(
          "@/LLMProviders/chainRunner/utils/xmlParsing"
        );
        const toolCalls = parseXMLToolCalls(fullResponse);

        if (toolCalls.length === 0) {
          // No tool calls, this is the final response
          const cleanedResponse = stripToolCallXML(fullResponse);
          finalResponse = [...iterationHistory, cleanedResponse].join("\n\n");
          console.log(`✅ Final response without tool calls (iteration ${iteration})`);
          break;
        }

        // Process tool calls and mock their execution
        const toolResults: string[] = [];
        for (const toolCall of toolCalls) {
          console.log(`🔧 Processing tool call: ${toolCall.name} with args:`, toolCall.args);

          // Track this tool call
          actualToolCalls.push(toolCall);

          // Mock tool execution
          const result = mockToolExecution(toolCall, testCase.expectedCalls);
          toolResults.push(`Tool ${toolCall.name} result: ${result}`);

          console.log(
            `✅ Tool ${toolCall.name} executed with result: ${result.substring(0, 200)}...`
          );
        }

        // Add this iteration to history
        const cleanedResponse = stripToolCallXML(fullResponse);
        if (cleanedResponse.trim()) {
          iterationHistory.push(cleanedResponse);
        }

        // Add AI response to conversation for next iteration
        conversationMessages.push({
          role: "assistant",
          content: fullResponse,
        });

        // Add tool results as user messages for next iteration
        const toolResultsString = toolResults.join("\n");
        conversationMessages.push({
          role: "user",
          content: toolResultsString,
        });
      }

      // If we hit max iterations without a final response
      if (!finalResponse && iterationHistory.length > 0) {
        finalResponse =
          iterationHistory.join("\n\n") +
          `\n\nI've reached the maximum number of iterations (${maxIterations}) for this task.`;
      }

      console.log(
        `📄 Final response (${finalResponse.length} chars): ${finalResponse.substring(0, 500)}...`
      );

      // Special handling for getFileTree test - only check if it's called
      if (testCase.description.includes("getFileTree")) {
        const actualToolNames = actualToolCalls.map((call) => call.name);
        const hasGetFileTree = actualToolNames.includes("getFileTree");

        if (!hasGetFileTree) {
          const errorMsg = `Expected getFileTree to be called but it wasn't. Actual calls: [${actualToolNames.join(", ")}]`;
          console.error(`❌ ${errorMsg}`);
          throw new Error(errorMsg);
        }

        console.log(
          `✅ getFileTree was called as expected. All tool calls: [${actualToolNames.join(", ")}]`
        );
      } else {
        // Standard validation for other tests
        const expectedToolNames = testCase.expectedCalls.map((call) => call.toolName);
        const actualToolNames = actualToolCalls.map((call) => call.name);

        // Check if the number of calls match
        if (actualToolCalls.length !== testCase.expectedCalls.length) {
          const errorMsg = `Expected ${testCase.expectedCalls.length} tool calls but got ${actualToolCalls.length}. Expected: [${expectedToolNames.join(", ")}], Actual: [${actualToolNames.join(", ")}]`;
          console.error(`❌ ${errorMsg}`);
          throw new Error(errorMsg);
        }

        // Check if any actual tool calls were not expected
        const unexpectedToolCalls = actualToolNames.filter(
          (toolName) => !expectedToolNames.includes(toolName)
        );
        if (unexpectedToolCalls.length > 0) {
          const errorMsg = `Unexpected tool calls found: ${unexpectedToolCalls.join(", ")}. Expected only: [${expectedToolNames.join(", ")}]`;
          console.error(`❌ ${errorMsg}`);
          throw new Error(errorMsg);
        }

        // Check if any expected tool calls were not made
        const missingToolCalls = expectedToolNames.filter(
          (toolName) => !actualToolNames.includes(toolName)
        );
        if (missingToolCalls.length > 0) {
          const errorMsg = `Missing expected tool calls: ${missingToolCalls.join(", ")}. Actual calls: [${actualToolNames.join(", ")}]`;
          console.error(`❌ ${errorMsg}`);
          throw new Error(errorMsg);
        }

        // Validate the order of tool calls
        for (let i = 0; i < testCase.expectedCalls.length; i++) {
          const expectedToolName = testCase.expectedCalls[i].toolName;
          const actualToolName = actualToolCalls[i].name;

          if (expectedToolName !== actualToolName) {
            const errorMsg = `Tool call order mismatch at position ${i + 1}. Expected: ${expectedToolName}, Got: ${actualToolName}. Expected order: [${expectedToolNames.join(", ")}], Actual order: [${actualToolNames.join(", ")}]`;
            console.error(`❌ ${errorMsg}`);
            throw new Error(errorMsg);
          }
        }

        // Validate arguments for each tool call in order
        for (let i = 0; i < testCase.expectedCalls.length; i++) {
          const expectedCall = testCase.expectedCalls[i];
          const actualCall = actualToolCalls[i];

          if (expectedCall.argumentValidator) {
            expectedCall.argumentValidator(actualCall.args);
          }
        }
      }

      // Basic assertions
      expect(finalResponse).toBeDefined();
      expect(finalResponse.length).toBeGreaterThan(0);

      // Verify final output if validator provided
      if (testCase.finalOutputValidator) {
        testCase.finalOutputValidator(finalResponse);
      }

      console.log(`✅ Agent Prompt test completed successfully: ${testCase.description}`);
    } catch (error) {
      console.error(`❌ Agent Prompt test failed: ${testCase.description}`, error);
      throw error;
    }
  });

  // Add a simple test to verify the test setup works
  test("test setup verification", () => {
    if (!process.env.GEMINI_API_KEY) {
      console.log("Skipping setup verification - no API key");
      return;
    }

    expect(realGeminiModel).toBeDefined();
    expect(availableTools.length).toBeGreaterThan(0);

    console.log("✅ Agent Prompt test setup verified successfully");
  });
});

End of legacy test file */
