/**
 * Unit tests for ChatClaudeCode class
 *
 * Tests configuration handling, instantiation, and basic method functionality
 * as specified in Story 2.1
 */

import { ChatClaudeCode, ChatClaudeCodeConfig } from "./ChatClaudeCode";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ClaudeCliInterface } from "./ClaudeCliInterface";

describe("ChatClaudeCode", () => {
  describe("Constructor and Configuration", () => {
    test("should instantiate with default configuration", () => {
      const chat = new ChatClaudeCode();
      const config = chat.getConfig();

      expect(config.cliPath).toBe("claude");
      expect(config.model).toBe("sonnet");
      expect(config.sessionMode).toBe("new");
      expect(config.timeout).toBe(30000);
      expect(config.fallbackEnabled).toBe(false);
      expect(config.debugMode).toBe(false);
    });

    test("should instantiate with custom configuration", () => {
      const customConfig: ChatClaudeCodeConfig = {
        cliPath: "/usr/local/bin/claude",
        model: "opus",
        sessionMode: "continue",
        timeout: 60000,
        fallbackEnabled: true,
        debugMode: true,
      };

      const chat = new ChatClaudeCode(customConfig);
      const config = chat.getConfig();

      expect(config.cliPath).toBe("/usr/local/bin/claude");
      expect(config.model).toBe("opus");
      expect(config.sessionMode).toBe("continue");
      expect(config.timeout).toBe(60000);
      expect(config.fallbackEnabled).toBe(true);
      expect(config.debugMode).toBe(true);
    });

    test("should merge custom config with defaults", () => {
      const partialConfig: ChatClaudeCodeConfig = {
        model: "haiku",
        debugMode: true,
      };

      const chat = new ChatClaudeCode(partialConfig);
      const config = chat.getConfig();

      expect(config.cliPath).toBe("claude"); // default
      expect(config.model).toBe("haiku"); // custom
      expect(config.sessionMode).toBe("new"); // default
      expect(config.timeout).toBe(30000); // default
      expect(config.fallbackEnabled).toBe(false); // default
      expect(config.debugMode).toBe(true); // custom
    });
  });

  describe("Configuration Validation", () => {
    test("should throw error for invalid timeout", () => {
      const invalidConfig: ChatClaudeCodeConfig = {
        timeout: -1000,
      };

      expect(() => new ChatClaudeCode(invalidConfig)).toThrow(
        "Claude Code timeout must be greater than 0"
      );
    });

    test("should throw error for invalid sessionMode", () => {
      const invalidConfig: ChatClaudeCodeConfig = {
        // @ts-ignore - Intentionally passing invalid value for test
        sessionMode: "invalid",
      };

      expect(() => new ChatClaudeCode(invalidConfig)).toThrow(
        "Claude Code sessionMode must be 'new' or 'continue'"
      );
    });
  });

  describe("LangChain Interface Compliance", () => {
    test("should return correct LLM type", () => {
      const chat = new ChatClaudeCode();
      expect(chat._llmType()).toBe("claude-code");
    });

    test("should use SimpleChatModel _generate implementation via _call", async () => {
      const chat = new ChatClaudeCode({ debugMode: false });
      // Mock the CLI interface execute method
      const mockExecute = jest.spyOn(ClaudeCliInterface.prototype, "execute");
      mockExecute.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ message: "Test response from CLI" }),
        stderr: "",
        exitCode: 0,
      });

      const messages = [new HumanMessage("Hello, Claude!")];

      const result = await chat._generate(messages, {});

      expect(result).toBeDefined();
      expect(result.generations).toHaveLength(1);
      expect(result.generations[0].message).toBeInstanceOf(AIMessage);
      expect(result.generations[0].text).toBe("Test response from CLI");

      mockExecute.mockRestore();
    });

    test("should handle streaming method", async () => {
      const chat = new ChatClaudeCode();
      const messages = [new HumanMessage("Hello, Claude!")];

      const chunks: string[] = [];
      const stream = chat._streamResponseChunks(messages, {});

      for await (const chunk of stream) {
        expect(chunk.text).toBeDefined();
        chunks.push(chunk.text);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join("")).toContain("Claude Code (Local CLI)");
    });
  });

  describe("Configuration Management", () => {
    test("should allow configuration updates", () => {
      const chat = new ChatClaudeCode();

      chat.updateConfig({
        model: "opus",
        timeout: 45000,
      });

      const config = chat.getConfig();
      expect(config.model).toBe("opus");
      expect(config.timeout).toBe(45000);
      expect(config.cliPath).toBe("claude"); // unchanged
    });

    test("should validate configuration on update", () => {
      const chat = new ChatClaudeCode();

      expect(() => {
        chat.updateConfig({ timeout: -500 });
      }).toThrow("Claude Code timeout must be greater than 0");
    });
  });

  describe("Debug Mode", () => {
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    test("should log configuration when debug mode is enabled", () => {
      new ChatClaudeCode({ debugMode: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "Claude Code initialized with config:",
        expect.objectContaining({
          cliPath: "claude",
          model: "sonnet",
          sessionMode: "new",
          timeout: 30000,
          fallbackEnabled: false,
        })
      );
    });

    test("should not log when debug mode is disabled", () => {
      new ChatClaudeCode({ debugMode: false });

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe("Message Processing (_call method)", () => {
    let chat: ChatClaudeCode;
    let mockExecute: jest.SpyInstance;

    beforeEach(() => {
      chat = new ChatClaudeCode({ debugMode: false });
      // Mock the CLI interface execute method
      mockExecute = jest.spyOn(ClaudeCliInterface.prototype, "execute");
    });

    afterEach(() => {
      mockExecute.mockRestore();
    });

    test("should successfully process messages and return response", async () => {
      const mockResponse = { message: "Hello! How can I help you today?" };
      mockExecute.mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockResponse),
        stderr: "",
        exitCode: 0,
      });

      const messages = [new HumanMessage("Hello, how are you?")];

      const result = await chat._call(messages, {});

      expect(mockExecute).toHaveBeenCalledWith([
        "--print",
        "--output-format",
        "json",
        "Human: Hello, how are you?",
      ]);
      expect(result).toBe("Hello! How can I help you today?");
    });

    test("should format multiple message types correctly", async () => {
      const mockResponse = { content: "Test response" };
      mockExecute.mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockResponse),
        stderr: "",
        exitCode: 0,
      });

      const messages = [
        new SystemMessage("You are a helpful assistant."),
        new HumanMessage("What's the weather?"),
        new AIMessage("I'll help you with that."),
        new HumanMessage("Thank you!"),
      ];

      await chat._call(messages, {});

      expect(mockExecute).toHaveBeenCalledWith([
        "--print",
        "--output-format",
        "json",
        "System: You are a helpful assistant.\n\nHuman: What's the weather?\n\nAssistant: I'll help you with that.\n\nHuman: Thank you!",
      ]);
    });

    test("should handle CLI execution errors gracefully", async () => {
      mockExecute.mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "Command failed",
        exitCode: 1,
      });

      const messages = [new HumanMessage("Test message")];
      const result = await chat._call(messages, {});

      expect(result).toContain("Claude Code is temporarily unavailable");
    });

    test("should handle JSON parsing errors", async () => {
      mockExecute.mockResolvedValue({
        success: true,
        stdout: "Invalid JSON response",
        stderr: "",
        exitCode: 0,
      });

      const messages = [new HumanMessage("Test message")];
      const result = await chat._call(messages, {});

      expect(result).toBe("Error processing Claude Code response. Please try again.");
    });

    test("should handle CLI not found error", async () => {
      mockExecute.mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: new Error("Command not found: claude"),
      });

      const messages = [new HumanMessage("Test message")];
      const result = await chat._call(messages, {});

      expect(result).toBe(
        "Claude Code is not installed or not found in PATH. Please install Claude Code and try again."
      );
    });

    test("should handle timeout errors", async () => {
      mockExecute.mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: new Error("Command timeout after 30000ms"),
      });

      const messages = [new HumanMessage("Test message")];
      const result = await chat._call(messages, {});

      expect(result).toBe("Claude Code request timed out. Please try again.");
    });

    test("should parse different response formats", async () => {
      // Test with 'content' field
      mockExecute.mockResolvedValueOnce({
        success: true,
        stdout: JSON.stringify({ content: "Response with content field" }),
        stderr: "",
        exitCode: 0,
      });

      let messages = [new HumanMessage("Test 1")];
      let result = await chat._call(messages, {});
      expect(result).toBe("Response with content field");

      // Test with string response
      mockExecute.mockResolvedValueOnce({
        success: true,
        stdout: JSON.stringify("Direct string response"),
        stderr: "",
        exitCode: 0,
      });

      messages = [new HumanMessage("Test 2")];
      result = await chat._call(messages, {});
      expect(result).toBe("Direct string response");
    });
  });
});
