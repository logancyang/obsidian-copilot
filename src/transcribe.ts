import {
  TranscriptionSettings,
  /*SWIFTINK_AUTH_CALLBACK*/ API_BASE,
  DEFAULT_SETTINGS,
} from "src/settings";
import { Notice, requestUrl, RequestUrlParam, TFile, Vault, App } from "obsidian";
import { format } from "date-fns";
import { paths, components } from "./types/swiftink";
import { PayloadData, payloadGenerator, preprocessWhisperASRResponse } from "src/utils";
import { StatusBar } from "./status";
import { SupabaseClient } from "@supabase/supabase-js";
import * as tus from "tus-js-client";
import { WhisperASRResponse, WhisperASRSegment } from "./types/whisper-asr";

type TranscriptionBackend = (file: TFile) => Promise<string>;

const MAX_TRIES = 100;

export class TranscriptionEngine {
  settings: TranscriptionSettings;
  vault: Vault;
  statusBar: StatusBar | null;
  supabase: SupabaseClient;
  app: App;

  transcriptionEngine: TranscriptionBackend;

  transcription_engines: { [key: string]: TranscriptionBackend } = {
    swiftink: this.getTranscriptionSwiftink,
    whisper_asr: this.getTranscriptionWhisperASR,
  };

  constructor(
    settings: TranscriptionSettings,
    vault: Vault,
    statusBar: StatusBar | null,
    supabase: SupabaseClient,
    app: App
  ) {
    this.settings = settings;
    this.vault = vault;
    this.statusBar = statusBar;
    this.supabase = supabase;
    this.app = app;
  }

  segmentsToTimestampedString(
    segments: components["schemas"]["TimestampedTextSegment"][],
    timestampFormat: string,
    interval: number = 0 // in seconds, default is 0 which means no interval adjustment
  ): string {
    let maxDuration = 0;

    // Find the largest timestamp in the segments
    segments.forEach((segment) => {
      maxDuration = Math.max(maxDuration, segment.end);
    });

    // Decide format based on maxDuration
    const autoFormat = maxDuration < 3600 ? "mm:ss" : "HH:mm:ss";

    const renderSegments = (segments: components["schemas"]["TimestampedTextSegment"][]) =>
      segments.reduce((transcription: string, segment) => {
        let start = new Date(segment.start * 1000);
        let end = new Date(segment.end * 1000);
        start = new Date(start.getTime() + start.getTimezoneOffset() * 60000);
        end = new Date(end.getTime() + end.getTimezoneOffset() * 60000);
        const formatToUse = timestampFormat === "auto" ? autoFormat : timestampFormat;
        const start_formatted = format(start, formatToUse);
        const end_formatted = format(end, formatToUse);
        const segment_string = `${start_formatted} - ${end_formatted}: ${segment.text.trim()}\n`;
        transcription += segment_string;
        return transcription;
      }, "");

    if (interval > 0) {
      // Group segments based on interval
      const groupedSegments: Record<string, { start: number; end: number; texts: string[] }> = {};
      segments.forEach((segment) => {
        // Determine which interval the segment's start time falls into
        const intervalStart = Math.floor(segment.start / interval) * interval;
        if (!groupedSegments[intervalStart]) {
          groupedSegments[intervalStart] = {
            start: segment.start,
            end: segment.end,
            texts: [segment.text],
          };
        } else {
          groupedSegments[intervalStart].end = Math.max(
            groupedSegments[intervalStart].end,
            segment.end
          );
          groupedSegments[intervalStart].texts.push(segment.text);
        }
      });

      const bucketedSegments = Object.values(groupedSegments).map((group) => ({
        start: group.start,
        end: group.end,
        text: group.texts.join("").trim(),
      }));
      return renderSegments(bucketedSegments);
    } else {
      // Default behavior: timestamp each segment individually
      return renderSegments(segments);
    }
  }

  async getTranscription(file: TFile): Promise<string> {
    if (this.settings.debug)
      console.log(`Transcription engine: ${this.settings.transcriptionEngine}`);
    const start = new Date();
    this.transcriptionEngine = this.transcription_engines[this.settings.transcriptionEngine];
    return this.transcriptionEngine(file).then((transcription) => {
      if (this.settings.debug) console.log(`Transcription: ${transcription}`);
      if (this.settings.debug)
        console.log(`Transcription took ${new Date().getTime() - start.getTime()} ms`);
      return transcription;
    });
  }

  async getTranscriptionWhisperASR(file: TFile): Promise<string> {
    const payload_data: PayloadData = {};
    payload_data["audio_file"] = new Blob([await this.vault.readBinary(file)]);
    const [request_body, boundary_string] = await payloadGenerator(payload_data);

    let args = "output=json"; // always output json, so we can have the timestamps if we need them
    args += `&word_timestamps=true`; // always output word timestamps, so we can have the timestamps if we need them
    const { translate, encode, vadFilter, language, initialPrompt } = this.settings;
    if (translate) args += `&task=translate`;
    if (encode !== DEFAULT_SETTINGS.encode) args += `&encode=${encode}`;
    if (vadFilter !== DEFAULT_SETTINGS.vadFilter) args += `&vad_filter=${vadFilter}`;
    if (language !== DEFAULT_SETTINGS.language) args += `&language=${language}`;
    if (initialPrompt) args += `&initial_prompt=${initialPrompt}`;

    const urls = this.settings.whisperASRUrls.split(";").filter(Boolean); // Remove empty strings

    for (const baseUrl of urls) {
      const url = `${baseUrl}/asr?${args}`;
      console.log("Trying URL:", url);

      const options: RequestUrlParam = {
        method: "POST",
        url: url,
        contentType: `multipart/form-data; boundary=----${boundary_string}`,
        body: request_body,
      };

      console.log("Options:", options);

      try {
        const response = await requestUrl(options);
        if (this.settings.debug) console.log("Raw response:", response);

        // ASR_ENGINE=faster_whisper returns segments as an array. Preprocess it to match the standard.
        const preprocessed = Array.isArray(response.json.segments[0])
          ? preprocessWhisperASRResponse(response.json)
          : (response.json as WhisperASRResponse);

        if (this.settings.debug) console.log("Preprocessed response:", preprocessed);

        // Create segments for each word timestamp if word timestamps are available
        const wordSegments = preprocessed.segments.reduce(
          (acc: components["schemas"]["TimestampedTextSegment"][], segment: WhisperASRSegment) => {
            if (segment.words) {
              acc.push(
                ...segment.words.map(
                  (wordTimestamp) =>
                    ({
                      start: wordTimestamp.start,
                      end: wordTimestamp.end,
                      text: wordTimestamp.word,
                    }) as components["schemas"]["TimestampedTextSegment"]
                )
              );
            }
            return acc;
          },
          []
        );

        if (this.settings.wordTimestamps) {
          return this.segmentsToTimestampedString(wordSegments, this.settings.timestampFormat);
        } else if (parseInt(this.settings.timestampInterval)) {
          // Feed the function word segments with the interval
          return this.segmentsToTimestampedString(
            wordSegments,
            this.settings.timestampFormat,
            parseInt(this.settings.timestampInterval)
          );
        } else if (this.settings.timestamps) {
          // Use existing segment-to-string functionality if only segment timestamps are needed
          const segments = preprocessed.segments.map((segment: WhisperASRSegment) => ({
            start: segment.start,
            end: segment.end,
            text: segment.text,
          }));
          return this.segmentsToTimestampedString(segments, this.settings.timestampFormat);
        } else if (preprocessed.segments) {
          // Concatenate all segments into a single string if no timestamps are required
          return preprocessed.segments
            .map((segment: WhisperASRSegment) => segment.text)
            .map((s) => s.trim())
            .join("\n");
        } else {
          // Fallback to full text if no segments are there
          return preprocessed.text;
        }
      } catch (error) {
        if (this.settings.debug) console.error("Error with URL:", url, error);
        // Don't return or throw yet, try the next URL
      }
    }
    // If all URLs fail, reject the promise with a generic error or the last specific error caught
    return Promise.reject("All Whisper ASR URLs failed");
  }

  async getTranscriptionSwiftink(file: TFile): Promise<string> {
    //const api_base = "https://api.swiftink.io";

    const session = await this.supabase.auth.getSession().then((res) => {
      return res.data;
    });

    if (session == null || session.session == null) {
      //window.open(SWIFTINK_AUTH_CALLBACK, "_blank");
      return Promise.reject("No user session found. Please log in and try again.");
    }

    const token = session.session.access_token;
    const id = session.session.user.id;

    const fileStream = await this.vault.readBinary(file);
    const filename = file.name.replace(/[^a-zA-Z0-9.]+/g, "-");

    // Declare progress notice for uploading
    let uploadProgressNotice: Notice | null = null;

    const uploadPromise = new Promise<tus.Upload>((resolve) => {
      const upload = new tus.Upload(new Blob([fileStream]), {
        endpoint: `https://vcdeqgrsqaexpnogauly.supabase.co/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${token}`,
          "x-upsert": "true",
        },
        uploadDataDuringCreation: true,
        metadata: {
          bucketName: "swiftink-upload",
          objectName: `${id}/${filename}`,
        },
        chunkSize: 6 * 1024 * 1024,
        onProgress: (bytesUploaded, bytesTotal) => {
          const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);

          // Create a notice message with the progress
          const noticeMessage = `Uploading ${filename}: ${percentage}%`;

          // Check if a notice has already been created
          if (!uploadProgressNotice) {
            // If not, create a new notice
            uploadProgressNotice = new Notice(noticeMessage, 80 * 1000);
          } else {
            // If the notice exists, update its content
            uploadProgressNotice.setMessage(noticeMessage);
            //uploadProgressNotice.hide();
          }

          if (this.settings.debug) {
            console.log(bytesUploaded, bytesTotal, percentage + "%");
          }
        },
        onSuccess: () => {
          if (this.settings.debug) {
            console.log(`Successfully uploaded ${filename} to Swiftink`);
          }

          // Close the progress notice on successful upload
          if (uploadProgressNotice) {
            uploadProgressNotice.hide();
          }

          resolve(upload);
        },
      });

      upload.start();
    });

    try {
      await uploadPromise;
      new Notice(`Successfully uploaded ${filename} to Swiftink`);
    } catch (error) {
      if (this.settings.debug) {
        console.log("Failed to upload to Swiftink: ", error);
      }

      return Promise.reject(new Notice(`Failed to upload ${filename} to Swiftink`));
    }

    // Declare progress notice for transcription
    let transcriptionProgressNotice: Notice | null = null;

    const fileUrl = `https://vcdeqgrsqaexpnogauly.supabase.co/storage/v1/object/public/swiftink-upload/${id}/${filename}`;
    const url = `${API_BASE}/transcripts/`;
    const headers = { Authorization: `Bearer ${token}` };
    const body: paths["/transcripts/"]["post"]["requestBody"]["content"]["application/json"] = {
      name: filename,
      url: fileUrl,
    };

    if (this.settings.language != "auto")
      body.language = this.settings
        .language as components["schemas"]["CreateTranscriptionRequest"]["language"];

    if (this.settings.debug) console.log(body);

    const options: RequestUrlParam = {
      method: "POST",
      url: url,
      headers: headers,
      body: JSON.stringify(body),
    };

    let transcript_create_res;
    try {
      transcript_create_res = await requestUrl(options);
    } catch (error) {
      if (this.settings.debug) console.log("Failed to create transcript: ", error);
      return Promise.reject(error);
    }

    let transcript: components["schemas"]["TranscriptSchema"] = transcript_create_res.json;
    if (this.settings.debug) console.log(transcript);

    let completed_statuses = ["transcribed", "complete"];

    if (this.settings.embedSummary || this.settings.embedOutline || this.settings.embedKeywords) {
      completed_statuses = ["complete"];
    }

    return new Promise((resolve, reject) => {
      let tries = 0;

      // Function to update the transcription progress notice
      const updateTranscriptionNotice = () => {
        const noticeMessage = `Transcribing ${transcript.name}...`;
        if (!transcriptionProgressNotice) {
          transcriptionProgressNotice = new Notice(noticeMessage, 80 * 1000);
        } else {
          transcriptionProgressNotice.setMessage(noticeMessage);
        }
      };

      const poll = setInterval(async () => {
        const options: RequestUrlParam = {
          method: "GET",
          url: `${API_BASE}/transcripts/${transcript.id}`,
          headers: headers,
        };
        const transcript_res = await requestUrl(options);
        transcript = transcript_res.json;
        if (this.settings.debug) console.log(transcript);

        if (transcript.status && completed_statuses.includes(transcript.status)) {
          clearInterval(poll);

          //Close the transcription progress notice on completion
          if (transcriptionProgressNotice) {
            transcriptionProgressNotice.hide();
          }

          new Notice(`Successfully transcribed ${filename} with Swiftink`);
          resolve(this.formatSwiftinkResults(transcript));
        } else if (transcript.status == "failed") {
          if (this.settings.debug) console.error("Swiftink failed to transcribe the file");
          clearInterval(poll);
          reject("Swiftink failed to transcribe the file");
        } else if (transcript.status == "validation_failed") {
          if (this.settings.debug) console.error("Swiftink has detected an invalid file");
          clearInterval(poll);
          reject("Swiftink has detected an invalid file");
        } else if (tries > MAX_TRIES) {
          if (this.settings.debug) console.error("Swiftink took too long to transcribe the file");
          clearInterval(poll);
          reject("Swiftink took too long to transcribe the file");
        } else {
          // Update the transcription progress notice
          updateTranscriptionNotice();
        }
        tries++;
      }, 3000);
    });
  }

  formatSwiftinkResults(transcript: components["schemas"]["TranscriptSchema"]): string {
    let transcript_text = "## Transcript\n";

    if (this.settings.timestamps)
      transcript_text += this.segmentsToTimestampedString(
        transcript.text_segments,
        this.settings.timestampFormat
      );
    else transcript_text += transcript.text ? transcript.text : "";

    if (transcript_text.slice(-1) !== "\n") transcript_text += "\n";

    if (
      this.settings.embedSummary &&
      transcript.summary &&
      transcript.summary !== "Insufficient information for a summary."
    )
      transcript_text += `## Summary\n${transcript.summary}`;

    if (transcript_text.slice(-1) !== "\n") transcript_text += "\n";

    if (this.settings.embedOutline && transcript.heading_segments.length > 0)
      transcript_text += `## Outline\n${this.segmentsToTimestampedString(
        transcript.heading_segments,
        this.settings.timestampFormat
      )}`;

    if (transcript_text.slice(-1) !== "\n") transcript_text += "\n";

    if (this.settings.embedKeywords && transcript.keywords.length > 0)
      transcript_text += `## Keywords\n${transcript.keywords.join(", ")}`;

    if (transcript_text.slice(-1) !== "\n") transcript_text += "\n";

    if (this.settings.embedAdditionalFunctionality) {
      transcript_text += `[...](obsidian://swiftink_transcript_functions?id=${transcript.id})`;
    }

    return transcript_text;
  }
}
