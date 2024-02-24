import { CustomPrompt, CustomPromptProcessor } from '@/customPromptProcessor';

// Mocking Obsidian Vault
const mockVault = {
  read: jest.fn(),
  write: jest.fn(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('CustomPromptProcessor', () => {
  let processor: CustomPromptProcessor;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Create an instance of CustomPromptProcessor with mocked dependencies
    processor = CustomPromptProcessor.getInstance(mockVault);
  });

  it('should add 1 context and selectedText', async () => {
    const doc: CustomPrompt = {
      _id: 'test-prompt',
      prompt: 'This is a {variable} and {}.'
    };
    const selectedText = 'here is some selected text 12345';

    // Mock the extractVariablesFromPrompt method to return predefined content
    jest.spyOn(processor, 'extractVariablesFromPrompt').mockResolvedValue(['here is the note content for note0']);

    const result = await processor.processCustomPrompt(doc.prompt, selectedText);

    expect(result).toContain('This is a {variable} and {selectedText}.');
    expect(result).toContain('here is some selected text 12345');
    expect(result).toContain('here is the note content for note0');
  });

  it('should add 2 context and no selectedText', async () => {
    const doc: CustomPrompt = {
      _id: 'test-prompt',
      prompt: 'This is a {variable} and {var2}.'
    };
    const selectedText = 'here is some selected text 12345';

    // Mock the extractVariablesFromPrompt method to return predefined content
    jest.spyOn(processor, 'extractVariablesFromPrompt').mockResolvedValue([
      'here is the note content for note0',
      'note content for note1'
    ]);

    const result = await processor.processCustomPrompt(doc.prompt, selectedText);

    expect(result).toContain('This is a {variable} and {var2}.');
    expect(result).toContain('here is the note content for note0');
    expect(result).toContain('note content for note1');
  });

  it('should add 1 selectedText and no context', async () => {
    const doc: CustomPrompt = {
      _id: 'test-prompt',
      prompt: 'Rewrite the following text {}'
    };
    const selectedText = 'here is some selected text 12345';

    // Mock the extractVariablesFromPrompt method to return predefined content
    jest.spyOn(processor, 'extractVariablesFromPrompt').mockResolvedValue([
      'here is the note content for note0',
      'note content for note1'
    ]);

    const result = await processor.processCustomPrompt(doc.prompt, selectedText);

    expect(result).toContain('Rewrite the following text {selectedText}');
    expect(result).toContain('here is some selected text 12345');
    expect(result).not.toContain('here is the note content for note0');
    expect(result).not.toContain('note content for note1');
  });

  // This is not an expected use case but it's possible
  it('should add 2 selectedText and no context', async () => {
    const doc: CustomPrompt = {
      _id: 'test-prompt',
      prompt: 'Rewrite the following text {} and {}'
    };
    const selectedText = 'here is some selected text 12345';

    // Mock the extractVariablesFromPrompt method to return predefined content
    jest.spyOn(processor, 'extractVariablesFromPrompt').mockResolvedValue([
      'here is the note content for note0',
      'note content for note1'
    ]);

    const result = await processor.processCustomPrompt(doc.prompt, selectedText);

    expect(result).toContain('Rewrite the following text {selectedText} and {selectedText}');
    expect(result).toContain('here is some selected text 12345');
    expect(result).not.toContain('here is the note content for note0');
    expect(result).not.toContain('note content for note1');
  });

  it('should handle prompts without variables', async () => {
    const doc: CustomPrompt = {
      _id: 'test-prompt',
      prompt: 'This is a test prompt with no variables.'
    };
    const selectedText = 'selected text';

    // Mock the extractVariablesFromPrompt method to return an empty array
    jest.spyOn(processor, 'extractVariablesFromPrompt').mockResolvedValue([]);

    const result = await processor.processCustomPrompt(doc.prompt, selectedText);

    expect(result).toBe('This is a test prompt with no variables.\n\n');
  });

  it("should process a single tag variable correctly", async () => {
    const customPrompt = "Notes related to {#tag} are:";
    const selectedText = "";

    // Mock the extractVariablesFromPrompt method to simulate tag processing
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue([
        '[{"name":"note","content":"Note content for #tag"}]',
      ]);

    const result = await processor.processCustomPrompt(
      customPrompt,
      selectedText
    );

    expect(result).toContain("Notes related to {#tag} are:");
    expect(result).toContain(
      '[{"name":"note","content":"Note content for #tag"}]'
    );
  });

  it("should process multiple tag variables correctly", async () => {
    const customPrompt = "Notes related to {#tag1,#tag2,#tag3} are:";
    const selectedText = "";

    // Mock the extractVariablesFromPrompt method to simulate processing of multiple tags
    jest
      .spyOn(processor, "extractVariablesFromPrompt")
      .mockResolvedValue([
        '[{"name":"note1","content":"Note content for #tag1"},{"name":"note2","content":"Note content for #tag2"}]',
      ]);

    const result = await processor.processCustomPrompt(
      customPrompt,
      selectedText
    );

    expect(result).toContain("Notes related to {#tag1,#tag2,#tag3} are:");
    expect(result).toContain(
      '[{"name":"note1","content":"Note content for #tag1"},{"name":"note2","content":"Note content for #tag2"}]'
    );
  });
});