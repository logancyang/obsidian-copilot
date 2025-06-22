import React, { useState, useEffect } from "react";
import { App } from "obsidian";
import CopilotPlugin from "@/main";

interface TranscriptionSettings {
  timestamps: boolean;
  timestampFormat: string;
  timestampInterval: string; // easier to store as a string and convert to number when needed
  translate: boolean;
  language: string;
  verbosity: number;
  whisperASRUrls: string;
  debug: boolean;
  transcriptionEngine: string;
  embedAdditionalFunctionality: boolean;
  embedSummary: boolean;
  embedOutline: boolean;
  embedKeywords: boolean;
  swiftink_access_token: string | null;
  swiftink_refresh_token: string | null;
  lineSpacing: string;
  encode: boolean;
  initialPrompt: string;
  vadFilter: boolean;
  wordTimestamps: boolean;
}

const SWIFTINK_AUTH_CALLBACK = "https://swiftink.io/login/?callback=obsidian://swiftink_auth";

const SUPABASE_URL = "https://vcdeqgrsqaexpnogauly.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZGVxZ3JzcWFleHBub2dhdWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODU2OTM4NDUsImV4cCI6MjAwMTI2OTg0NX0.BBxpvuejw_E-Q_g6SU6G6sGP_6r4KnrP-vHV2JZpAho";
const API_BASE = "https://api.swiftink.io";
const IS_SWIFTINK = "swiftink";

const DEFAULT_SETTINGS: TranscriptionSettings = {
  timestamps: false,
  timestampFormat: "auto",
  timestampInterval: "0",
  translate: false,
  language: "auto",
  verbosity: 1,
  whisperASRUrls: "http://localhost:9000",
  debug: false,
  transcriptionEngine: "swiftink",
  embedAdditionalFunctionality: true,
  embedSummary: true,
  embedOutline: true,
  embedKeywords: true,
  swiftink_access_token: null,
  swiftink_refresh_token: null,
  lineSpacing: "multi",
  encode: true,
  initialPrompt: "",
  vadFilter: false, // this doesn't seem to do anything in the current version of the Whisper ASR server
  wordTimestamps: false,
};

const LANGUAGES = {
  AFRIKAANS: "af",
  ALBANIAN: "sq",
  AMHARIC: "am",
  ARABIC: "ar",
  ARMENIAN: "hy",
  ASSAMESE: "as",
  AZERBAIJANI: "az",
  BASHKIR: "ba",
  BASQUE: "eu",
  BELARUSIAN: "be",
  BENGALI: "bn",
  BOSNIAN: "bs",
  BRETON: "br",
  BULGARIAN: "bg",
  BURMESE: "my",
  CATALAN: "ca",
  CHINESE: "zh",
  CROATIAN: "hr",
  CZECH: "cs",
  DANISH: "da",
  DUTCH: "nl",
  ENGLISH: "en",
  ESTONIAN: "et",
  FAROESE: "fo",
  FINNISH: "fi",
  FRENCH: "fr",
  GALICIAN: "gl",
  GEORGIAN: "ka",
  GERMAN: "de",
  GREEK: "el",
  GUJARATI: "gu",
  HAITIAN: "ht",
  HAUSA: "ha",
  HEBREW: "he",
  HINDI: "hi",
  HUNGARIAN: "hu",
  ICELANDIC: "is",
  INDONESIAN: "id",
  ITALIAN: "it",
  JAPANESE: "ja",
  JAVANESE: "jv",
  KANNADA: "kn",
  KAZAKH: "kk",
  KOREAN: "ko",
  LAO: "lo",
  LATIN: "la",
  LATVIAN: "lv",
  LINGALA: "ln",
  LITHUANIAN: "lt",
  LUXEMBOURGISH: "lb",
  MACEDONIAN: "mk",
  MALAGASY: "mg",
  MALAY: "ms",
  MALAYALAM: "ml",
  MALTESE: "mt",
  MAORI: "mi",
  MARATHI: "mr",
  MONGOLIAN: "mn",
  NEPALI: "ne",
  NORWEGIAN: "no",
  OCCITAN: "oc",
  PANJABI: "pa",
  PERSIAN: "fa",
  POLISH: "pl",
  PORTUGUESE: "pt",
  PUSHTO: "ps",
  ROMANIAN: "ro",
  RUSSIAN: "ru",
  SANSKRIT: "sa",
  SERBIAN: "sr",
  SHONA: "sn",
  SINDHI: "sd",
  SINHALA: "si",
  SLOVAK: "sk",
  SLOVENIAN: "sl",
  SOMALI: "so",
  SPANISH: "es",
  SUNDANESE: "su",
  SWAHILI: "sw",
  SWEDISH: "sv",
  TAGALOG: "tl",
  TAJIK: "tg",
  TAMIL: "ta",
  TATAR: "tt",
  TELUGU: "te",
  THAI: "th",
};

const TranscriptionSettingsTab: React.FC<{ app: App; plugin: CopilotPlugin }> = ({
  app,
  plugin,
}) => {
  const [settings, setSettings] = useState<TranscriptionSettings>(plugin.Transcriptionsettings);

  useEffect(() => {
    updateVisibility();
  }, [settings]);

  const updateVisibility = () => {
    const swiftinkVisible = settings.transcriptionEngine === "swiftink";
    const whisperASRVisible = settings.transcriptionEngine === "whisper_asr";
    const timestampsVisible = settings.timestamps;
    const wordTimestampsVisible = whisperASRVisible && timestampsVisible;
    const userUnauthed = plugin.user === null;

    const updateElementVisibility = (classSelector: string, visible: boolean) => {
      const elements = document.querySelectorAll(classSelector);
      elements.forEach((element) => {
        (element as HTMLElement).style.display = visible ? "block" : "none";
      });
    };

    updateElementVisibility(".swiftink-settings", swiftinkVisible);
    updateElementVisibility(".whisper-asr-settings", whisperASRVisible);
    updateElementVisibility(".depends-on-timestamps", timestampsVisible);
    updateElementVisibility(".word-timestamps-setting", wordTimestampsVisible);
    updateElementVisibility(".swiftink-unauthed-only", userUnauthed);
    updateElementVisibility(".swiftink-authed-only", !userUnauthed);
  };

  const saveSetting = async (newSettings: Partial<TranscriptionSettings>) => {
    const updatedSettings = { ...settings, ...newSettings };
    setSettings(updatedSettings);
    plugin.Transcriptionsettings = updatedSettings;
    await plugin.saveSettings();
  };

  return (
    <div className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Obsidian Transcription Settings
        </h2>
        <div className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 text-xs font-medium px-2.5 py-0.5 rounded-full">
          v1.2.3
        </div>
      </div>

      <div className="space-y-6">
        {/* General Settings Section */}
        <section className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-5">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center">
            <i className="fa fa-sliders mr-2 text-blue-500"></i> General Settings
          </h3>

          <div className="grid grid-cols-1 gap-4">
            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Transcription engine
              </label>
              <div className="relative">
                <select
                  value={settings.transcriptionEngine}
                  onChange={(e) => saveSetting({ transcriptionEngine: e.target.value })}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:text-white"
                >
                  <option value="swiftink">Swiftink (Cloud-based)</option>
                  <option value="whisper_asr">Whisper ASR (Self-hosted)</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                  <i className="fa fa-chevron-down text-gray-400"></i>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Swiftink is cloud-based with AI features. Whisper ASR requires local Python setup.
              </p>
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Notice verbosity
              </label>
              <div className="relative">
                <select
                  value={settings.verbosity.toString()}
                  onChange={(e) => saveSetting({ verbosity: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:text-white"
                >
                  <option value="0">Silent</option>
                  <option value="1">Normal</option>
                  <option value="2">Verbose</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                  <i className="fa fa-chevron-down text-gray-400"></i>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Controls how many notifications you see during transcription.
              </p>
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Language
              </label>
              <div className="relative">
                <select
                  value={settings.language}
                  onChange={(e) => saveSetting({ language: e.target.value })}
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
                  value={settings.lineSpacing}
                  onChange={(e) => saveSetting({ lineSpacing: e.target.value })}
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
                    checked={settings.timestamps}
                    onChange={(e) => saveSetting({ timestamps: e.target.checked })}
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
              className={`form-group ${settings.timestamps ? "" : "opacity-50 pointer-events-none"}`}
            >
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Timestamp format
              </label>
              <div className="relative">
                <select
                  value={settings.timestampFormat}
                  onChange={(e) => saveSetting({ timestampFormat: e.target.value })}
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
              className={`form-group ${settings.timestamps ? "" : "opacity-50 pointer-events-none"}`}
            >
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Timestamp interval
              </label>
              <div className="relative">
                <select
                  value={settings.timestampInterval}
                  onChange={(e) => saveSetting({ timestampInterval: e.target.value })}
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

        {/* Swiftink Settings Section */}
        <section className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-5">
          <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-200 mb-4 flex items-center">
            <i className="fa fa-cloud mr-2"></i> Swiftink Settings
          </h3>

          <div className="grid grid-cols-1 gap-4">
            <div className="form-group">
              <label className="block text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                Swiftink Account
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  className="swiftink-unauthed-only px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-all duration-200 flex items-center justify-center text-sm"
                  onClick={() => window.open(SWIFTINK_AUTH_CALLBACK, "_blank")}
                >
                  <i className="fa fa-envelope mr-2"></i> Sign in with Email
                </button>

                <button
                  className="swiftink-unauthed-only px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-sm transition-all duration-200 flex items-center justify-center text-sm"
                  onClick={async () => {
                    await plugin.supabase.auth.signInWithOAuth({
                      provider: "google",
                      options: { redirectTo: "obsidian://swiftink_auth" },
                    });
                  }}
                >
                  <i className="fa fa-google mr-2"></i> Sign in with Google
                </button>

                <button
                  className="swiftink-unauthed-only px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg shadow-sm transition-all duration-200 flex items-center justify-center text-sm"
                  onClick={async () => {
                    await plugin.supabase.auth.signInWithOAuth({
                      provider: "github",
                      options: { redirectTo: "obsidian://swiftink_auth" },
                    });
                  }}
                >
                  <i className="fa fa-github mr-2"></i> Sign in with GitHub
                </button>

                <button
                  className="swiftink-authed-only px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-sm transition-all duration-200 flex items-center justify-center text-sm"
                  onClick={async () => {
                    await plugin.supabase.auth.signOut();
                    plugin.user = null;
                    await saveSetting({
                      swiftink_access_token: null,
                      swiftink_refresh_token: null,
                    });
                    alert("Successfully logged out");
                  }}
                >
                  <i className="fa fa-sign-out mr-2"></i> Log out
                </button>

                <button
                  className="swiftink-authed-only swiftink-manage-account-btn px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg shadow-sm transition-all duration-200 flex items-center justify-center text-sm"
                  onClick={() => window.open("https://swiftink.io/dashboard/account", "_blank")}
                >
                  <i className="fa fa-user mr-2"></i> Manage Account
                </button>
              </div>
            </div>

            <div className="form-group">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-blue-800 dark:text-blue-200">
                  Embed summary
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input
                    type="checkbox"
                    checked={settings.embedSummary}
                    onChange={(e) => saveSetting({ embedSummary: e.target.checked })}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer transition-transform duration-200 ease-in transform translate-x-0 checked:translate-x-4 checked:border-blue-500"
                  />
                  <label
                    htmlFor="toggle"
                    className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-blue-500"
                  ></label>
                </div>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1.5">
                This will only work if you have a Swiftink Pro account
              </p>
            </div>

            <div className="form-group">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-blue-800 dark:text-blue-200">
                  Embed outline
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input
                    type="checkbox"
                    checked={settings.embedOutline}
                    onChange={(e) => saveSetting({ embedOutline: e.target.checked })}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer transition-transform duration-200 ease-in transform translate-x-0 checked:translate-x-4 checked:border-blue-500"
                  />
                  <label
                    htmlFor="toggle"
                    className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-blue-500"
                  ></label>
                </div>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1.5">
                This will only work if you have a Swiftink Pro account
              </p>
            </div>

            <div className="form-group">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-blue-800 dark:text-blue-200">
                  Embed keywords
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input
                    type="checkbox"
                    checked={settings.embedKeywords}
                    onChange={(e) => saveSetting({ embedKeywords: e.target.checked })}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer transition-transform duration-200 ease-in transform translate-x-0 checked:translate-x-4 checked:border-blue-500"
                  />
                  <label
                    htmlFor="toggle"
                    className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-blue-500"
                  ></label>
                </div>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1.5">
                This will only work if you have a Swiftink Pro account
              </p>
            </div>

            <div className="form-group">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-blue-800 dark:text-blue-200">
                  Embed function link
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input
                    type="checkbox"
                    checked={settings.embedAdditionalFunctionality}
                    onChange={(e) =>
                      saveSetting({ embedAdditionalFunctionality: e.target.checked })
                    }
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer transition-transform duration-200 ease-in transform translate-x-0 checked:translate-x-4 checked:border-blue-500"
                  />
                  <label
                    htmlFor="toggle"
                    className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-blue-500"
                  ></label>
                </div>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1.5">
                Recommended: Include a link to transcript features in the note
              </p>
            </div>
          </div>
        </section>

        {/* Whisper ASR Settings Section */}
        <section className="bg-green-50 dark:bg-green-900/30 rounded-lg p-5">
          <h3 className="text-lg font-semibold text-green-800 dark:text-green-200 mb-4 flex items-center">
            <i className="fa fa-server mr-2"></i> Whisper ASR Settings
          </h3>

          <div className="grid grid-cols-1 gap-4">
            <div className="form-group">
              <label className="block text-sm font-medium text-green-800 dark:text-green-200 mb-1">
                Whisper ASR URLs
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder={DEFAULT_SETTINGS.whisperASRUrls}
                  value={settings.whisperASRUrls}
                  onChange={(e) => saveSetting({ whisperASRUrls: e.target.value })}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-600 border border-green-300 dark:border-green-500 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:text-white"
                />
              </div>
              <p className="text-xs text-green-700 dark:text-green-300 mt-1.5">
                URL of your Whisper ASR server. Multiple URLs separated by semicolons.
              </p>
            </div>

            <div className="form-group">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-green-800 dark:text-green-200">
                  Encode
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input
                    type="checkbox"
                    checked={settings.encode}
                    onChange={(e) => saveSetting({ encode: e.target.checked })}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer transition-transform duration-200 ease-in transform translate-x-0 checked:translate-x-4 checked:border-green-500"
                  />
                  <label
                    htmlFor="toggle"
                    className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-green-500"
                  ></label>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-green-800 dark:text-green-200 mb-1">
                Initial prompt
              </label>
              <div className="relative">
                <textarea
                  placeholder={DEFAULT_SETTINGS.initialPrompt}
                  value={settings.initialPrompt}
                  onChange={(e) => saveSetting({ initialPrompt: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-600 border border-green-300 dark:border-green-500 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:text-white resize-none"
                ></textarea>
              </div>
              <p className="text-xs text-green-700 dark:text-green-300 mt-1.5">
                Model follows the style of the prompt (224 tokens max)
              </p>
            </div>

            <div className="form-group">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-green-800 dark:text-green-200">
                  Word timestamps
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input
                    type="checkbox"
                    checked={settings.wordTimestamps}
                    onChange={(e) => saveSetting({ wordTimestamps: e.target.checked })}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer transition-transform duration-200 ease-in transform translate-x-0 checked:translate-x-4 checked:border-green-500"
                  />
                  <label
                    htmlFor="toggle"
                    className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-green-500"
                  ></label>
                </div>
              </div>
              <p className="text-xs text-green-700 dark:text-green-300 mt-1.5">
                Include timestamps for each word (can get very verbose)
              </p>
            </div>

            <div className="form-group">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-green-800 dark:text-green-200">
                  VAD filter
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input
                    type="checkbox"
                    checked={settings.vadFilter}
                    onChange={(e) => saveSetting({ vadFilter: e.target.checked })}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer transition-transform duration-200 ease-in transform translate-x-0 checked:translate-x-4 checked:border-green-500"
                  />
                  <label
                    htmlFor="toggle"
                    className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-green-500"
                  ></label>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Advanced Settings Section */}
        <section className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-5">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center">
            <i className="fa fa-sliders mr-2 text-purple-500"></i> Advanced Settings
          </h3>

          <div className="grid grid-cols-1 gap-4">
            <div className="form-group">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Debug mode
                </label>
                <div className="relative inline-block w-10 mr-2 align-middle select-none">
                  <input
                    type="checkbox"
                    checked={settings.debug}
                    onChange={(e) => saveSetting({ debug: e.target.checked })}
                    className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 border-gray-300 appearance-none cursor-pointer transition-transform duration-200 ease-in transform translate-x-0 checked:translate-x-4 checked:border-purple-500"
                  />
                  <label
                    htmlFor="toggle"
                    className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer checked:bg-purple-500"
                  ></label>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Enable additional logging for troubleshooting
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="flex flex-col items-center">
          <a href="https://www.swiftink.io" target="_blank" className="mb-2">
            <img
              src="https://www.swiftink.io/assets/img/logos/swiftink.svg"
              alt="Swiftink Logo"
              className="h-10 w-auto"
            />
          </a>
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
            Questions? Please see our{" "}
            <a
              href="https://www.swiftink.io/docs"
              target="_blank"
              className="text-blue-500 hover:text-blue-700"
            >
              Documentation
            </a>{" "}
            or email us at{" "}
            <a href="mailto:support@swiftnk.io" className="text-blue-500 hover:text-blue-700">
              support@swiftink.io
            </a>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-2 text-center">
            By proceeding you agree to our{" "}
            <a
              href="https://www.swiftink.io/terms"
              target="_blank"
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="https://www.swiftink.io/privacy"
              target="_blank"
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>

      {/* Custom Toggle Switch Styles */}
      <style type="text/tailwindcss">{`
    @layer utilities {
      .toggle-checkbox:checked {
        right: 0;
        border-color: #6366f1;
      }
      .toggle-checkbox:checked + .toggle-label {
        background-color: #6366f1;
      }
    }
  `}</style>
    </div>
  );
};

export type { TranscriptionSettings };
export {
  DEFAULT_SETTINGS,
  SWIFTINK_AUTH_CALLBACK,
  TranscriptionSettingsTab,
  SUPABASE_URL,
  SUPABASE_KEY,
  API_BASE,
  IS_SWIFTINK,
};
