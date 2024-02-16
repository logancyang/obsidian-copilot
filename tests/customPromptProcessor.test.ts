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

  it('should replace placeholders with 1 context and selectedText', async () => {
    const doc: CustomPrompt = {
      _id: 'test-prompt',
      prompt: 'This is a {variable} and {}.'
    };
    const selectedText = 'here is some selected text 12345';

    // Mock the extractVariablesFromPrompt method to return predefined content
    jest.spyOn(processor, 'extractVariablesFromPrompt').mockResolvedValue(['here is the note content for note0']);

    const result = await processor.processCustomPrompt(doc.prompt, selectedText);

    expect(result).toContain('This is a {context0} and {selectedText}.');
    expect(result).toContain('here is some selected text 12345');
    expect(result).toContain('here is the note content for note0');
  });

  it('should replace placeholders with 2 context and no selectedText', async () => {
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

    expect(result).toContain('This is a {context0} and {context1}.');
    expect(result).toContain('here is the note content for note0');
    expect(result).toContain('note content for note1');
  });

  it('should replace placeholders with 1 selectedText and no context', async () => {
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
  it('should replace placeholders with 2 selectedText and no context', async () => {
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
});