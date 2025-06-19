import axios from "axios";
import Whisper from "../main";
import { Notice, MarkdownView, requestUrl } from "obsidian";
import { getBaseFileName, payloadGenerator } from "../utils";

export class AudioHandler {
  private plugin: Whisper;

  constructor(plugin: Whisper) {
    this.plugin = plugin;
  }

  async sendAudioData(blob: Blob, fileName: string): Promise<void> {
    // Get the base file name without extension
    const baseFileName = getBaseFileName(fileName);

    const audioFilePath = `${
      this.plugin.whisperSettings.saveAudioFilePath
        ? `${this.plugin.whisperSettings.saveAudioFilePath}/`
        : ""
    }${fileName}`;

    const noteFilePath = `${
      this.plugin.whisperSettings.createNewFileAfterRecordingPath
        ? `${this.plugin.whisperSettings.createNewFileAfterRecordingPath}/`
        : ""
    }${baseFileName}.md`;

    if (this.plugin.whisperSettings.debugMode) {
      new Notice(`Sending audio data size: ${blob.size / 1000} KB`);
    }

    if (!this.plugin.whisperSettings.useLocalService && !this.plugin.whisperSettings.apiKey) {
      new Notice("API key is missing. Please add your API key in the settings.");
      return;
    }

    const formData = new FormData();
    formData.append("file", blob, fileName);
    formData.append("model", this.plugin.whisperSettings.model);
    formData.append("language", this.plugin.whisperSettings.language);
    if (this.plugin.whisperSettings.prompt)
      formData.append("prompt", this.plugin.whisperSettings.prompt);

    try {
      // If the saveAudioFile setting is true, save the audio file
      if (this.plugin.whisperSettings.saveAudioFile) {
        const arrayBuffer = await blob.arrayBuffer();
        await this.plugin.app.vault.adapter.writeBinary(audioFilePath, new Uint8Array(arrayBuffer));
        new Notice("Audio saved successfully.");
      }
    } catch (err) {
      console.error("Error saving audio file:", err);
      new Notice("Error saving audio file: " + err.message);
    }

    try {
      if (this.plugin.whisperSettings.debugMode) {
        new Notice("Parsing audio data:" + fileName);
      }

      let response;
      if (this.plugin.whisperSettings.useLocalService) {
        // 使用本地 whisper ASR 服务
        response = await this.sendToLocalService(blob, fileName);
      } else {
        // 使用远程 OpenAI API
        response = await axios.post(this.plugin.whisperSettings.apiUrl, formData, {
          headers: {
            "Content-Type": "multipart/form-data",
            Authorization: `Bearer ${this.plugin.whisperSettings.apiKey}`,
          },
        });
      }

      // Determine if a new file should be created
      const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const shouldCreateNewFile =
        this.plugin.whisperSettings.createNewFileAfterRecording || !activeView;

      if (shouldCreateNewFile) {
        await this.plugin.app.vault.create(
          noteFilePath,
          `![[${audioFilePath}]]\n${response.data.text}`
        );
        await this.plugin.app.workspace.openLinkText(noteFilePath, "", true);
      } else {
        // Insert the transcription at the cursor position
        const editor = this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        if (editor) {
          const cursorPosition = editor.getCursor();
          editor.replaceRange(response.data.text, cursorPosition);

          // Move the cursor to the end of the inserted text
          const newPosition = {
            line: cursorPosition.line,
            ch: cursorPosition.ch + response.data.text.length,
          };
          editor.setCursor(newPosition);
        }
      }

      new Notice("Audio parsed successfully.");
    } catch (err) {
      console.error("Error parsing audio:", err);
      new Notice("Error parsing audio: " + err.message);
    }
  }

  async sendToLocalService(blob: Blob, fileName: string): Promise<{ data: { text: string } }> {
    const payload_data: Record<string, any> = {};
    payload_data["audio_file"] = blob;
    const [request_body, boundary_string] = await payloadGenerator(payload_data);

    let args = "output=json";
    args += `&word_timestamps=true`;

    const { translate, encode, vadFilter, language, prompt } = this.plugin.whisperSettings;
    if (translate) args += `&task=translate`;
    if (encode !== true) args += `&encode=${encode}`;
    if (vadFilter !== false) args += `&vad_filter=${vadFilter}`;
    if (language !== "en") args += `&language=${language}`;
    if (prompt) args += `&initial_prompt=${prompt}`;

    const urls = this.plugin.whisperSettings.localServiceUrl.split(";").filter(Boolean);

    for (const baseUrl of urls) {
      const url = `${baseUrl}/asr?${args}`;
      console.log("Trying URL:", url);

      const options = {
        method: "POST",
        url,
        contentType: `multipart/form-data; boundary=----${boundary_string}`,
        body: request_body,
      };

      console.log("Options:", options);

      try {
        const response = await requestUrl(options);
        if (this.plugin.whisperSettings.debugMode) {
          console.log("Raw response:", response);
        }

        // 处理响应数据，确保格式与 OpenAI API 兼容
        let transcriptionText = "";
        if (response.json && response.json.text) {
          transcriptionText = response.json.text;
        } else if (response.json && response.json.segments) {
          transcriptionText = response.json.segments.map((segment: any) => segment.text).join("");
        }

        return {
          data: {
            text: transcriptionText,
          },
        };
      } catch (error) {
        if (this.plugin.whisperSettings.debugMode) {
          console.error("Error with URL:", url, error);
        }
        // 如果是最后一个 URL，抛出错误
        if (baseUrl === urls[urls.length - 1]) {
          throw error;
        }
      }
    }

    throw new Error("All local service URLs failed");
  }
}
