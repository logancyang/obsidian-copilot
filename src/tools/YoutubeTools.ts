import { type Youtube4llmResponse, BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { selfHostYoutube4llm } from "@/LLMProviders/selfHostServices";
import { logInfo, logWarn } from "@/logger";
import { isSelfHostModeValid } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { extractAllYoutubeUrls } from "@/utils";
import { z } from "zod";
import { createLangChainTool } from "./createLangChainTool";

// Maximum input length to prevent potential DoS attacks
const MAX_USER_MESSAGE_LENGTH = 50000; // Maximum number of characters

/**
 * Extract YouTube video ID from a URL.
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Free YouTube transcript extraction using YouTube's innertube API.
 * No API key required - fetches captions directly from YouTube.
 */
async function freeYoutubeTranscript(url: string): Promise<Youtube4llmResponse> {
  const startTime = Date.now();
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(`Could not extract video ID from URL: ${url}`);
  }

  // Fetch the video page to get caption track URLs
  const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!pageResponse.ok) {
    throw new Error(`Failed to fetch YouTube page (${pageResponse.status})`);
  }

  const html = await pageResponse.text();

  // Extract captions data from the page
  const captionMatch = html.match(
    /"captions":\s*(\{[\s\S]*?"playerCaptionsTracklistRenderer"[\s\S]*?\})\s*,\s*"videoDetails"/
  );
  if (!captionMatch) {
    throw new Error("No captions available for this video");
  }

  let captionsData;
  try {
    captionsData = JSON.parse(captionMatch[1]);
  } catch {
    throw new Error("Failed to parse captions data");
  }

  const tracks = captionsData?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error("No caption tracks found for this video");
  }

  // Prefer English, fall back to first available track
  const track =
    tracks.find((t: any) => t.languageCode === "en") ||
    tracks.find((t: any) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  const captionUrl = track.baseUrl;
  if (!captionUrl) {
    throw new Error("No caption URL found");
  }

  // Fetch the captions XML
  const captionResponse = await fetch(captionUrl);
  if (!captionResponse.ok) {
    throw new Error(`Failed to fetch captions (${captionResponse.status})`);
  }

  const xml = await captionResponse.text();

  // Parse XML captions into plain text
  const textSegments: string[] = [];
  const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = textRegex.exec(xml)) !== null) {
    // Decode HTML entities
    const decoded = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, " ")
      .trim();
    if (decoded) {
      textSegments.push(decoded);
    }
  }

  const transcript = textSegments.join(" ");
  const elapsed = Date.now() - startTime;
  logInfo(
    `[freeYoutubeTranscript] transcript extracted in ${elapsed}ms (${textSegments.length} segments)`
  );

  return {
    response: { transcript },
    elapsed_time_ms: elapsed,
  };
}

interface YouTubeHandlerArgs {
  _userMessageContent?: string;
}

const youtubeTranscriptionTool = createLangChainTool({
  name: "youtubeTranscription",
  description: "Get transcripts of YouTube videos when the user provides YouTube URLs",
  schema: z.object({
    _userMessageContent: z
      .string()
      .optional()
      .describe("Internal: user message content injected by the system"),
  }),
  func: async (args: YouTubeHandlerArgs) => {
    // The _userMessageContent is injected by the tool execution system
    const { _userMessageContent } = args;

    // Input validation
    if (typeof _userMessageContent !== "string") {
      return {
        success: false,
        message: "Invalid input: User message must be a string",
      };
    }

    if (_userMessageContent.length > MAX_USER_MESSAGE_LENGTH) {
      return {
        success: false,
        message: `Input too long: Maximum allowed length is ${MAX_USER_MESSAGE_LENGTH} characters`,
      };
    }

    // Extract YouTube URLs only from the user's message
    const urls = extractAllYoutubeUrls(_userMessageContent);

    if (urls.length === 0) {
      return {
        success: false,
        message:
          "No YouTube URLs found in the user prompt. URLs must be in the user prompt instead of the context notes.",
      };
    }

    // Process multiple URLs if present
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const settings = getSettings();
          let response: Youtube4llmResponse;

          if (isSelfHostModeValid() && settings.supadataApiKey) {
            // Self-host mode with Supadata API key
            response = await selfHostYoutube4llm(url);
          } else if (settings.enableAllFeatures && settings.enableFreeYoutubeTranscript) {
            // Free extraction mode - try free method first, fall back to Supadata if configured
            try {
              response = await freeYoutubeTranscript(url);
            } catch (freeError) {
              logWarn(`Free YouTube transcript failed for ${url}, trying fallback:`, freeError);
              if (settings.supadataApiKey) {
                response = await selfHostYoutube4llm(url);
              } else {
                throw freeError;
              }
            }
          } else if (settings.enableAllFeatures && settings.supadataApiKey) {
            // enableAllFeatures with Supadata key configured
            response = await selfHostYoutube4llm(url);
          } else {
            // Default: use Brevilabs (requires Plus)
            response = await BrevilabsClient.getInstance().youtube4llm(url);
          }

          // Check if transcript is empty
          if (!response.response.transcript) {
            return {
              url,
              success: false,
              message:
                "Transcript not available. Only English videos with auto transcript enabled are supported",
            };
          }

          return {
            url,
            success: true,
            transcript: response.response.transcript,
            elapsed_time_ms: response.elapsed_time_ms,
          };
        } catch (error) {
          console.error(`Error transcribing YouTube video ${url}:`, error);
          return {
            url,
            success: false,
            message: "An error occurred while transcribing the YouTube video",
          };
        }
      })
    );

    // Check if at least one transcription was successful
    const hasSuccessfulTranscriptions = results.some((result) => result.success);

    return {
      success: hasSuccessfulTranscriptions,
      results,
      total_urls: urls.length,
    };
  },
});

export { freeYoutubeTranscript, youtubeTranscriptionTool };
