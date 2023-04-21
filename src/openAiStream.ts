import { AI_SENDER, USER_SENDER } from '@/constants';
import { ChatMessage } from '@/sharedState';
import SSE from 'sse';


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

export const OpenAIStream = async (
  model: string,
  key: string,
  messages: OpenAiMessage[],
  temperature: number,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<ReadableStream> => {
  return new Promise((resolve, reject) => {
    try {
      const url = "https://api.openai.com/v1/chat/completions";
      const options = {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant named Obsidian Copilot.',
          },
          ...messages,
        ],
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

      source.stream();

      if (signal) {
        signal.addEventListener('abort', () => {
          source.close();
          reject(new Error('Aborted'));
        });
      }

      let txt = "";

      source.addEventListener('message', (e: any) => {
        if (e.data !== '[DONE]') {
          const payload = JSON.parse(e.data);
          const text = payload.choices[0].delta.content;
          txt += text;
        } else {
          source.close();

          // Create a ReadableStream with the accumulated txt
          const readableStream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(txt));
              controller.close();
            },
          });

          resolve(readableStream);
        }
      });

      source.addEventListener('error', (e: any) => {
        source.close();
        reject(e);
      });
    } catch (err) {
      reject(err);
    }
  });
};

export const sendMessageToAIAndStreamResponse = async (
  userMessage: ChatMessage,
  chatContext: ChatMessage[],
  openAiParams: OpenAiParams,
  controller: AbortController | null,
  updateCurrentAiMessage: (message: string) => void,
  addMessage: (message: ChatMessage) => void,
) => {
  const {
    key,
    model,
    temperature,
    maxTokens,
  } = openAiParams;
  // Use OpenAIStream to send message to AI and get a response
  try {
    const stream = await OpenAIStream(
      model,
      key,
      [
        ...chatContext.map((chatMessage) => {
          return {
            role: chatMessage.sender === USER_SENDER
              ? 'user' as Role : 'assistant' as Role,
            content: chatMessage.message,
          };
        }),
        { role: 'user', content: userMessage.message },
      ],
      temperature,
      maxTokens,
      controller?.signal,
    );
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let aiResponse = '';

    reader.read().then(
      async function processStream({ done, value }): Promise<void> {
        if (done) {
          // Add the full AI response to the chat history
          const botMessage: ChatMessage = {
            message: aiResponse,
            sender: AI_SENDER,
          };
          addMessage(botMessage);
          updateCurrentAiMessage('');
          return;
        }

        // Accumulate the AI response
        aiResponse += decoder.decode(value);
        updateCurrentAiMessage(aiResponse);

        // Continue reading the stream
        return reader.read().then(processStream);
      },
    );
  } catch (error) {
    console.error('Error in OpenAIStream:', error);
  }
};