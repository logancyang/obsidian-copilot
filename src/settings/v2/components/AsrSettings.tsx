import React from "react";
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
    <div className="tw-p-4 tw-rounded-lg tw-border tw-border-border tw-max-w-3xl tw-mx-auto">
      <h2 className="tw-text-xl tw-font-semibold text-foreground tw-border-b tw-border-border tw-pb-2">
        Settings for Transcription
      </h2>

      {/* 服务类型设置 */}
      <div className="tw-p-4 tw-bg-muted tw-rounded-md tw-mt-4">
        <div className="tw-flex tw-flex-col md:tw-flex-row md:tw-items-center tw-justify-between tw-gap-4">
          <div className="tw-flex tw-items-center tw-gap-3">
            <span className="tw-text-sm tw-font-medium text-foreground">Service Type</span>
            <label className="tw-relative tw-inline-flex tw-items-center tw-cursor-pointer">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_useLocalService}
                onChange={(e) => handleToggleChange("Asr_useLocalService")(e.target.checked)}
                className="tw-sr-only tw-peer"
              />
              <div className="tw-w-11 tw-h-6 tw-bg-input peer-focus:tw-outline-none peer-focus:tw-ring-2 peer-focus:tw-ring-ring tw-rounded-full tw-peer tw-peer-checked:tw-after:tw-translate-x-full tw-peer-checked:tw-after:tw-border-background after:tw-content-[''] after:tw-absolute after:tw-top-[2px] after:tw-left-[2px] after:tw-bg-background after:tw-border after:tw-border-border after:tw-rounded-full after:tw-h-5 after:tw-w-5 after:tw-transition-all tw-peer-checked:tw-bg-primary"></div>
            </label>
          </div>

          <div className="tw-flex tw-items-center tw-gap-3">
            <span className="tw-text-sm tw-text-muted-foreground">Currently using:</span>
            <span
              className={`tw-px-2 tw-py-1 tw-rounded-full tw-text-xs tw-font-medium ${
                plugin.asrSettings.Asr_useLocalService
                  ? "tw-bg-green-100 tw-text-green-800"
                  : "tw-bg-blue-100 tw-text-blue-800"
              }`}
            >
              {plugin.asrSettings.Asr_useLocalService ? "Local Service" : "OpenAI API"}
            </span>
          </div>
        </div>

        <p className="tw-mt-2 tw-text-xs tw-text-muted-foreground">
          Toggle to switch between OpenAI API or your local Whisper service
        </p>
        <div className="tw-space-y-2">
          <label className="tw-block tw-text-sm tw-font-medium text-foreground">
            Transcription engine
          </label>
          <div className="tw-relative tw-z-10">
            <select
              value={plugin.asrSettings.Asr_transcriptionEngine}
              onChange={(e) => saveSetting({ Asr_transcriptionEngine: e.target.value })}
              className="tw-w-full tw-min-h-[35px] tw-py-2 tw-px-3 tw-bg-background tw-border tw-border-input tw-rounded-md tw-text-sm focus:tw-ring-2 focus:tw-ring-ring tw-appearance-none"
            >
              <option value="whisper_asr">Whisper ASR (Self-hosted)</option>
            </select>
            <div className="tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-px-2 tw-pointer-events-none">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="tw-text-muted-foreground"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>
          <p className="tw-text-xs tw-text-muted-foreground">
            Whisper ASR requires local Python setup.
          </p>
        </div>
      </div>
      {/* API 设置组 */}
      <div className="tw-p-4 tw-bg-muted tw-rounded-md">
        <h3 className="tw-text-lg tw-font-medium text-foreground tw-mb-3">API Settings</h3>

        <div className="tw-space-y-4">
          <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-4 tw-items-center">
            <label className="tw-text-sm tw-font-medium text-foreground">API Key</label>
            <input
              type="text"
              placeholder="sk-...xxxx"
              value={plugin.asrSettings.Asr_apiKey}
              onChange={(e) => handleTextChange("Asr_apiKey")(e.target.value)}
              className="tw-col-span-2 tw-p-2 tw-bg-background tw-border tw-border-input tw-rounded-md tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
            />
          </div>

          <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-4 tw-items-center">
            <label className="tw-text-sm tw-font-medium text-foreground">API URL</label>
            <input
              type="text"
              placeholder="https://api.your-custom-url.com"
              value={plugin.asrSettings.Asr_apiUrl}
              onChange={(e) => handleTextChange("Asr_apiUrl")(e.target.value)}
              className="tw-col-span-2 tw-p-2 tw-bg-background tw-border tw-border-input tw-rounded-md tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
            />
          </div>
        </div>
      </div>
      {/* 本地服务设置组 */}
      <div className="tw-p-4 tw-bg-muted tw-rounded-md">
        <h3 className="tw-text-lg tw-font-medium text-foreground tw-mb-3">
          Local Service Settings
        </h3>

        <div className="tw-space-y-4">
          {/* 本地服务URL输入 */}
          <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-4 tw-items-center">
            <label className="tw-text-sm tw-font-medium text-foreground">Local Service URL</label>
            <input
              type="text"
              placeholder={DEFAULT_SETTINGS.Asr_localServiceUrl}
              value={plugin.asrSettings.Asr_localServiceUrl}
              onChange={(e) => handleTextChange("Asr_localServiceUrl")(e.target.value)}
              className="tw-col-span-2 tw-p-2 tw-bg-background tw-border tw-border-input tw-rounded-md tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
            />
          </div>

          {/* 音频编码复选框 */}
          <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-4 tw-items-center">
            <label className="tw-text-sm tw-font-medium text-foreground">Encode Audio</label>
            <div className="tw-col-span-2 tw-flex tw-items-center tw-gap-3">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_encode}
                onChange={(e) => handleToggleChange("Asr_encode")(e.target.checked)}
                className="tw-h-4 tw-w-4 tw-text-primary tw-rounded tw-border-input focus:tw-ring-ring"
              />
              <span className="tw-text-sm tw-text-muted-foreground">
                Enable audio encoding for local service
              </span>
            </div>
          </div>

          {/* VAD过滤器复选框 */}
          <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-4 tw-items-center">
            <label className="tw-text-sm tw-font-medium text-foreground">VAD Filter</label>
            <div className="tw-col-span-2 tw-flex tw-items-center tw-gap-3">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_vadFilter}
                onChange={(e) => handleToggleChange("Asr_vadFilter")(e.target.checked)}
                className="tw-h-4 tw-w-4 tw-text-primary tw-rounded tw-border-input focus:tw-ring-ring"
              />
              <span className="tw-text-sm tw-text-muted-foreground">
                Enable Voice Activity Detection filter
              </span>
            </div>
          </div>
        </div>
      </div>
      {/* 文件保存设置组 */}
      <div className="tw-p-4 tw-bg-muted tw-rounded-md">
        <h3 className="tw-text-lg tw-font-medium text-foreground tw-mb-3">File Saving Settings</h3>

        <div className="tw-space-y-4">
          {/* 保存录音设置 */}
          <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-4 tw-items-center">
            <label className="tw-text-sm tw-font-medium text-foreground">Save recording</label>
            <div className="tw-col-span-2 tw-flex tw-items-center tw-gap-3">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_saveAudioFile}
                onChange={(e) => handleToggleChange("Asr_saveAudioFile")(e.target.checked)}
                className="tw-h-4 tw-w-4 tw-text-primary tw-rounded tw-border-input focus:tw-ring-ring"
              />
              <span className="tw-text-sm tw-text-muted-foreground">
                Turn on to save the audio file after sending it to the Whisper API
              </span>
            </div>
          </div>

          {/* 录音文件夹设置 */}
          <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-4 tw-items-center">
            <label className="tw-text-sm tw-font-medium text-foreground">Recordings folder</label>
            <input
              type="text"
              placeholder="Example: folder/audio"
              value={plugin.asrSettings.Asr_saveAudioFilePath}
              onChange={(e) => handleTextChange("Asr_saveAudioFilePath")(e.target.value)}
              disabled={!plugin.asrSettings.Asr_saveAudioFile}
              className="tw-col-span-2 tw-p-2 tw-bg-background tw-border tw-border-input tw-rounded-md tw-text-sm focus:tw-ring-2 focus:tw-ring-ring disabled:tw-opacity-50 disabled:tw-cursor-not-allowed"
            />
          </div>

          {/* 保存转录文本设置 */}
          <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-4 tw-items-center">
            <label className="tw-text-sm tw-font-medium text-foreground">Save transcription</label>
            <div className="tw-col-span-2 tw-flex tw-items-center tw-gap-3">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_createNewFileAfterRecording}
                onChange={(e) =>
                  handleToggleChange("Asr_createNewFileAfterRecording")(e.target.checked)
                }
                className="tw-h-4 tw-w-4 tw-text-primary tw-rounded tw-border-input focus:tw-ring-ring"
              />
              <span className="tw-text-sm tw-text-muted-foreground">
                Turn on to create a new file for each recording
              </span>
            </div>
          </div>

          {/* 转录文本文件夹设置 */}
          <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-4 tw-items-center">
            <label className="tw-text-sm tw-font-medium text-foreground">
              Transcriptions folder
            </label>
            <input
              type="text"
              placeholder="Example: folder/note"
              value={plugin.asrSettings.Asr_createNewFileAfterRecordingPath}
              onChange={(e) =>
                handleTextChange("Asr_createNewFileAfterRecordingPath")(e.target.value)
              }
              disabled={!plugin.asrSettings.Asr_createNewFileAfterRecording}
              className="tw-col-span-2 tw-p-2 tw-bg-background tw-border tw-border-input tw-rounded-md tw-text-sm focus:tw-ring-2 focus:tw-ring-ring disabled:tw-opacity-50 disabled:tw-cursor-not-allowed"
            />
          </div>
        </div>
      </div>
      {/* General Settings Section */}
      <section className="tw-p-5 tw-bg-muted tw-rounded-lg">
        <h3 className="tw-text-lg tw-font-semibold text-foreground tw-mb-4 tw-flex tw-items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="tw-mr-2 tw-text-primary"
          >
            <line x1="4" y1="21" x2="4" y2="14"></line>
            <line x1="4" y1="10" x2="4" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12" y2="3"></line>
            <line x1="20" y1="21" x2="20" y2="16"></line>
            <line x1="20" y1="12" x2="20" y2="3"></line>
            <line x1="1" y1="14" x2="7" y2="14"></line>
            <line x1="9" y1="8" x2="15" y2="8"></line>
            <line x1="17" y1="16" x2="23" y2="16"></line>
          </svg>
          General Settings
        </h3>

        <div className="tw-space-y-4">
          {/* Language Selector */}
          <div className="tw-space-y-1">
            <label className="tw-block tw-text-sm tw-font-medium text-foreground">Language</label>
            <div className="tw-relative tw-z-10">
              <select
                value={plugin.asrSettings.Asr_language}
                onChange={(e) => saveSetting({ Asr_language: e.target.value })}
                className="tw-w-full tw-min-h-[35px] tw-p-2 tw-bg-background tw-border tw-border-input tw-rounded-md tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
              >
                <option value="auto">Auto-detect</option>
                {Object.entries(LANGUAGES).map(([key, value]) => (
                  <option key={value} value={value}>
                    {key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
              <div className="tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-px-2 tw-pointer-events-none">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="tw-text-muted-foreground"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
            <p className="tw-text-xs tw-text-muted-foreground">
              Automatically detected if not specified
            </p>
          </div>

          {/* Line Spacing Selector */}
          <div className="tw-space-y-1">
            <label className="tw-block tw-text-sm tw-font-medium text-foreground">
              Line Spacing
            </label>
            <div className="tw-relative tw-z-10">
              <select
                value={plugin.asrSettings.Asr_lineSpacing}
                onChange={(e) => saveSetting({ Asr_lineSpacing: e.target.value })}
                className="tw-w-full tw-min-h-[35px] tw-p-2 tw-bg-background tw-border tw-border-input tw-rounded-md tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
              >
                <option value="multi">Multi-line</option>
                <option value="single">Single-line</option>
              </select>
              <div className="tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-px-2 tw-pointer-events-none">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="tw-text-muted-foreground"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
            <p className="tw-text-xs tw-text-muted-foreground">
              Formatting for the transcribed text output
            </p>
          </div>

          {/* Enable Timestamps Toggle */}
          <div className="tw-flex tw-items-center tw-justify-between tw-py-2">
            <label className="tw-text-sm tw-font-medium text-foreground">Enable timestamps</label>
            <label className="tw-relative tw-inline-flex tw-items-center tw-cursor-pointer">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_timestamps}
                onChange={(e) => saveSetting({ Asr_timestamps: e.target.checked })}
                className="tw-sr-only tw-peer"
              />
              <div className="tw-w-11 tw-h-6 tw-bg-input peer-focus:tw-outline-none peer-focus:tw-ring-2 peer-focus:tw-ring-ring tw-rounded-full tw-peer tw-peer-checked:tw-after:tw-translate-x-full tw-peer-checked:tw-after:tw-border-background after:tw-content-[''] after:tw-absolute after:tw-top-[2px] after:tw-left-[2px] after:tw-bg-background after:tw-border after:tw-border-border after:tw-rounded-full after:tw-h-5 after:tw-w-5 after:tw-transition-all tw-peer-checked:tw-bg-primary"></div>
            </label>
          </div>

          {/* Timestamp Format */}
          <div
            className={`tw-space-y-1 ${!plugin.asrSettings.Asr_timestamps ? "tw-opacity-50 tw-pointer-events-none" : ""}`}
          >
            <label className="tw-block tw-text-sm tw-font-medium text-foreground">
              Timestamp format
            </label>
            <div className="tw-relative tw-z-10">
              <select
                value={plugin.asrSettings.Asr_timestampFormat}
                onChange={(e) => saveSetting({ Asr_timestampFormat: e.target.value })}
                className="tw-w-full tw-min-h-[35px] tw-p-2 tw-bg-background tw-border tw-border-input tw-rounded-md tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
                disabled={!plugin.asrSettings.Asr_timestamps}
              >
                <option value="auto">Auto (Shortest format)</option>
                <option value="HH:mm:ss">HH:mm:ss</option>
                <option value="mm:ss">mm:ss</option>
                <option value="ss">ss</option>
              </select>
              <div className="tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-px-2 tw-pointer-events-none">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="tw-text-muted-foreground"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
            <p className="tw-text-xs tw-text-muted-foreground">
              Format for timestamp markers in the transcription
            </p>
          </div>

          {/* Timestamp Interval */}
          <div
            className={`tw-space-y-1 ${!plugin.asrSettings.Asr_timestamps ? "tw-opacity-50 tw-pointer-events-none" : ""}`}
          >
            <label className="tw-block tw-text-sm tw-font-medium text-foreground">
              Timestamp interval
            </label>
            <div className="tw-relative tw-z-10">
              <select
                value={plugin.asrSettings.Asr_timestampInterval}
                onChange={(e) => saveSetting({ Asr_timestampInterval: e.target.value })}
                className="tw-w-full tw-min-h-[35px] tw-p-2 tw-bg-background tw-border tw-border-input tw-rounded-md tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
                disabled={!plugin.asrSettings.Asr_timestamps}
              >
                <option value="0">Off</option>
                <option value="5">Every 5 seconds</option>
                <option value="10">Every 10 seconds</option>
                <option value="15">Every 15 seconds</option>
                <option value="20">Every 20 seconds</option>
                <option value="30">Every 30 seconds</option>
                <option value="60">Every minute</option>
              </select>
              <div className="tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-px-2 tw-pointer-events-none">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="tw-text-muted-foreground"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
            <p className="tw-text-xs tw-text-muted-foreground">
              How often to insert timestamp markers
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
export { AsrSetting };
