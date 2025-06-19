import { Plugin } from "obsidian";

export interface WhisperSettings {
  apiKey: string;
  apiUrl: string;
  model: string;
  prompt: string;
  language: string;
  saveAudioFile: boolean;
  saveAudioFilePath: string;
  debugMode: boolean;
  createNewFileAfterRecording: boolean;
  createNewFileAfterRecordingPath: string;
  useLocalService: boolean;
  localServiceUrl: string;
  encode: boolean;
  vadFilter: boolean;
  translate: boolean;
}

export const DEFAULT_SETTINGS: WhisperSettings = {
  apiKey: "",
  apiUrl: "https://api.openai.com/v1/audio/transcriptions",
  model: "whisper-1",
  prompt: "",
  language: "en",
  saveAudioFile: false,
  saveAudioFilePath: "",
  debugMode: false,
  createNewFileAfterRecording: false,
  createNewFileAfterRecordingPath: "",
  useLocalService: true,
  localServiceUrl: "http://localhost:9000",
  encode: true,
  vadFilter: false,
  translate: false,
};

export class SettingsManager {
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async loadSettings(): Promise<WhisperSettings> {
    return Object.assign({}, DEFAULT_SETTINGS, await this.plugin.loadData());
  }

  async saveSettings(settings: WhisperSettings): Promise<void> {
    await this.plugin.saveData(settings);
  }
}
