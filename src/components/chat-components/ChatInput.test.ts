import { describe, it, expect } from "@jest/globals";

// Helper function to simulate the slash detection and replacement logic
function detectSlashCommand(
  inputValue: string,
  cursorPos: number
): { shouldShowModal: boolean; slashPosition?: number } {
  // Check if we just typed a "/"
  if (cursorPos > 0 && inputValue[cursorPos - 1] === "/") {
    // Check if it's at the beginning or after a space
    const isAtBeginning = cursorPos === 1;
    const isAfterSpace = cursorPos >= 2 && inputValue[cursorPos - 2] === " ";
    const isAnywhere = true; // We want to support "/" anywhere

    if (isAtBeginning || isAfterSpace || isAnywhere) {
      return { shouldShowModal: true, slashPosition: cursorPos - 1 };
    }
  }

  return { shouldShowModal: false };
}

// Helper function to simulate text replacement
function replaceSlashWithCommand(
  inputMessage: string,
  cursorPos: number,
  commandContent: string
): { newMessage: string; newCursorPos: number } {
  // Find the slash position (should be cursorPos - 1 when we just typed it)
  const slashPos = cursorPos - 1;

  if (slashPos >= 0 && inputMessage[slashPos] === "/") {
    const before = inputMessage.slice(0, slashPos);
    const after = inputMessage.slice(slashPos + 1);
    const newMessage = before + commandContent + after;
    const newCursorPos = before.length + commandContent.length;

    return { newMessage, newCursorPos };
  }

  // Fallback
  return { newMessage: inputMessage, newCursorPos: cursorPos };
}

describe("ChatInput Slash Command Detection", () => {
  describe("detectSlashCommand", () => {
    it('should detect "/" at the beginning of input', () => {
      const result = detectSlashCommand("/", 1);
      expect(result.shouldShowModal).toBe(true);
      expect(result.slashPosition).toBe(0);
    });

    it('should detect "/" after a space', () => {
      const result = detectSlashCommand("hello /", 7);
      expect(result.shouldShowModal).toBe(true);
      expect(result.slashPosition).toBe(6);
    });

    it('should detect "/" in the middle without space', () => {
      const result = detectSlashCommand("hello/world", 6);
      expect(result.shouldShowModal).toBe(true);
      expect(result.slashPosition).toBe(5);
    });

    it('should not detect when cursor is not right after "/"', () => {
      const result = detectSlashCommand("hello / world", 8); // cursor after space
      expect(result.shouldShowModal).toBe(false);
    });
  });

  describe("replaceSlashWithCommand", () => {
    it('should replace "/" at the beginning', () => {
      const result = replaceSlashWithCommand("/", 1, "Fix grammar and spelling");
      expect(result.newMessage).toBe("Fix grammar and spelling");
      expect(result.newCursorPos).toBe(24);
    });

    it('should replace "/" after space and preserve text before', () => {
      const result = replaceSlashWithCommand("hello /", 7, "Summarize");
      expect(result.newMessage).toBe("hello Summarize");
      expect(result.newCursorPos).toBe(15);
    });

    it('should replace "/" in middle and preserve text before and after', () => {
      const result = replaceSlashWithCommand("hello/world", 6, "Translate to Chinese");
      expect(result.newMessage).toBe("helloTranslate to Chineseworld");
      expect(result.newCursorPos).toBe(25);
    });

    it('should handle "/" with text on both sides', () => {
      const result = replaceSlashWithCommand("start /middle end", 7, "Custom Command");
      expect(result.newMessage).toBe("start Custom Commandmiddle end");
      expect(result.newCursorPos).toBe(20);
    });

    it('should handle multiple words after "/"', () => {
      const result = replaceSlashWithCommand("prefix /suffix with more words", 8, "INSERT");
      expect(result.newMessage).toBe("prefix INSERTsuffix with more words");
      expect(result.newCursorPos).toBe(13);
    });
  });

  describe("Integration scenarios", () => {
    it('should handle "Type something /" scenario', () => {
      const input = "Type something /";
      const cursorPos = 16;

      const detection = detectSlashCommand(input, cursorPos);
      expect(detection.shouldShowModal).toBe(true);

      const replacement = replaceSlashWithCommand(input, cursorPos, "Fix grammar");
      expect(replacement.newMessage).toBe("Type something Fix grammar");
    });

    it('should handle "hello/world" scenario', () => {
      const input = "hello/world";
      const cursorPos = 6;

      const detection = detectSlashCommand(input, cursorPos);
      expect(detection.shouldShowModal).toBe(true);

      const replacement = replaceSlashWithCommand(input, cursorPos, "Summarize");
      expect(replacement.newMessage).toBe("helloSummarizeworld");
    });

    it("should handle multiple slash commands in one input", () => {
      // First slash
      let input = "First /";
      let cursorPos = 7;

      const detection1 = detectSlashCommand(input, cursorPos);
      expect(detection1.shouldShowModal).toBe(true);

      const replacement1 = replaceSlashWithCommand(input, cursorPos, "command1");
      expect(replacement1.newMessage).toBe("First command1");

      // Second slash
      input = replacement1.newMessage + " and /";
      cursorPos = input.length;

      const detection2 = detectSlashCommand(input, cursorPos);
      expect(detection2.shouldShowModal).toBe(true);

      const replacement2 = replaceSlashWithCommand(input, cursorPos, "command2");
      expect(replacement2.newMessage).toBe("First command1 and command2");
    });
  });
});
