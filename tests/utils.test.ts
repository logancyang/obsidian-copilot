// src/utils.test.ts
import { getChatContext } from '@/utils';
import { ChatMessage } from '@/sharedState';
import { USER_SENDER, AI_SENDER } from '@/constants';

describe('getChatContext', () => {
  const userMessage1: ChatMessage = {
    message: 'Hello',
    sender: USER_SENDER,
  };

  const aiMessage1: ChatMessage = {
    message: 'Hi there!',
    sender: AI_SENDER,
  };

  const userMessage2: ChatMessage = {
    message: 'Hello again',
    sender: USER_SENDER,
  };

  const aiMessage2: ChatMessage = {
    message: 'Hi there again!',
    sender: AI_SENDER,
  };

  it('should return an empty context when chatHistory is empty', () => {
    const chatHistory: ChatMessage[] = [];
    const context = getChatContext(chatHistory, 5);
    expect(context).toEqual([]);
  });

  it('should return the correct context with chatHistory length 2', () => {
    const chatHistory: ChatMessage[] = [aiMessage1, userMessage2];
    const context = getChatContext(chatHistory, 5);
    expect(context).toEqual([aiMessage1, userMessage2]);
  });

  it('should return the correct context with chatHistory length 3', () => {
    const chatHistory: ChatMessage[] = [userMessage1, aiMessage1, userMessage2];
    const context = getChatContext(chatHistory, 5);
    expect(context).toEqual([userMessage1, aiMessage1, userMessage2]);
  });

  it('should return the correct context with chatHistory length 4', () => {
    const chatHistory: ChatMessage[] = [
      aiMessage1, userMessage1, aiMessage2, userMessage2,
    ];
    const context = getChatContext(chatHistory, 5);
    expect(context).toEqual([aiMessage1, userMessage1, aiMessage2, userMessage2]);
  });
});