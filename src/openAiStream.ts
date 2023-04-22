import { AI_SENDER, OPEN_AI_API_URL, USER_SENDER } from '@/constants';
import { ChatMessage } from '@/sharedState';
import { requestUrl } from 'obsidian';
import { SSE } from 'sse';

export type Role = 'assistant' | 'user';

export interface OpenAiMessage {
  role: Role;
  content: string;
}

export interface OpenAiParams {
  model: string,
  key: string,
  temperature: number,
  maxTokens: number,
}

export class OpenAIError extends Error {
  type: string;
  param: string;
  code: string;

  constructor(message: string, type: string, param: string, code: string) {
    super(message);
    this.name = 'OpenAIError';
    this.type = type;
    this.param = param;
    this.code = code;
  }
}

export class OpenAIRequestManager {
  stopRequested = false;

  constructor() {}

  stopStreaming() {
    this.stopRequested = true;
  }

  streamSSE = async (
    openAiParams: OpenAiParams,
    messages: OpenAiMessage[],
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
  ) => {
    return new Promise((resolve, reject) => {
      try {
        const {
          key,
          model,
          temperature,
          maxTokens,
        } = openAiParams;

        const formattedMessages = [
          {
            role: 'system',
            content: 'You are a helpful assistant named Obsidian Copilot.',
          },
          ...messages,
        ];

        const url = OPEN_AI_API_URL;
        const options = {
          model,
          messages: formattedMessages,
          max_tokens: maxTokens,
          temperature: temperature,
          stream: true,
        };

        const source = new SSE(url, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key ? key : process.env.OPENAI_API_KEY}`,
            ...(process.env.OPENAI_ORGANIZATION && {
              'OpenAI-Organization': process.env.OPENAI_ORGANIZATION,
            }),
          },
          method: 'POST',
          payload: JSON.stringify(options),
        });

        let aiResponse = '';

        const onMessage = async (e: any) => {
          if (this.stopRequested) {
            console.log('Manually closing SSE stream due to stop request.');
            source.close();
            resolve(null);
            return;
          }

          if (e.data !== "[DONE]") {
            const payload = JSON.parse(e.data);
            const text = payload.choices[0].delta.content;
            if (!text) {
              return;
            }
            aiResponse += text;
            updateCurrentAiMessage(aiResponse);
          } else {
            source.close();
            const botMessage: ChatMessage = {
              message: aiResponse,
              sender: AI_SENDER,
            };
            addMessage(botMessage);
            updateCurrentAiMessage('');
            resolve(aiResponse);
          }
        };

        source.addEventListener('message', onMessage);

        source.addEventListener('error', (e: any) => {
          source.close();
          reject(e);
        });

        source.stream();
      } catch (err) {
        reject(err);
      }
    });
  };
}

export const OpenAIRequest = async (
  model: string,
  key: string,
  messages: OpenAiMessage[],
  temperature: number,
  maxTokens: number,
): Promise<string> => {
  const res = await requestUrl({
    url: OPEN_AI_API_URL,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key ? key : process.env.OPENAI_API_KEY}`,
      ...(process.env.OPENAI_ORGANIZATION && {
        'OpenAI-Organization': process.env.OPENAI_ORGANIZATION,
      }),
    },
    method: 'POST',
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: temperature,
      stream: false,
    }),
  });

  if (res.status !== 200) {
    throw new Error(`OpenAI API returned an error: ${res.status}`);
  }

  const json = await res.json();
  return json.choices[0].text;
};

export const getAIResponse = async (
  userMessage: ChatMessage,
  chatContext: ChatMessage[],
  openAiParams: OpenAiParams,
  streamManager: OpenAIRequestManager,
  updateCurrentAiMessage: (message: string) => void,
  addMessage: (message: ChatMessage) => void,
  stream = true,
) => {
  const {
    key,
    model,
    temperature,
    maxTokens,
  } = openAiParams;

  const messages: OpenAiMessage[] = [
    ...chatContext.map((chatMessage) => {
      return {
        role: chatMessage.sender === USER_SENDER
          ? 'user' as Role : 'assistant' as Role,
        content: chatMessage.message,
      };
    }),
    { role: 'user', content: userMessage.message },
  ];

  if (stream) {
    // Use streamManager.streamSSE to send message to AI and get a response
    try {
      await streamManager.streamSSE(
        openAiParams,
        messages,
        updateCurrentAiMessage,
        addMessage,
      );
    } catch (error) {
      console.error('Error in streamManager.streamSSE:', error);
    }
  } else {
    // Non-streaming setup using OpenAIRequest
    try {
      const aiResponse = await OpenAIRequest(
        model,
        key,
        messages,
        temperature,
        maxTokens,
      );

      const botMessage: ChatMessage = {
        message: aiResponse,
        sender: AI_SENDER,
      };
      addMessage(botMessage);
      updateCurrentAiMessage('');

    } catch (error) {
      console.error('Error in OpenAIRequest:', error);
    }
  }
};
