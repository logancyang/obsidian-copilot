import { type Youtube4llmResponse, BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { selfHostYoutube4llm } from "@/LLMProviders/selfHostServices";
import { unescapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import { logInfo, logWarn } from "@/logger";
import { isSelfHostModeValid } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { extractAllYoutubeUrls, extractYoutubeVideoId } from "@/utils";
import { z } from "zod";
import { createLangChainTool } from "./createLangChainTool";

// Maximum input length to prevent potential DoS attacks
const MAX_USER_MESSAGE_LENGTH = 50000; // Maximum number of characters

/**
 * Free YouTube transcript extraction using YouTube's innertube API.
 * No API key required - fetches captions directly from YouTube.
 */
async function freeYoutubeTranscript(url: string): Promise<Youtube4llmResponse> {
  const startTime = Date.now();
  const videoId = extractYoutubeVideoId(url);
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
    const decoded = unescapeXml(match[1]).replace(/&#39;/g, "'").replace(/\n/g, " ").trim();
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

/**
 * Resolve a YouTube transcript using the best available provider.
 * Priority: self-host (Supadata) → free extraction → Brevilabs (Plus)
 */
async function resolveYoutubeTranscript(url: string): Promise<Youtube4llmResponse> {
  const settings = getSettings();

  // Self-host mode with Supadata API key
  if (isSelfHostModeValid() && settings.supadataApiKey) {
    return await selfHostYoutube4llm(url);
  }

  // enableAllFeatures: try free extraction, fall back to Supadata if configured
  if (settings.enableAllFeatures) {
    try {
      return await freeYoutubeTranscript(url);
    } catch (freeError) {
      logWarn(`Free YouTube transcript failed for ${url}, trying fallback:`, freeError);
      if (settings.supadataApiKey) {
        return await selfHostYoutube4llm(url);
      }
      throw freeError;
    }
  }

  // Default: use Brevilabs (requires Plus)
  return await BrevilabsClient.getInstance().youtube4llm(url);
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
          const response = await resolveYoutubeTranscript(url);

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

export { freeYoutubeTranscript, resolveYoutubeTranscript, youtubeTranscriptionTool };
