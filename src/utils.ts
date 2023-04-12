import { ChatMessage } from '@/sharedState';
import { USER_SENDER, DEFAULT_SETTINGS } from '@/constants';
import { TFile } from 'obsidian';
import { CopilotSettings } from '@/main';

// Returns the last N messages from the chat history,
// last one being the newest ai message
export const getChatContext = (chatHistory: ChatMessage[], contextSize: number) => {
  if (chatHistory.length === 0) {
    return [];
  }
  const lastAiMessageIndex = chatHistory.slice().reverse().findIndex(msg => msg.sender !== USER_SENDER);
  if (lastAiMessageIndex === -1) {
    // No ai messages found, return an empty array
    return [];
  }

  const lastIndex = chatHistory.length - 1 - lastAiMessageIndex;
  const startIndex = Math.max(0, lastIndex - contextSize + 1);
  return chatHistory.slice(startIndex, lastIndex + 1);
};

export const formatDateTime = (now: Date, timezone: 'local' | 'utc' = 'local') => {
  const get = (method: string) => {
    if (timezone === 'utc') {
      return (now as any)[`getUTC${method}`]();
    }
    return (now as any)[`get${method}`]();
  };

  return [
    get('FullYear'),
    (get('Month') + 1).toString().padStart(2, '0'),
    get('Date').toString().padStart(2, '0'),
  ].join('_') + '-' + [
    get('Hours').toString().padStart(2, '0'),
    get('Minutes').toString().padStart(2, '0'),
    get('Seconds').toString().padStart(2, '0'),
  ].join('_');
};

export async function getFileContent(file: TFile): Promise<string | null> {
  if (file.extension != "md") return null;
  return await this.app.vault.read(file);
}

export function sanitizeSettings(settings: CopilotSettings): CopilotSettings {
  const sanitizedSettings: CopilotSettings = { ...settings };
  sanitizedSettings.temperature = isNaN(parseFloat(settings.temperature))
    ? DEFAULT_SETTINGS.temperature
    : settings.temperature;

  sanitizedSettings.maxTokens = isNaN(parseFloat(settings.maxTokens))
    ? DEFAULT_SETTINGS.maxTokens
    : settings.maxTokens;

  sanitizedSettings.contextTurns = isNaN(parseFloat(settings.contextTurns))
    ? DEFAULT_SETTINGS.contextTurns
    : settings.contextTurns;

  return sanitizedSettings;
}