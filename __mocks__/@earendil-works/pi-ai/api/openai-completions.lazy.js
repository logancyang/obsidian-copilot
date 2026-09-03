// Lightweight mock for the ESM-only openai-completions stream implementation.
// Tests only assert that a provider was handed an API implementation; actual
// streaming is not exercised in unit tests.

const openAICompletionsApi = () => ({
  stream: jest.fn(),
  streamSimple: jest.fn(),
});

module.exports = { openAICompletionsApi };
