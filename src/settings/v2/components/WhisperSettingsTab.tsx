import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import CopilotPlugin from "@/main";

// 定义 WhisperSettings 接口
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

// 定义默认设置
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

// 定义 SettingsManager 类
export class SettingsManager {
  private plugin: CopilotPlugin;

  constructor(plugin: CopilotPlugin) {
    this.plugin = plugin;
  }

  async loadSettings(): Promise<WhisperSettings> {
    return Object.assign({}, DEFAULT_SETTINGS, await this.plugin.loadData());
  }

  async saveSettings(settings: WhisperSettings): Promise<void> {
    await this.plugin.saveData(settings);
  }
}

// 定义 WhisperSettingsTab 组件
export function WhisperSettingsTab({ plugin }: { plugin: CopilotPlugin }) {
  const [settings, setSettings] = useState<WhisperSettings>(DEFAULT_SETTINGS);
  const settingsManager = new SettingsManager(plugin);

  // 加载设置
  useEffect(() => {
    const load = async () => {
      const loadedSettings = await settingsManager.loadSettings();
      setSettings(loadedSettings);
    };
    load();
  }, [plugin, settingsManager]);

  // 保存设置
  const saveSettings = async (newSettings: WhisperSettings) => {
    await settingsManager.saveSettings(newSettings);
    setSettings(newSettings);
  };

  // 更新设置可见性
  const updateSettingVisibility = () => {
    const isLocalService = settings.useLocalService;
    const apiKeyInput = document.getElementById("api-key-input");
    const apiUrlInput = document.getElementById("api-url-input");
    const localServiceUrlInput = document.getElementById("local-service-url-input");
    const localServiceSettings = document.querySelectorAll(".local-service-setting");

    if (apiKeyInput) apiKeyInput.style.display = isLocalService ? "none" : "";
    if (apiUrlInput) apiUrlInput.style.display = isLocalService ? "none" : "";
    if (localServiceUrlInput) localServiceUrlInput.style.display = isLocalService ? "" : "none";

    localServiceSettings.forEach((setting) => {
      (setting as HTMLElement).style.display = isLocalService ? "" : "none";
    });
  };

  useEffect(() => {
    updateSettingVisibility();
  }, [settings.useLocalService]);

  // 处理文本输入变化
  const handleTextChange = (key: keyof WhisperSettings) => (value: string) => {
    const newSettings = { ...settings, [key]: value };
    saveSettings(newSettings);
  };

  // 处理开关变化
  const handleToggleChange = (key: keyof WhisperSettings) => (value: boolean) => {
    let newSettings = { ...settings, [key]: value };
    if (key === "saveAudioFile" && !value) {
      newSettings = { ...newSettings, saveAudioFilePath: "" };
    }
    if (key === "createNewFileAfterRecording" && !value) {
      newSettings = { ...newSettings, createNewFileAfterRecordingPath: "" };
    }
    saveSettings(newSettings);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 space-y-6 max-w-3xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-800 border-b pb-3">Settings for Whisper</h2>

      {/* 服务类型设置 */}
      <div className="bg-gray-50 p-4 rounded-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-gray-700 font-medium">Service Type</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.useLocalService}
                onChange={(e) => handleToggleChange("useLocalService")(e.target.checked)}
                className="sr-only peer"
              ></input>
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Currently using:</span>
            <span
              className="px-3 py-1 rounded-full text-xs font-medium 
                   {settings.useLocalService ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}"
            >
              {settings.useLocalService ? "Local Service" : "OpenAI API"}
            </span>
          </div>
        </div>

        <p className="mt-2 text-xs text-gray-500">
          Toggle to switch between OpenAI API or your local Whisper service
        </p>
      </div>

      {/* API 设置组 */}
      <div className="bg-gray-50 p-4 rounded-md">
        <h3 className="text-lg font-medium text-gray-700 mb-3">API Settings</h3>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">API Key</label>
            <input
              type="text"
              placeholder="sk-...xxxx"
              value={settings.apiKey}
              onChange={(e) => handleTextChange("apiKey")(e.target.value)}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">API URL</label>
            <input
              type="text"
              placeholder="https://api.your-custom-url.com"
              value={settings.apiUrl}
              onChange={(e) => handleTextChange("apiUrl")(e.target.value)}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* 本地服务设置组 */}
      <div className="bg-gray-50 p-4 rounded-md">
        <h3 className="text-lg font-medium text-gray-700 mb-3">Local Service Settings</h3>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Local Service URL</label>
            <input
              type="text"
              placeholder="http://localhost:9000"
              value={settings.localServiceUrl}
              onChange={(e) => handleTextChange("localServiceUrl")(e.target.value)}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Encode Audio</label>
            <div className="col-span-2 flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.encode}
                onChange={(e) => handleToggleChange("encode")(e.target.checked)}
                className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">Enable audio encoding for local service</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">VAD Filter</label>
            <div className="col-span-2 flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.vadFilter}
                onChange={(e) => handleToggleChange("vadFilter")(e.target.checked)}
                className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">Enable Voice Activity Detection filter</span>
            </div>
          </div>
        </div>
      </div>

      {/* 核心设置组 */}
      <div className="bg-gray-50 p-4 rounded-md">
        <h3 className="text-lg font-medium text-gray-700 mb-3">Core Settings</h3>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Model</label>
            <input
              type="text"
              placeholder="whisper-1"
              value={settings.model}
              onChange={(e) => handleTextChange("model")(e.target.value)}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Prompt</label>
            <input
              type="text"
              placeholder="Example: ZyntriQix, Digique Plus, CynapseFive"
              value={settings.prompt}
              onChange={(e) => handleTextChange("prompt")(e.target.value)}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Language</label>
            <input
              type="text"
              placeholder="en"
              value={settings.language}
              onChange={(e) => handleTextChange("language")(e.target.value)}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Translate</label>
            <div className="col-span-2 flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.translate}
                onChange={(e) => handleToggleChange("translate")(e.target.checked)}
                className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">
                Translate audio to English instead of transcribing
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 文件保存设置组 */}
      <div className="bg-gray-50 p-4 rounded-md">
        <h3 className="text-lg font-medium text-gray-700 mb-3">File Saving Settings</h3>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Save recording</label>
            <div className="col-span-2 flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.saveAudioFile}
                onChange={(e) => handleToggleChange("saveAudioFile")(e.target.checked)}
                className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">
                Turn on to save the audio file after sending it to the Whisper API
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Recordings folder</label>
            <input
              type="text"
              placeholder="Example: folder/audio"
              value={settings.saveAudioFilePath}
              onChange={(e) => handleTextChange("saveAudioFilePath")(e.target.value)}
              disabled={!settings.saveAudioFile}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Save transcription</label>
            <div className="col-span-2 flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.createNewFileAfterRecording}
                onChange={(e) =>
                  handleToggleChange("createNewFileAfterRecording")(e.target.checked)
                }
                className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">
                Turn on to create a new file for each recording
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Transcriptions folder</label>
            <input
              type="text"
              placeholder="Example: folder/note"
              value={settings.createNewFileAfterRecordingPath}
              onChange={(e) => handleTextChange("createNewFileAfterRecordingPath")(e.target.value)}
              disabled={!settings.createNewFileAfterRecording}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* 调试设置 */}
      <div className="bg-gray-50 p-4 rounded-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-gray-700 font-medium">Debug Mode</span>
            <input
              type="checkbox"
              checked={settings.debugMode}
              onChange={(e) => handleToggleChange("debugMode")(e.target.checked)}
              className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
            />
          </div>
          <span className="text-sm text-gray-600 max-w-md">
            Turn on to increase the plugin's verbosity for troubleshooting
          </span>
        </div>
      </div>
    </div>
  );
}

export default WhisperSettingsTab;
