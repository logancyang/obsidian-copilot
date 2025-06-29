import React, { useState, useEffect } from "react";
import CopilotPlugin from "@/main";
import { LANGUAGES } from "@/asr/AsrSettingsTab";
import { CopilotSettings, setSettings, useSettingsValue } from "@/settings/model";
import { DEFAULT_SETTINGS } from "@/constants";

/**
 * 从源对象中提取目标类型的属性并更新到目标对象
 * @param source 源对象（大类）
 * @param target 目标对象（小类）
 * @returns 更新后的目标对象
 */

function extractAndUpdate<Target extends object, Source extends object>(
  source: Source,
  target: Target
): Target {
  // 创建目标对象的浅拷贝
  const updatedTarget = { ...target };

  // 遍历源对象的所有属性
  for (const key in source) {
    if (
      // 检查源对象是否有该属性
      source.hasOwnProperty(key) &&
      // 检查目标对象是否有相同的属性
      (key as unknown as keyof Target) in updatedTarget &&
      // 确保属性类型兼容（避免类型错误）
      typeof source[key] === typeof updatedTarget[key as unknown as keyof Target]
    ) {
      // 更新目标对象中的属性值
      updatedTarget[key as unknown as keyof Target] = source[key] as any;
    }
  }

  return updatedTarget;
}

// 定义 SettingsManager 类
export class SettingsManager {
  private plugin: CopilotPlugin;

  constructor(plugin: CopilotPlugin) {
    this.plugin = plugin;
  }

  async saveSettings(settings: CopilotSettings): Promise<void> {
    setSettings(settings);
    this.plugin.asrSettings = extractAndUpdate(settings, this.plugin.asrSettings);
    // await this.plugin.saveData(settings);
  }
}

const AsrSetting: React.FC<{ plugin: CopilotPlugin }> = ({ plugin }) => {
  const settings = useSettingsValue();
  const settingsManager = new SettingsManager(plugin);

  const saveSetting = async (newSettings: Partial<CopilotSettings>) => {
    await settingsManager.saveSettings(newSettings as CopilotSettings);
    setSettings(newSettings as CopilotSettings);
    // const updatedSettings = {...settings, ...newSettings};
    // setSettings(updatedSettings);
    // plugin.asrSettings = updatedSettings;
    // await plugin.saveData(plugin.asrSettings);
  };

  // 处理文本输入变化
  const handleTextChange = (key: keyof CopilotSettings) => (value: string) => {
    const newSettings = { ...settings, [key]: value };
    saveSetting(newSettings);
  };

  // 处理开关变化
  const handleToggleChange = (key: keyof CopilotSettings) => (value: boolean) => {
    let newSettings = { ...settings, [key]: value };
    if (key === "Asr_saveAudioFile" && !value) {
      newSettings = { ...newSettings, Asr_saveAudioFilePath: "" };
    }
    if (key === "Asr_createNewFileAfterRecording" && !value) {
      newSettings = { ...newSettings, Asr_createNewFileAfterRecordingPath: "" };
    }
    saveSetting(newSettings);
  };

  return (
    <div className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 max-w-3xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-800 border-b pb-3">
        Settings for Transcription
      </h2>
      {/* 服务类型设置 */}
      <div className="bg-gray-50 p-4 rounded-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-gray-700 font-medium">Service Type</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_useLocalService}
                onChange={(e) => handleToggleChange("Asr_useLocalService")(e.target.checked)}
                className="sr-only peer"
              ></input>
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Currently using:</span>
            <span
              className="px-3 py-1 rounded-full text-xs font-medium
                   {settings.Asr_useLocalService ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}"
            >
              {plugin.asrSettings.Asr_useLocalService ? "Local Service" : "OpenAI API"}
            </span>
          </div>
        </div>

        <p className="mt-2 text-xs text-gray-500">
          Toggle to switch between OpenAI API or your local Whisper service
        </p>
        <div className="form-group">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Transcription engine
          </label>
          <div className="relative">
            <select
              value={plugin.asrSettings.Asr_transcriptionEngine}
              onChange={(e) => saveSetting({ Asr_transcriptionEngine: e.target.value })}
              className="w-full px-4 py-2 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:text-white"
            >
              <option value="whisper_asr">Whisper ASR (Self-hosted)</option>
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
              <i className="fa fa-chevron-down text-gray-400"></i>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
            Whisper ASR requires local Python setup.
          </p>
        </div>
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
              value={plugin.asrSettings.Asr_apiKey}
              onChange={(e) => handleTextChange("Asr_apiKey")(e.target.value)}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">API URL</label>
            <input
              type="text"
              placeholder="https://api.your-custom-url.com"
              value={plugin.asrSettings.Asr_apiUrl}
              onChange={(e) => handleTextChange("Asr_apiUrl")(e.target.value)}
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
              placeholder={DEFAULT_SETTINGS.Asr_localServiceUrl}
              value={plugin.asrSettings.Asr_localServiceUrl}
              onChange={(e) => {
                handleTextChange("Asr_localServiceUrl")(e.target.value);
              }}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Encode Audio</label>
            <div className="col-span-2 flex items-center gap-3">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_encode}
                onChange={(e) => handleToggleChange("Asr_encode")(e.target.checked)}
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
                checked={plugin.asrSettings.Asr_vadFilter}
                onChange={(e) => handleToggleChange("Asr_vadFilter")(e.target.checked)}
                className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">Enable Voice Activity Detection filter</span>
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
                checked={plugin.asrSettings.Asr_saveAudioFile}
                onChange={(e) => handleToggleChange("Asr_saveAudioFile")(e.target.checked)}
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
              value={plugin.asrSettings.Asr_saveAudioFilePath}
              onChange={(e) => handleTextChange("Asr_saveAudioFilePath")(e.target.value)}
              disabled={!plugin.asrSettings.Asr_saveAudioFile}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <label className="text-gray-700 font-medium">Save transcription</label>
            <div className="col-span-2 flex items-center gap-3">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_createNewFileAfterRecording}
                onChange={(e) =>
                  handleToggleChange("Asr_createNewFileAfterRecording")(e.target.checked)
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
              value={plugin.asrSettings.Asr_createNewFileAfterRecordingPath}
              onChange={(e) =>
                handleTextChange("Asr_createNewFileAfterRecordingPath")(e.target.value)
              }
              disabled={!plugin.asrSettings.Asr_createNewFileAfterRecording}
              className="col-span-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>
      {/* General Settings Section */}
      <section className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-5">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center">
          <i className="fa fa-sliders mr-2 text-blue-500"></i> General Settings
        </h3>

        <div className="grid grid-cols-1 gap-4">
          <div className="form-group">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Language
            </label>
            <div className="relative">
              <select
                value={plugin.asrSettings.Asr_language}
                onChange={(e) => {
                  saveSetting({ Asr_language: e.target.value });
                }}
                className="w-full px-4 py-2 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:text-white"
              >
                <option value="auto">Auto-detect</option>
                {Object.entries(LANGUAGES).map(([key, value]) => (
                  <option key={value} value={value}>
                    {key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                <i className="fa fa-chevron-down text-gray-400"></i>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              Automatically detected if not specified
            </p>
          </div>

          <div className="form-group">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Line Spacing
            </label>
            <div className="relative">
              <select
                value={plugin.asrSettings.Asr_lineSpacing}
                onChange={(e) => saveSetting({ Asr_lineSpacing: e.target.value })}
                className="w-full px-4 py-2 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:text-white"
              >
                <option value="multi">Multi-line</option>
                <option value="single">Single-line</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                <i className="fa fa-chevron-down text-gray-400"></i>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              Formatting for the transcribed text output
            </p>
          </div>

          <div className="form-group">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Enable timestamps
              </label>
              <div className="relative inline-block w-10 mr-2 align-middle select-none">
                <input
                  type="checkbox"
                  checked={plugin.asrSettings.Asr_timestamps}
                  onChange={(e) => saveSetting({ Asr_timestamps: e.target.checked })}
                  className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer transition-transform duration-200 ease-in transform translate-x-0 checked:translate-x-4 checked:border-blue-500"
                />
                <label
                  htmlFor="toggle"
                  className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-blue-500"
                ></label>
              </div>
            </div>
          </div>

          <div
            className={`form-group ${plugin.asrSettings.Asr_timestamps ? "" : "opacity-50 pointer-events-none"}`}
          >
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Timestamp format
            </label>
            <div className="relative">
              <select
                value={plugin.asrSettings.Asr_timestampFormat}
                onChange={(e) => saveSetting({ Asr_timestampFormat: e.target.value })}
                className="w-full px-4 py-2 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:text-white"
              >
                <option value="auto">Auto (Shortest format)</option>
                <option value="HH:mm:ss">HH:mm:ss</option>
                <option value="mm:ss">mm:ss</option>
                <option value="ss">ss</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                <i className="fa fa-chevron-down text-gray-400"></i>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              Format for timestamp markers in the transcription
            </p>
          </div>

          <div
            className={`form-group ${plugin.asrSettings.Asr_timestamps ? "" : "opacity-50 pointer-events-none"}`}
          >
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Timestamp interval
            </label>
            <div className="relative">
              <select
                value={plugin.asrSettings.Asr_timestampInterval}
                onChange={(e) => saveSetting({ Asr_timestampInterval: e.target.value })}
                className="w-full px-4 py-2 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:text-white"
              >
                <option value="0">Off</option>
                <option value="5">Every 5 seconds</option>
                <option value="10">Every 10 seconds</option>
                <option value="15">Every 15 seconds</option>
                <option value="20">Every 20 seconds</option>
                <option value="30">Every 30 seconds</option>
                <option value="60">Every minute</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                <i className="fa fa-chevron-down text-gray-400"></i>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              How often to insert timestamp markers
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
export { AsrSetting };
