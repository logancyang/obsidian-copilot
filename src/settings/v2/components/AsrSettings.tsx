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
    <div className="tw-mx-auto tw-max-w-3xl tw-rounded-lg tw-border tw-border-border tw-p-4">
      <h2 className="tw-border-b tw-border-border tw-pb-2 tw-text-xl tw-font-semibold">
        Settings for Transcription
      </h2>

      {/* 服务类型设置 */}
      <div className="tw-mt-4 tw-rounded-md tw-p-4">
        <div className="tw-flex tw-flex-col tw-justify-between tw-gap-4 md:tw-flex-row md:tw-items-center">
          <div className="tw-flex tw-items-center tw-gap-3">
            <span className="tw-text-sm tw-font-medium">Service Type</span>
            <label className="tw-relative tw-inline-flex tw-cursor-pointer tw-items-center">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_useLocalService}
                onChange={(e) => handleToggleChange("Asr_useLocalService")(e.target.checked)}
                className="tw-peer tw-sr-only"
              />
              <div className="tw-peer-checked:tw-after:tw-translate-x-full tw-peer-checked:tw-bg-primary tw-peer tw-h-6 tw-w-11 tw-rounded-full after:tw-absolute after:tw-left-[2px] after:tw-top-[2px] after:tw-size-5 after:tw-rounded-full after:tw-border after:tw-border-border after:tw-transition-all after:tw-content-[''] peer-focus:tw-outline-none peer-focus:tw-ring-2 peer-focus:tw-ring-ring"></div>
            </label>
          </div>

          <div className="tw-flex tw-items-center tw-gap-3">
            <span className="tw-text-sm">Currently using:</span>
            <span className={"tw-rounded-full tw-px-2 tw-py-1 tw-text-xs tw-font-medium"}>
              {plugin.asrSettings.Asr_useLocalService ? "Local Service" : "OpenAI API"}
            </span>
          </div>
        </div>

        <p className="tw-mt-2 tw-text-xs">
          Toggle to switch between OpenAI API or your local Whisper service
        </p>
        <div className="tw-space-y-2">
          <label className="tw-block tw-text-sm tw-font-medium">Transcription engine</label>
          <div className="tw-relative">
            <select
              value={plugin.asrSettings.Asr_transcriptionEngine}
              onChange={(e) => saveSetting({ Asr_transcriptionEngine: e.target.value })}
              className="tw-min-h-[35px] tw-w-full tw-appearance-none tw-rounded-md tw-border tw-px-3 tw-py-2 tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
            >
              <option value="whisper_asr">Whisper ASR (Self-hosted)</option>
            </select>
            <div className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-px-2">
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
                className="tw-text-base"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>
          <p className="tw-text-xs">Whisper ASR requires local Python setup.</p>
        </div>
      </div>
      {/* API 设置组 */}
      <div className="tw-rounded-md tw-p-4">
        <h3 className="tw-mb-3 tw-text-lg tw-font-medium">API Settings</h3>

        <div className="tw-space-y-4">
          <div className="tw-grid tw-grid-cols-1 tw-items-center tw-gap-4 md:tw-grid-cols-3">
            <label className="tw-text-sm tw-font-medium">API Key</label>
            <input
              type="text"
              placeholder="sk-...xxxx"
              value={plugin.asrSettings.Asr_apiKey}
              onChange={(e) => handleTextChange("Asr_apiKey")(e.target.value)}
              className="tw-col-span-2 tw-rounded-md tw-border tw-p-2 tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
            />
          </div>

          <div className="tw-grid tw-grid-cols-1 tw-items-center tw-gap-4 md:tw-grid-cols-3">
            <label className="tw-text-sm tw-font-medium">API URL</label>
            <input
              type="text"
              placeholder="https://api.your-custom-url.com"
              value={plugin.asrSettings.Asr_apiUrl}
              onChange={(e) => handleTextChange("Asr_apiUrl")(e.target.value)}
              className="tw-col-span-2 tw-rounded-md tw-border tw-p-2 tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
            />
          </div>
        </div>
      </div>
      {/* 本地服务设置组 */}
      <div className="tw-rounded-md tw-p-4">
        <h3 className="tw-mb-3 tw-text-lg tw-font-medium">Local Service Settings</h3>

        <div className="tw-space-y-4">
          {/* 本地服务URL输入 */}
          <div className="tw-grid tw-grid-cols-1 tw-items-center tw-gap-4 md:tw-grid-cols-3">
            <label className="tw-text-sm tw-font-medium">Local Service URL</label>
            <input
              type="text"
              placeholder={DEFAULT_SETTINGS.Asr_localServiceUrl}
              value={plugin.asrSettings.Asr_localServiceUrl}
              onChange={(e) => handleTextChange("Asr_localServiceUrl")(e.target.value)}
              className="tw-col-span-2 tw-rounded-md tw-border tw-p-2 tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
            />
          </div>

          {/* 音频编码复选框 */}
          <div className="tw-grid tw-grid-cols-1 tw-items-center tw-gap-4 md:tw-grid-cols-3">
            <label className="tw-text-sm tw-font-medium">Encode Audio</label>
            <div className="tw-col-span-2 tw-flex tw-items-center tw-gap-3">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_encode}
                onChange={(e) => handleToggleChange("Asr_encode")(e.target.checked)}
                className="tw-size-4 tw-rounded focus:tw-ring-ring"
              />
              <span className="tw-text-sm">Enable audio encoding for local service</span>
            </div>
          </div>

          {/* VAD过滤器复选框 */}
          <div className="tw-grid tw-grid-cols-1 tw-items-center tw-gap-4 md:tw-grid-cols-3">
            <label className="tw-text-sm tw-font-medium">VAD Filter</label>
            <div className="tw-col-span-2 tw-flex tw-items-center tw-gap-3">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_vadFilter}
                onChange={(e) => handleToggleChange("Asr_vadFilter")(e.target.checked)}
                className="tw-size-4 tw-rounded focus:tw-ring-ring"
              />
              <span className="tw-text-sm">Enable Voice Activity Detection filter</span>
            </div>
          </div>
        </div>
      </div>
      {/* 文件保存设置组 */}
      <div className="tw-rounded-md tw-p-4">
        <h3 className="tw-mb-3 tw-text-lg tw-font-medium">File Saving Settings</h3>

        <div className="tw-space-y-4">
          {/* 保存录音设置 */}
          <div className="tw-grid tw-grid-cols-1 tw-items-center tw-gap-4 md:tw-grid-cols-3">
            <label className="tw-text-sm tw-font-medium">Save recording</label>
            <div className="tw-col-span-2 tw-flex tw-items-center tw-gap-3">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_saveAudioFile}
                onChange={(e) => handleToggleChange("Asr_saveAudioFile")(e.target.checked)}
                className="tw-size-4 tw-rounded focus:tw-ring-ring"
              />
              <span className="tw-text-sm">
                Turn on to save the audio file after sending it to the Whisper API
              </span>
            </div>
          </div>

          {/* 录音文件夹设置 */}
          <div className="tw-grid tw-grid-cols-1 tw-items-center tw-gap-4 md:tw-grid-cols-3">
            <label className="tw-text-sm tw-font-medium">Recordings folder</label>
            <input
              type="text"
              placeholder="Example: folder/audio"
              value={plugin.asrSettings.Asr_saveAudioFilePath}
              onChange={(e) => handleTextChange("Asr_saveAudioFilePath")(e.target.value)}
              disabled={!plugin.asrSettings.Asr_saveAudioFile}
              className="tw-col-span-2 tw-rounded-md tw-border tw-p-2 tw-text-sm focus:tw-ring-2 focus:tw-ring-ring disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
            />
          </div>

          {/* 保存转录文本设置 */}
          <div className="tw-grid tw-grid-cols-1 tw-items-center tw-gap-4 md:tw-grid-cols-3">
            <label className="tw-text-sm tw-font-medium">Save transcription</label>
            <div className="tw-col-span-2 tw-flex tw-items-center tw-gap-3">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_createNewFileAfterRecording}
                onChange={(e) =>
                  handleToggleChange("Asr_createNewFileAfterRecording")(e.target.checked)
                }
                className="tw-size-4 tw-rounded focus:tw-ring-ring"
              />
              <span className="tw-text-sm">Turn on to create a new file for each recording</span>
            </div>
          </div>

          {/* 转录文本文件夹设置 */}
          <div className="tw-grid tw-grid-cols-1 tw-items-center tw-gap-4 md:tw-grid-cols-3">
            <label className="tw-text-sm tw-font-medium">Transcriptions folder</label>
            <input
              type="text"
              placeholder="Example: folder/note"
              value={plugin.asrSettings.Asr_createNewFileAfterRecordingPath}
              onChange={(e) =>
                handleTextChange("Asr_createNewFileAfterRecordingPath")(e.target.value)
              }
              disabled={!plugin.asrSettings.Asr_createNewFileAfterRecording}
              className="tw-col-span-2 tw-rounded-md tw-border tw-p-2 tw-text-sm focus:tw-ring-2 focus:tw-ring-ring disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
            />
          </div>
        </div>
      </div>
      {/* General Settings Section */}
      <section className="tw-rounded-lg tw-p-5">
        <h3 className="tw-mb-4 tw-flex tw-items-center tw-text-lg tw-font-semibold">
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
            className="tw-mr-2"
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
            <label className="tw-block tw-text-sm tw-font-medium">Language</label>
            <div className="tw-relative">
              <select
                value={plugin.asrSettings.Asr_language}
                onChange={(e) => saveSetting({ Asr_language: e.target.value })}
                className="tw-min-h-[35px] tw-w-full tw-rounded-md tw-border tw-p-2 tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
              >
                <option value="auto">Auto-detect</option>
                {Object.entries(LANGUAGES).map(([key, value]) => (
                  <option key={value} value={value}>
                    {key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
              <div className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-px-2">
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
                  className="tw-text-base"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
            <p className="tw-text-xs">Automatically detected if not specified</p>
          </div>

          {/* Line Spacing Selector */}
          <div className="tw-space-y-1">
            <label className="tw-block tw-text-sm tw-font-medium">Line Spacing</label>
            <div className="tw-relative">
              <select
                value={plugin.asrSettings.Asr_lineSpacing}
                onChange={(e) => saveSetting({ Asr_lineSpacing: e.target.value })}
                className="tw-min-h-[35px] tw-w-full tw-rounded-md tw-border tw-p-2 tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
              >
                <option value="multi">Multi-line</option>
                <option value="single">Single-line</option>
              </select>
              <div className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-px-2">
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
                  className="tw-text-base"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
            <p className="tw-text-xs">Formatting for the transcribed text output</p>
          </div>

          {/* Enable Timestamps Toggle */}
          <div className="tw-flex tw-items-center tw-justify-between tw-py-2">
            <label className="tw-text-sm tw-font-medium">Enable timestamps</label>
            <label className="tw-relative tw-inline-flex tw-cursor-pointer tw-items-center">
              <input
                type="checkbox"
                checked={plugin.asrSettings.Asr_timestamps}
                onChange={(e) => saveSetting({ Asr_timestamps: e.target.checked })}
                className="tw-peer tw-sr-only"
              />
              <div className="tw-peer-checked:tw-after:tw-translate-x-full tw-peer-checked:tw-bg-primary tw-peer tw-h-6 tw-w-11 tw-rounded-full after:tw-absolute after:tw-left-[2px] after:tw-top-[2px] after:tw-size-5 after:tw-rounded-full after:tw-border after:tw-border-border after:tw-transition-all after:tw-content-[''] peer-focus:tw-outline-none peer-focus:tw-ring-2 peer-focus:tw-ring-ring"></div>
            </label>
          </div>

          {/* Timestamp Format */}
          <div
            className={`tw-space-y-1 ${!plugin.asrSettings.Asr_timestamps ? "tw-pointer-events-none tw-opacity-50" : ""}`}
          >
            <label className="tw-block tw-text-sm tw-font-medium">Timestamp format</label>
            <div className="tw-relative">
              <select
                value={plugin.asrSettings.Asr_timestampFormat}
                onChange={(e) => saveSetting({ Asr_timestampFormat: e.target.value })}
                className="tw-min-h-[35px] tw-w-full tw-rounded-md tw-border tw-p-2 tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
                disabled={!plugin.asrSettings.Asr_timestamps}
              >
                <option value="auto">Auto (Shortest format)</option>
                <option value="HH:mm:ss">HH:mm:ss</option>
                <option value="mm:ss">mm:ss</option>
                <option value="ss">ss</option>
              </select>
              <div className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-px-2">
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
                  className="tw-text-base"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
            <p className="tw-text-xs">Format for timestamp markers in the transcription</p>
          </div>

          {/* Timestamp Interval */}
          <div
            className={`tw-space-y-1 ${!plugin.asrSettings.Asr_timestamps ? "tw-pointer-events-none tw-opacity-50" : ""}`}
          >
            <label className="tw-block tw-text-sm tw-font-medium">Timestamp interval</label>
            <div className="tw-relative">
              <select
                value={plugin.asrSettings.Asr_timestampInterval}
                onChange={(e) => saveSetting({ Asr_timestampInterval: e.target.value })}
                className="tw-min-h-[35px] tw-w-full tw-rounded-md tw-border tw-p-2 tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
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
              <div className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-px-2">
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
                  className="tw-text-base"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
            <p className="tw-text-xs">How often to insert timestamp markers</p>
          </div>
        </div>
      </section>
    </div>
  );
};
export { AsrSetting };
