import { Plugin, WorkspaceLeaf } from 'obsidian';
import { CopilotSettingTab } from './settings';
import { SharedState, ChatMessage } from './sharedState';
import CopilotView from './components/CopilotView';
import { CHAT_VIEWTYPE } from './constants';
import axios from 'axios';


interface CopilotSettings {
  openAiApiKey: string;
  defaultModel: string;
}

const DEFAULT_SETTINGS: Partial<CopilotSettings> = {
  openAiApiKey: '',
  defaultModel: 'gpt-3.5-turbo',
}

export default class CopilotPlugin extends Plugin {
  settings: CopilotSettings;
  // A chat history that stores the messages sent and received
  // Only reset when the user explicitly clicks "New Chat"
  sharedState: SharedState;
  model: string;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new CopilotSettingTab(this.app, this));
    this.sharedState = new SharedState();
    this.model = this.settings.defaultModel;

    this.registerView(
      CHAT_VIEWTYPE,
      (leaf: WorkspaceLeaf) => new CopilotView(this.app, leaf, this.sharedState)
    );

    this.addRibbonIcon('message-square', 'Copilot Chat', (evt: MouseEvent) => {
      // open or close the chatgpt view
      this.toggleView();
    });
  }

  toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    leaves.length > 0 ? this.deactivateView() : this.activateView();
  }

  async activateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
    await this.app.workspace.getRightLeaf(false).setViewState({
      type: CHAT_VIEWTYPE,
      active: true,
    });
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]);
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async sendMessage(inputMessage: string): Promise<ChatMessage> {
    // Add your logic to send a message to the AI and get the response.
    // Use the OpenAI API key and the default model from the plugin settings.
    // For example:

    const responseMessage = await this.getChatGPTResponse(inputMessage);

    // Return the message as a ChatMessage object.
    return {
      message: responseMessage,
      sender: 'AI',
    };
  }

  // Get a response from the ChatGPT API
  async getChatGPTResponse(message: string): Promise<string> {
    const apiKey = this.settings.openAiApiKey;

    if (!apiKey) {
      console.error('API key is not set.');
      return 'Error: API key is not set.';
    }
    if (!this.model) {
      console.error('Model is not set.');
      return 'Error: Model is not set.';
    }

    try {
      console.log('Model:', this.model);
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: this.model,
          // TODO: Add support for more chat history as context
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: message },
          ],
          temperature: 0.7,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
        }
      );
      const responseMessage = response.data.choices[0].message.content;
      return responseMessage
    } catch (error) {
      console.error('Failed to get response from OpenAI API:', error);
      return 'Error: Failed to get response from OpenAI API.';
    }
  }
}
